import { slugifyAdminPathSegment } from "../routing/AdminRouteUtils";
import { fetchSensorDirectory } from "../data/SensorDirectoryData";

const getInstituteDisplayName = (institute) => {
  const rawName = institute.full_name || institute.institute_id || "Institute";
  if (/^ucsd$/i.test(String(institute.institute_id || ""))) return "UCSD";
  if (/university of california san diego|uc san diego|university of california sa/i.test(rawName)) return "UCSD";
  if (String(rawName).length <= 22) return rawName;

  const acronym = String(rawName)
    .split(/\s+/)
    .filter((word) => !/^(and|of|the|for)$/i.test(word))
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  return acronym.length >= 2 && acronym.length <= 6 ? acronym : rawName;
};

const getDuplicateAwareCorridorNames = (sensors = []) => {
  const groups = sensors.reduce((nextGroups, sensor) => {
    const areaName = sensor.area_name || "Unassigned Area";
    const corridorName = sensor.corridor_name || `Corridor ${sensor.sensor_id}`;
    const key = `${areaName.trim().toLowerCase()}::${String(corridorName).trim().toLowerCase()}`;
    if (!nextGroups.has(key)) nextGroups.set(key, []);
    nextGroups.get(key).push(sensor);
    return nextGroups;
  }, new Map());

  const namesBySensorId = new Map();
  groups.forEach((groupSensors) => {
    const sortedSensors = groupSensors
      .slice()
      .sort((left, right) => String(left.sensor_id || '').localeCompare(String(right.sensor_id || '')));

    sortedSensors.forEach((sensor, index) => {
      const corridorName = sensor.corridor_name || `Corridor ${sensor.sensor_id}`;
      namesBySensorId.set(
        sensor.sensor_id,
        sortedSensors.length > 1 ? `${corridorName} ${index + 1}` : corridorName
      );
    });
  });

  return namesBySensorId;
};

export const formatCampusNavigation = (institutes = [], sensors = []) =>
  institutes.map((institute) => {
    const instituteSensors = sensors.filter(
      (sensor) => sensor.institute_id === institute.institute_id
    );
    const corridorNamesBySensorId = getDuplicateAwareCorridorNames(instituteSensors);

    const areasByName = instituteSensors.reduce((areas, sensor) => {
      const areaName = sensor.area_name || "Unassigned Area";
      const areaId = slugifyAdminPathSegment(areaName);

      if (!areas[areaId]) {
        areas[areaId] = {
          id: areaId,
          name: areaName,
          corridors: [],
        };
      }

      areas[areaId].corridors.push({
        id: sensor.sensor_id,
        name: corridorNamesBySensorId.get(sensor.sensor_id) || sensor.corridor_name || `Corridor ${sensor.sensor_id}`,
        status: sensor.status || "unknown",
        latitude: sensor.latitude,
        longitude: sensor.longitude,
      });

      return areas;
    }, {});

    return {
      id: institute.institute_id,
      instituteName: getInstituteDisplayName(institute),
      areas: Object.values(areasByName)
        .map((area) => ({
          id: area.id,
          name: area.name,
          corridors: area.corridors.sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

export const fetchCampusNavigation = async (supabase) => {
  const { institutes, sensors } = await fetchSensorDirectory(supabase);
  return formatCampusNavigation(institutes, sensors);
};

export const getSearchTokens = (query) =>
  query.trim().toLowerCase().split(/\s+/).filter(Boolean);

export const filterCampusNavigation = (institutes, tokens) => {
  if (tokens.length === 0) return institutes;

  return institutes
    .map((institute) => {
      const instituteMatches = tokens.every((token) =>
        institute.instituteName.toLowerCase().includes(token)
      );

      if (instituteMatches) return institute;

      const areas = institute.areas
        .map((area) => {
          const areaMatches = tokens.every((token) =>
            area.name.toLowerCase().includes(token)
          );

          if (areaMatches) return area;

          return {
            ...area,
            corridors: area.corridors.filter((corridor) =>
              tokens.every((token) =>
                `${corridor.name} ${corridor.status}`.toLowerCase().includes(token)
              )
            ),
          };
        })
        .filter((area) => area.corridors.length > 0);

      return { ...institute, areas };
    })
    .filter((institute) => institute.areas.length > 0);
};
