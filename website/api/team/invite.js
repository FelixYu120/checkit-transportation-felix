const getEnv = (...keys) => keys.map((key) => String(process.env[key] || "").trim()).find(Boolean) || "";

const SUPABASE_URL = getEnv("SUPABASE_URL", "VITE_SUPABASE_URL", "VITE_TRANSPORTATION_SUPABASE_URL").replace(/\/$/, "");
const SUPABASE_SERVICE_KEY = getEnv(
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_SERVICE_ROLE",
  "SUPABASE_KEY"
);


const APP_PUBLIC_URL = (
  getEnv("APP_PUBLIC_URL", "TRANSPORTATION_APP_PUBLIC_URL") ||
  (getEnv("VERCEL_PROJECT_PRODUCTION_URL") ? `https://${getEnv("VERCEL_PROJECT_PRODUCTION_URL")}` : "https://checkit-transportation-felix.vercel.app")
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

export async function callSupabase(path, { method = "GET", token = SUPABASE_SERVICE_KEY, body, query, headers = {} } = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error("Supabase admin configuration is missing.");
  }

  const url = new URL(`${SUPABASE_URL}${path}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });

  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(15000),
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

async function getProfileByEmail(email) {
  const rows = await callSupabase("/rest/v1/profile", {
    query: {
      email: `ilike.${email.replace(/[\\%_]/g, "\\$&")}`,
      select: "id,email,role,assigned_institute",
      limit: "1",
    },
  });

  return Array.isArray(rows) ? rows[0] : null;
}

async function upsertInviteProfile({ userId, email, role, assignedInstitute, onlyIfMissing = false }) {
  return callSupabase("/rest/v1/profile", {
    method: "POST",
    query: { on_conflict: "id" },
    headers: {
      Prefer: `resolution=${onlyIfMissing ? "ignore" : "merge"}-duplicates,return=representation`,
    },
    body: [{
      id: userId,
      email,
      role,
      assigned_institute: assignedInstitute || null,
    }],
  });
}

async function restoreProfile({ userId, role, assignedInstitute }) {
  return callSupabase("/rest/v1/profile", {
    method: "PATCH",
    query: {
      id: `eq.${userId}`,
      assigned_institute: "is.null",
    },
    headers: {
      Prefer: "return=representation",
    },
    body: {
      role,
      assigned_institute: assignedInstitute,
    },
  });
}

async function getInviteAuthUser(profile, email) {
  const payload = await callSupabase(`/auth/v1/admin/users/${encodeURIComponent(profile.id)}`);
  const user = payload?.user || payload;
  if (user?.id !== profile.id || String(user.email || "").toLowerCase() !== email) {
    const error = new Error("The member's login does not match their profile. Contact an administrator.");
    error.status = 409;
    throw error;
  }
  return user;
}

async function sendExistingMemberEmail(user, email) {
  const confirmed = Boolean(user.email_confirmed_at);
  const sent = await callSupabase(confirmed ? "/auth/v1/otp" : "/auth/v1/invite", {
    method: "POST",
    query: { redirect_to: `${APP_PUBLIC_URL}/${confirmed ? "login" : "create-account"}` },
    body: confirmed ? { email, create_user: false } : { email },
  });
  if (!confirmed && (sent?.id || sent?.user?.id) !== user.id) {
    const error = new Error("The invitation service did not confirm an account. Please try again.");
    error.status = 502;
    throw error;
  }
}

async function findAuthUserByEmail(email) {
  const normalizedEmail = email.toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 10; page += 1) {
    const result = await callSupabase("/auth/v1/admin/users", {
      query: { page: String(page), per_page: String(perPage) },
    });
    const users = result?.users || [];
    const match = users.find((user) => String(user.email || "").toLowerCase() === normalizedEmail);
    if (match) return match;
    if (users.length < perPage) return null;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
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

    const existingProfile = await getProfileByEmail(email);
    if (existingProfile?.id) {
      if (!assignedInstitute || (existingProfile.assigned_institute && existingProfile.assigned_institute !== assignedInstitute)) {
        return res.status(409).json({ error: "A user with that email already exists in the platform." });
      }

      if (!isCheckItAdmin && ["checkit_admin", "checkit_field_operator"].includes(normalizeRole(existingProfile.role))) {
        return res.status(403).json({ error: "You cannot change this account's team access." });
      }
      const authUser = await getInviteAuthUser(existingProfile, email);
      const needsRestore = !existingProfile.assigned_institute;
      if (needsRestore) {
        const restored = await restoreProfile({ userId: existingProfile.id, role: requestedRole, assignedInstitute });
        if (!restored?.some(profile => profile.id === existingProfile.id && profile.assigned_institute === assignedInstitute)) {
          return res.status(409).json({ error: "Team access could not be restored. Refresh the team and try again." });
        }
      }
      // Retry delivery for current members without changing their existing access.
      await sendExistingMemberEmail(authUser, email);

      return res.status(200).json({
        ok: true,
        email,
        role: needsRestore ? requestedRole : normalizeRole(existingProfile.role),
        restored: needsRestore,
      });
    }

    const redirectTo = `${APP_PUBLIC_URL}/create-account`;
    let invitedUser;
    let reactivated = false;
    try {
      invitedUser = await callSupabase("/auth/v1/invite", {
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
    } catch (inviteError) {
      if (!/already.*(?:registered|exists)/i.test(inviteError.message || "")) throw inviteError;
      const existingUser = await findAuthUserByEmail(email);
      if (!existingUser) throw inviteError;
      if (await getProfileById(existingUser.id)) {
        return res.status(409).json({ error: "This account already has a profile. Refresh the team and try again." });
      }
      invitedUser = existingUser;
      reactivated = true;
    }

    const invitedUserId = invitedUser?.id || invitedUser?.user?.id;
    if (!invitedUserId) {
      return res.status(502).json({ error: "The invitation service did not confirm an account. Please try again." });
    }
    const savedProfiles = await upsertInviteProfile({
      userId: invitedUserId,
      email,
      role: requestedRole,
      assignedInstitute,
      onlyIfMissing: reactivated,
    });
    if (reactivated && !savedProfiles?.some(profile => profile.id === invitedUserId && profile.assigned_institute === assignedInstitute)) {
      return res.status(409).json({ error: "The account's team access changed. Refresh the team and try again." });
    }

    if (reactivated) await sendExistingMemberEmail(invitedUser, email);
    return res.status(200).json({ ok: true, email, role: requestedRole, redirectTo, ...(reactivated ? { restored: true } : {}) });
  } catch (err) {
    console.error("Transportation Invite Error:", err);
    return res.status(err.status || 500).json({
      error: err.message || "Invite could not be sent.",
    });
  }
}
