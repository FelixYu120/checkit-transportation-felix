import { slugifyAdminPathSegment } from "../routing/AdminRouteUtils";

const CAMPUS_NAVIGATION_QUERY = `
  id,
  name,
  buildings (
    id,
    name,
    rooms (
      floor_number
    )
  )
`;

export const formatCampusNavigation = (areas = []) =>
  areas.map((area) => {
    const rooms = (area.buildings || []).flatMap((building) => building.rooms || []);
    const floors = [...new Set(rooms.map((room) => room.floor_number))]
      .sort((a, b) => a - b)
      .map((floorNumber) => ({
        id: floorNumber,
      }));

    return {
      id: slugifyAdminPathSegment(area.name),
      instituteName: area.name,
      floors,
    };
  });

export const fetchCampusNavigation = async (supabase) => {
  const { data, error } = await supabase
    .from("areas")
    .select(CAMPUS_NAVIGATION_QUERY);

  if (error) throw error;
  return formatCampusNavigation(data || []);
};

export const getSearchTokens = (query) =>
  query.trim().toLowerCase().split(/\s+/).filter(Boolean);

export const filterCampusNavigation = (colleges, tokens) => {
  if (tokens.length === 0) return colleges;

  return colleges
    .map((college) => {
      const instituteMatches = tokens.every((token) =>
        college.instituteName.toLowerCase().includes(token)
      );
      const floors = college.floors.filter((floor) => {
        const floorText = `corridor ${floor.id} corridors ${floor.id}`;
        return instituteMatches || tokens.every((token) => floorText.toLowerCase().includes(token));
      });

      if (instituteMatches) return college;
      return { ...college, floors };
    })
    .filter((college) => college.floors.length > 0);
};
