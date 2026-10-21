const PROFILE_SELECT_WITH_DEPARTMENT = "id, full_name, email, role, department, assigned_institute";
const PROFILE_SELECT = "id, full_name, email, role, assigned_institute";

/**
 * @typedef {Object} TeamMemberRecord
 * @property {string} id
 * @property {string} full_name
 * @property {string} email
 * @property {string=} role
 * @property {string=} department
 * @property {string=} assigned_institute
 */

const readProfiles = async (supabase, select, applyFilters) => {
  let query = supabase.from("profile").select(select);
  query = applyFilters(query);
  return query;
};

const readProfilesWithFallback = async (supabase, applyFilters) => {
  const response = await readProfiles(supabase, PROFILE_SELECT_WITH_DEPARTMENT, applyFilters);

  if (!response.error) return response;

  const missingDepartment = /department/i.test(response.error.message || "");
  if (!missingDepartment) return response;

  return readProfiles(supabase, PROFILE_SELECT, applyFilters);
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
    members: membersResponse.data || []
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
  const { data, error } = await supabase.rpc("remove_team_member", {
    target_profile_id: memberId
  });

  if (error) throw error;
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

  const configuredBaseUrl = String(import.meta.env.VITE_TEAM_API_URL || "").trim().replace(/\/$/, "");
  const inviteUrl = configuredBaseUrl
    ? `${configuredBaseUrl}/api/team/invite`
    : "/api/team/invite";

  let response;
  try {
    response = await fetch(inviteUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ email, role })
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
      payload.error ||
      responseDetail ||
      `Invite service returned HTTP ${response.status}. Check VITE_TEAM_API_URL in Vercel.`
    );
  }

  return payload;
};
