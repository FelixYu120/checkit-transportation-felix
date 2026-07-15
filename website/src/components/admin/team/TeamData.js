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

export const fetchInstitutionTeamMembers = async (supabase) => {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
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
  if (!institutionId) {
    return { institutionId: null, members: [] };
  }

  const membersResponse = await readProfilesWithFallback(
    supabase,
    (query) => query.eq("assigned_institute", institutionId).order("full_name", { ascending: true })
  );

  if (membersResponse.error) throw membersResponse.error;

  return {
    institutionId,
    members: membersResponse.data || []
  };
};
