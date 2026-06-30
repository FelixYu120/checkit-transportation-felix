export const LEGACY_INSTITUTE_ALIASES = {
  pepper_canyon: "ucsd",
};

export const FALLBACK_INSTITUTES = [
  {
    institute_id: "ucsd",
    full_name: "UC San Diego",
  },
];

export const FALLBACK_SENSORS = [
  {
    sensor_id: "peppercanyon1",
    institute_id: "ucsd",
    area_name: "Pepper Canyon",
    corridor_name: "Pepper Canyon Corridor",
    latitude: 32.8801,
    longitude: -117.234,
    status: "active",
  },
];

const USE_LOCAL_DIRECTORY =
  import.meta.env.VITE_SENSOR_DIRECTORY_SOURCE === "local" ||
  !import.meta.env.VITE_SUPABASE_URL ||
  !import.meta.env.VITE_SUPABASE_ANON_KEY;

export const normalizeInstituteId = (instituteId) =>
  LEGACY_INSTITUTE_ALIASES[instituteId] || instituteId || "ucsd";

export const getFallbackDirectory = (instituteId) => {
  const normalizedInstituteId = normalizeInstituteId(instituteId);
  return {
    institutes: FALLBACK_INSTITUTES.filter(
      (institute) => institute.institute_id === normalizedInstituteId
    ),
    sensors: FALLBACK_SENSORS.filter(
      (sensor) => sensor.institute_id === normalizedInstituteId
    ),
  };
};

export const fetchSensorDirectory = async (supabase, instituteId) => {
  const normalizedInstituteId = normalizeInstituteId(instituteId);

  if (USE_LOCAL_DIRECTORY) {
    return getFallbackDirectory(normalizedInstituteId);
  }

  try {
    const instituteQuery = supabase
      .from("institutes")
      .select("institute_id, full_name");
    const sensorQuery = supabase
      .from("sensors")
      .select("sensor_id, institute_id, area_name, corridor_name, latitude, longitude, status")
      .order("area_name")
      .order("corridor_name");

    const [{ data: institutes, error: institutesError }, { data: sensors, error: sensorsError }] =
      await Promise.all([
        instituteId
          ? instituteQuery.eq("institute_id", normalizedInstituteId).maybeSingle()
          : instituteQuery.order("full_name"),
        instituteId
          ? sensorQuery.eq("institute_id", normalizedInstituteId)
          : sensorQuery,
      ]);

    if (institutesError) throw institutesError;
    if (sensorsError) throw sensorsError;

    return {
      institutes: instituteId ? (institutes ? [institutes] : []) : (institutes || []),
      sensors: sensors || [],
    };
  } catch (error) {
    console.warn("Using local sensor directory fallback:", error);
    return getFallbackDirectory(normalizedInstituteId);
  }
};

export const fetchSensorById = async (supabase, instituteId, sensorId) => {
  const normalizedInstituteId = normalizeInstituteId(instituteId);

  if (USE_LOCAL_DIRECTORY) {
    return FALLBACK_SENSORS.find(
      (sensor) =>
        sensor.institute_id === normalizedInstituteId &&
        sensor.sensor_id === sensorId
    ) || null;
  }

  try {
    const { data, error } = await supabase
      .from("sensors")
      .select("sensor_id, institute_id, area_name, corridor_name, latitude, longitude, status")
      .eq("institute_id", normalizedInstituteId)
      .eq("sensor_id", sensorId)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  } catch (error) {
    console.warn("Using local sensor fallback:", error);
    return FALLBACK_SENSORS.find(
      (sensor) =>
        sensor.institute_id === normalizedInstituteId &&
        sensor.sensor_id === sensorId
    ) || null;
  }
};
