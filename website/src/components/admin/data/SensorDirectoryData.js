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
    last_seen_at: null,
    updated_at: null,
    speed_threshold: null,
    max_cap: null,
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
    speed_threshold: null,
    max_cap: null,
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

const dedupeSensorsById = (sensors = []) => {
  const byId = new Map();

  sensors.forEach((sensor) => {
    const sensorId = sensor?.sensor_id;
    if (!sensorId) return;
    if (!byId.has(sensorId)) {
      byId.set(sensorId, sensor);
      return;
    }

    byId.set(sensorId, {
      ...byId.get(sensorId),
      ...Object.fromEntries(
        Object.entries(sensor).filter(([, value]) => value !== null && value !== undefined && value !== "")
      ),
    });
  });

  return Array.from(byId.values());
};

const compactSupabaseError = (error) => [
  error?.code,
  error?.message,
  error?.details,
  error?.hint,
].filter(Boolean).join(" | ");

const isMissingColumnError = (error) =>
  error?.code === "42703" || /column .* does not exist|schema cache|could not find/i.test(compactSupabaseError(error));

const OPTIONAL_SENSOR_COLUMNS = [
  "needs_review",
  "created_at",
  "installation_notes",
  "wifi_ssid",
  "commissioned",
  "commissioned_at",
  "deployment_id",
  "paired_flash_serials",
  "hardware_serial",
  "heading_degrees",
  "speed_limit_kmh",
  "danger_speed_kmh",
  "emergency_speed_kmh",
  "speed_threshold",
  "max_cap",
  "speed_limit_threshold",
  "max_speed_cap_threshold",
];

const OPTIONAL_HEALTH_COLUMNS = [
  "last_seen_at",
  "updated_at",
  "last_radar_frame_at",
  "last_passage_at",
  "wifi_ssid",
  "wifi_rssi",
  "pending_passages",
  "storage_free_percent",
  "storage_errors",
  "radar_frame_errors",
  "last_http_status",
  "firmware_version",
  "model_version",
  "last_reset_reason",
  "provisioning_locked",
  "ble_active",
  "alerts",
];

const fetchOptionalColumns = async (supabase, tableName, idColumn, idValue, columns, sourceLabel) => {
  if (!supabase || !idValue) return {};

  const entries = await Promise.all(columns.map(async (column) => {
    try {
      const { data, error } = await supabase
        .from(tableName)
        .select(`${idColumn}, ${column}`)
        .eq(idColumn, idValue)
        .maybeSingle();

      if (error) {
        if (isMissingColumnError(error)) return null;
        console.warn(`Unable to load ${sourceLabel} column ${column}:`, getSupabaseErrorContext(error));
        return null;
      }

      return [column, data?.[column] ?? null];
    } catch (error) {
      console.warn(`Unable to load ${sourceLabel} column ${column}:`, getSupabaseErrorContext(error));
      return null;
    }
  }));

  return entries.reduce((acc, entry) => {
    if (!entry) return acc;
    const [key, value] = entry;
    acc[key] = value;
    return acc;
  }, {});
};

const fetchSensorMetadata = async (supabase, sensorId) =>
  fetchOptionalColumns(supabase, "sensors", "sensor_id", sensorId, OPTIONAL_SENSOR_COLUMNS, "transportation sensor metadata");

const fetchSensorHealth = async (supabase, sensorId) => {
  const health = await fetchOptionalColumns(
    supabase,
    "device_health",
    "sensor_id",
    sensorId,
    OPTIONAL_HEALTH_COLUMNS,
    "transportation sensor health"
  );

  return Object.fromEntries(Object.entries(health).map(([key, value]) => [`health_${key}`, value]));
};

