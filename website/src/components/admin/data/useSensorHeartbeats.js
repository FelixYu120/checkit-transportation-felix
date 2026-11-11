import { useEffect, useState } from 'react';
import supabase from '../../helper/SupabaseClients';
import { fetchSensorHeartbeats, normalizeSensorIds } from './SensorHeartbeatData.js';

const HEALTH_SOURCE = { table: 'sensor_health', idColumn: 'sensor_id' };

export default function useSensorHeartbeats(sensors = []) {
  const sensorIdsKey = JSON.stringify(normalizeSensorIds(sensors.map(sensor => sensor[HEALTH_SOURCE.idColumn])));
  const [health, setHealth] = useState(() => ({ heartbeats: new Map(), unavailable: new Set() }));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const sensorIds = JSON.parse(sensorIdsKey);
    if (!sensorIds.length) return undefined;
    const wanted = new Set(sensorIds);
    let disposed = false;
    let loading = false;
    let pending = false;
    const refresh = async () => {
      if (disposed) return;
      if (loading) { pending = true; return; }
      loading = true;
      try {
        const result = await fetchSensorHeartbeats(supabase, sensorIds, HEALTH_SOURCE);
        if (disposed) return;
        setHealth(current => {
          const heartbeats = new Map([...current.heartbeats].filter(([id]) => wanted.has(id)));
          result.updates.forEach((timestamp, id) => heartbeats.set(id, timestamp));
          return { heartbeats, unavailable: result.unavailable };
        });
        setNow(Date.now());
      } finally {
        loading = false;
        if (pending && !disposed) { pending = false; void refresh(); }
      }
    };
    const interval = setInterval(() => { setNow(Date.now()); void refresh(); }, 10000);
    const channel = supabase?.channel(`sensor-heartbeats-${HEALTH_SOURCE.table}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: HEALTH_SOURCE.table }, (payload = {}) => {
        const id = payload.new?.[HEALTH_SOURCE.idColumn] || payload.old?.[HEALTH_SOURCE.idColumn];
        if (!id || wanted.has(String(id))) void refresh();
      }).subscribe();
    window.addEventListener('focus', refresh);
    void refresh();
    return () => {
      disposed = true;
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [sensorIdsKey]);

  return { ...health, now };
}
