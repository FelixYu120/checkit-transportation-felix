import { getSupabaseErrorContext, shouldUseLocalData } from "../../helper/SupabaseClients.jsx";

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

const USE_LOCAL_DIRECTORY = shouldUseLocalData;

export const normalizeInstituteId = (instituteId) =>
  LEGACY_INSTITUTE_ALIASES[instituteId] || instituteId || "ucsd";

const formatSensorLabel = (sensorId) =>
  String(sensorId || "")
    .replace(/([a-z])(\d)/gi, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Unknown Sensor";

const getFallbackSensor = (sensorId, instituteId) => {
  const normalizedInstituteId = normalizeInstituteId(instituteId);
  const knownSensor = FALLBACK_SENSORS.find((sensor) => sensor.sensor_id === sensorId);

  return {
    sensor_id: sensorId,
    area_name: "Transportation Sensors",
    corridor_name: formatSensorLabel(sensorId),
    latitude: null,
    longitude: null,
    status: "active",
    ...knownSensor,
    institute_id: knownSensor?.institute_id || normalizedInstituteId,
  };
};

const getFallbackInstitute = (instituteId) => {
  const normalizedInstituteId = normalizeInstituteId(instituteId);
  return FALLBACK_INSTITUTES.find(
    (institute) => institute.institute_id === normalizedInstituteId
  ) || {
    institute_id: normalizedInstituteId,
    full_name: formatSensorLabel(normalizedInstituteId),
  };
};

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

const getDirectoryFromSummaryRows = async (supabase, instituteId) => {
  const normalizedInstituteId = normalizeInstituteId(instituteId);

  if (!supabase) return getFallbackDirectory(normalizedInstituteId);

  try {
    const { data, error } = await supabase
      .from("ten_minute_summaries")
      .select("sensor_id")
      .limit(10000);

    if (error) throw error;

    const sensorIds = [...new Set((data || [])
      .map((row) => row.sensor_id)
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));

    if (!sensorIds.length) return getFallbackDirectory(normalizedInstituteId);

    return {
      institutes: [getFallbackInstitute(normalizedInstituteId)],
      sensors: sensorIds.map((sensorId) => getFallbackSensor(sensorId, normalizedInstituteId)),
    };
  } catch (error) {
    console.warn("Unable to infer sensor directory from summaries:", getSupabaseErrorContext(error));
    return getFallbackDirectory(normalizedInstituteId);
  }
};

const getSensorFromSummaryRows = async (supabase, instituteId, sensorId) => {
  if (!supabase || !sensorId) return null;

  try {
    const { data, error } = await supabase
      .from("ten_minute_summaries")
      .select("sensor_id")
      .eq("sensor_id", sensorId)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data?.sensor_id ? getFallbackSensor(data.sensor_id, instituteId) : null;
  } catch (error) {
    console.warn("Unable to infer sensor from summaries:", getSupabaseErrorContext(error));
    return null;
  }
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

    if (!sensors?.length) {
      const inferredDirectory = await getDirectoryFromSummaryRows(supabase, normalizedInstituteId);
      const instituteData = instituteId ? (institutes ? [institutes] : []) : (institutes || []);

      if (inferredDirectory.sensors.length) {
        return {
          institutes: instituteData.length ? instituteData : inferredDirectory.institutes,
          sensors: inferredDirectory.sensors,
        };
      }
    }

    return {
      institutes: instituteId ? (institutes ? [institutes] : []) : (institutes || []),
      sensors: sensors || [],
    };
  } catch (error) {
    console.warn("Using summary-derived sensor directory fallback:", getSupabaseErrorContext(error));
    return getDirectoryFromSummaryRows(supabase, normalizedInstituteId);
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
    console.warn("Using summary-derived sensor fallback:", getSupabaseErrorContext(error));
    const inferredSensor = await getSensorFromSummaryRows(supabase, normalizedInstituteId, sensorId);
    if (inferredSensor) return inferredSensor;

    return FALLBACK_SENSORS.find(
      (sensor) =>
        sensor.institute_id === normalizedInstituteId &&
        sensor.sensor_id === sensorId
    ) || null;
  }
};
