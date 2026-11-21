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

  return {
    institutionId: isCheckItAdmin ? "all" : institutionId,
    currentUserId: user.id,
    currentUserRole: currentRole,
    members: await withProfilePhotos(supabase, membersResponse.data || [])
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

  const { data, error } = await supabase.rpc("remove_team_member", {
    target_profile_id: memberId
  });
  if (error) throw error;

  // The RPC can return no body. Confirm the persisted membership before showing success.
  const { data: remainingMember, error: verificationError } = await supabase
    .from("profile")
    .select("id, assigned_institute")
    .eq("id", memberId)
    .maybeSingle();
  if (verificationError) {
    throw new Error("The removal could not be confirmed. Refresh the team before trying again.", { cause: verificationError });
  }
  if (remainingMember?.assigned_institute) {
    throw new Error("This member is still assigned to the team. Please try again.");
  }
  return data;
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
