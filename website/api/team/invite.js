const getEnv = (...keys) => keys.map((key) => process.env[key]).find(Boolean) || "";

const SUPABASE_URL = getEnv("SUPABASE_URL", "VITE_SUPABASE_URL", "VITE_TRANSPORTATION_SUPABASE_URL").replace(/\/$/, "");
const SUPABASE_SERVICE_KEY = getEnv(
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_SERVICE_ROLE",
  "SUPABASE_KEY"
);

const APP_PUBLIC_URL = (
  getEnv("APP_PUBLIC_URL", "TRANSPORTATION_APP_PUBLIC_URL") ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://checkit-website.vercel.app")
).replace(/\/$/, "");

const normalizeRole = (role) => {
  const normalized = String(role || "viewer").trim().toLowerCase();
  return normalized === "user" ? "viewer" : normalized;
};

const getBearerToken = (req) => {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] || "";
};

const readJsonBody = async (req) => {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
};

async function callSupabase(path, { method = "GET", token = SUPABASE_SERVICE_KEY, body, query, headers = {} } = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error("Supabase admin configuration is missing.");
  }

  const url = new URL(`${SUPABASE_URL}${path}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });

  const response = await fetch(url, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const message = payload?.msg || payload?.message || payload?.error_description || payload?.error || "Supabase request failed.";
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function getProfileById(userId) {
  const rows = await callSupabase("/rest/v1/profile", {
    query: {
      id: `eq.${userId}`,
      select: "id,email,role,assigned_institute",
      limit: "1",
    },
  });

  return Array.isArray(rows) ? rows[0] : null;
}

async function upsertInviteProfile({ userId, email, role, assignedInstitute }) {
  return callSupabase("/rest/v1/profile", {
    method: "POST",
    query: { on_conflict: "id" },
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: [{
      id: userId,
      email,
      role,
      assigned_institute: assignedInstitute || null,
    }],
  });
}

export default async function handler(req, res) {
  res.setHeader("Allow", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const accessToken = getBearerToken(req);
    if (!accessToken) {
      return res.status(401).json({ error: "Sign in before inviting team members." });
    }

    const body = await readJsonBody(req);
    const email = String(body?.email || "").trim().toLowerCase();
    const requestedRole = normalizeRole(body?.role);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    const currentUser = await callSupabase("/auth/v1/user", { token: accessToken });
    const currentProfile = currentUser?.id ? await getProfileById(currentUser.id) : null;
    const currentRole = normalizeRole(currentProfile?.role);
    const isCheckItAdmin = currentRole === "checkit_admin";
    const isInstitutionAdmin = currentRole === "admin";
    if (!isCheckItAdmin && !isInstitutionAdmin) {
      return res.status(403).json({ error: "Only admins can invite team members." });
    }

    const allowedRoles = isCheckItAdmin
      ? new Set(["checkit_admin", "checkit_field_operator", "admin", "field_operator", "viewer"])
      : new Set(["field_operator", "viewer"]);
    if (!allowedRoles.has(requestedRole)) {
      return res.status(403).json({ error: "You cannot invite a member with that role." });
    }

    const assignedInstitute = isCheckItAdmin
      ? (body?.assigned_institute || currentProfile?.assigned_institute || null)
      : currentProfile?.assigned_institute;
    if (!assignedInstitute && !isCheckItAdmin) {
      return res.status(400).json({ error: "Your profile is not assigned to an institution." });
    }

    const redirectTo = `${APP_PUBLIC_URL}/create-account`;
    const invitedUser = await callSupabase("/auth/v1/invite", {
      method: "POST",
      query: { redirect_to: redirectTo },
      body: {
        email,
        data: {
          role: requestedRole,
          assigned_institute: assignedInstitute,
          invited_by: currentUser.id,
        },
      },
    });

    const invitedUserId = invitedUser?.id || invitedUser?.user?.id;
    if (invitedUserId) {
      await upsertInviteProfile({
        userId: invitedUserId,
        email,
        role: requestedRole,
        assignedInstitute,
      });
    }

    return res.status(200).json({
      ok: true,
      email,
      role: requestedRole,
      redirectTo,
    });
  } catch (err) {
    console.error("Transportation Invite Error:", err);
    return res.status(err.status || 500).json({
      error: err.message || "Invite could not be sent.",
    });
  }
}
