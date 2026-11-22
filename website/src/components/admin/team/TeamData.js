import { withProfilePhotos } from "../../Header/ProfilePhoto.js";
import { resolveTeamInviteUrl } from "./TeamInviteUrl.js";

const PROFILE_COLUMNS = ['id', 'full_name', 'email', 'role', 'department', 'assigned_institute', 'avatar_path'];

const readProfilesWithFallback = async (supabase, applyFilters) => {
  let columns = [...PROFILE_COLUMNS];
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await applyFilters(supabase.from("profile").select(columns.join(', ')));
    if (!response.error) return response;
    const missing = ['department', 'avatar_path'].find(column =>
      columns.includes(column) && String(response.error.message || '').toLowerCase().includes(column)
    );
    if (!missing) return response;
    columns = columns.filter(column => column !== missing);
    if (attempt === 2) return response;
  }
};

const normalizeRole = (role) => {
  const normalized = String(role || "viewer").trim().toLowerCase();
  return normalized === "user" ? "viewer" : normalized;
};

export const fetchInstitutionTeamMembers = async (supabase) => {
  if (!supabase) {
    throw new Error("The team directory is not available right now.");
  }

  const { data: userResult, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;

  const user = userResult?.user;
  if (!user?.id) {
    throw new Error("You must be signed in to view your team.");
  }

  const currentProfileResponse = await readProfilesWithFallback(
    supabase,
    (query) => query.eq("id", user.id).maybeSingle()
  );

  if (currentProfileResponse.error) throw currentProfileResponse.error;

  const institutionId = currentProfileResponse.data?.assigned_institute;
  const currentRole = normalizeRole(currentProfileResponse.data?.role);
  const isCheckItAdmin = currentRole === "checkit_admin";
  if (!institutionId && !isCheckItAdmin) {
    return { institutionId: null, members: [] };
  }

  const membersResponse = await readProfilesWithFallback(
    supabase,
    (query) => {
      // Removed members keep their profile but lose their institute, so exclude them.
      const scopedQuery = isCheckItAdmin
        ? query.not("assigned_institute", "is", null)
        : query.eq("assigned_institute", institutionId);
      return scopedQuery.order("full_name", { ascending: true });
    }
  );

  if (membersResponse.error) throw membersResponse.error;
  const pending = await supabase.rpc("pending_team_account_removals");
  if (pending.error) throw pending.error;
  const members = [...(membersResponse.data || [])];
  for (const member of pending.data || []) {
    if (!members.some(existing => existing.id === member.id)) members.push({ ...member, removal_pending: true });
  }

  return {
    institutionId: isCheckItAdmin ? "all" : institutionId,
    currentUserId: user.id,
    currentUserRole: currentRole,
    members: await withProfilePhotos(supabase, members)
  };
};

export const updateTeamMemberRole = async (supabase, memberId, role) => {
  const { data, error } = await supabase.rpc("update_team_member_role", {
    target_profile_id: memberId,
    new_role: role
  });

  if (error) throw error;
  return data;
};

export const removeTeamMember = async (supabase, memberId) => {
  if (!supabase || !memberId) throw new Error("Choose a member to remove.");

  const { data: sessionResult, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const token = sessionResult?.session?.access_token;
  if (!token) throw new Error("Sign in before removing a member.");
  const response = await fetch(resolveTeamInviteUrl(import.meta.env?.VITE_TEAM_API_URL).replace(/\/invite$/, "/remove"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ memberId }),
  });
  let result;
  try { result = await response.json(); } catch { /* A missing endpoint may serve HTML. */ }
  if (!response.ok) throw new Error(result?.error || "Account removal is unavailable. Refresh and try again.");
  if (result?.ok !== true || result?.removed !== true || result?.memberId !== memberId) {
    throw new Error("Permanent account deletion could not be confirmed. Refresh and try again.");
  }
  return result;
};

export const inviteTeamMember = async (supabase, { email, role }) => {
  if (!supabase) {
    throw new Error("The invite service is not available right now.");
  }

  const { data: sessionResult, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  const accessToken = sessionResult?.session?.access_token;
  if (!accessToken) {
    throw new Error("Sign in before inviting team members.");
  }

  const inviteUrl = resolveTeamInviteUrl(import.meta.env?.VITE_TEAM_API_URL);

  let response;
  try {
    response = await fetch(inviteUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ email: email.trim().toLowerCase(), role })
    });
  } catch {
    throw new Error("The invite service could not be reached. Make sure the transportation website was redeployed.");
  }

  const responseText = await response.text();
  let payload = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const responseDetail = responseText && !/<(?:!doctype|html)/i.test(responseText)
      ? responseText.slice(0, 180)
      : "";
    throw new Error(
      payload?.error ||
      responseDetail ||
      `Invite service returned HTTP ${response.status}. Check VITE_TEAM_API_URL in Vercel.`
    );
  }

  if (payload?.ok !== true) {
    throw new Error("The invitation could not be confirmed. Please try again or contact your administrator.");
  }

  return payload;
};