const querySensorRows = async (supabase, instituteId, sensorId) => {
  const selectAttempts = [
    "sensor_id, institute_id, area_name, corridor_name, latitude, longitude, status, needs_review, created_at, last_seen_at, updated_at, speed_limit_kmh, danger_speed_kmh, emergency_speed_kmh, installation_notes, wifi_ssid, commissioned, commissioned_at, deployment_id, paired_flash_serials",
    "sensor_id, institute_id, area_name, corridor_name, latitude, longitude, status, needs_review, created_at, last_seen_at, updated_at, speed_threshold, max_cap, installation_notes, wifi_ssid, commissioned, commissioned_at, deployment_id, paired_flash_serials",
    "sensor_id, institute_id, area_name, corridor_name, latitude, longitude, status, last_seen_at, updated_at, speed_threshold, max_cap",
    "sensor_id, institute_id, area_name, corridor_name, latitude, longitude, status, last_seen_at, updated_at, speed_limit_threshold, max_speed_cap_threshold",
    "sensor_id, institute_id, area_name, corridor_name, latitude, longitude, status, updated_at, speed_threshold, max_cap",
    "sensor_id, institute_id, area_name, corridor_name, latitude, longitude, status, updated_at, speed_limit_threshold, max_speed_cap_threshold",
    "sensor_id, institute_id, area_name, corridor_name, latitude, longitude, status, speed_threshold, max_cap",
    "sensor_id, institute_id, area_name, corridor_name, latitude, longitude, status, speed_limit_threshold, max_speed_cap_threshold",
    "sensor_id, institute_id, area_name, corridor_name, latitude, longitude, status, last_seen_at, updated_at",
    "sensor_id, institute_id, area_name, corridor_name, latitude, longitude, status, updated_at",
    "sensor_id, institute_id, area_name, corridor_name, latitude, longitude, status",
    "sensor_id, institute_id, area_name, corridor_name, latitude, longitude",
    "sensor_id, institute_id, area_name, corridor_name",
  ];

  let lastError = null;

  for (const selectColumns of selectAttempts) {
    let query = supabase
      .from("sensors")
      .select(selectColumns)
      .order("area_name")
      .order("corridor_name");

    if (instituteId) query = query.eq("institute_id", normalizeInstituteId(instituteId));
    if (sensorId) query = query.eq("sensor_id", sensorId);

    const { data, error } = sensorId ? await query.maybeSingle() : await query;
    if (!error) return data;

    lastError = error;
    if (!isMissingColumnError(error)) break;
  }

  throw lastError;
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

    const [{ data: institutes, error: institutesError }, sensors] =
      await Promise.all([
        instituteId
          ? instituteQuery.eq("institute_id", normalizedInstituteId).maybeSingle()
          : instituteQuery.order("full_name"),
        querySensorRows(supabase, instituteId),
      ]);

    if (institutesError) throw institutesError;

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
      sensors: dedupeSensorsById(sensors || []),
    };
  } catch (error) {
    console.warn("Using generated sensor directory fallback:", getSupabaseErrorContext(error));
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
    const sensor = await querySensorRows(supabase, normalizedInstituteId, sensorId) || null;
    if (!sensor) return null;

    const [metadata, health] = await Promise.all([
      fetchSensorMetadata(supabase, sensor.sensor_id),
      fetchSensorHealth(supabase, sensor.sensor_id),
    ]);

    return {
      ...sensor,
      ...metadata,
      ...health,
      last_seen_at: sensor.last_seen_at || health.health_last_seen_at || null,
      updated_at: sensor.updated_at || health.health_updated_at || null,
      wifi_ssid: sensor.wifi_ssid || metadata.wifi_ssid || health.health_wifi_ssid || null,
    };
  } catch (error) {
    console.warn("Using generated sensor fallback:", getSupabaseErrorContext(error));
    const inferredSensor = await getSensorFromSummaryRows(supabase, normalizedInstituteId, sensorId);
    if (inferredSensor) return inferredSensor;

    return FALLBACK_SENSORS.find(
      (sensor) =>
        sensor.institute_id === normalizedInstituteId &&
        sensor.sensor_id === sensorId
    ) || null;
  }
};
