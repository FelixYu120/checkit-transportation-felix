import { useEffect, useState } from 'react';
import supabase from '../../helper/SupabaseClients';

export default function useSensorHeartbeats(sensors) {
  const sensorIdsKey = JSON.stringify([...new Set(sensors.map((sensor) => sensor.sensor_id).filter(Boolean))].sort());
  const [heartbeats, setHeartbeats] = useState(() => new Map());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const sensorIds = JSON.parse(sensorIdsKey);
    if (!supabase || !sensorIds.length) return undefined;
    let disposed = false;
    let loading = false;
    let pending = false;
    const refresh = async () => {
      if (disposed) return;
      if (loading) { pending = true; return; }
      loading = true;
      try {
        // Batch health queries; never issue one request per lane.
        const batches = [];
        for (let offset = 0; offset < sensorIds.length; offset += 200) {
          const ids = sensorIds.slice(offset, offset + 200);
          batches.push((async () => {
            const { data, error } = await supabase.from('sensor_health')
              .select('sensor_id, last_seen_at').in('sensor_id', ids);
            if (error) throw error;
            const rows = new Map((data || []).map((row) => [row.sensor_id, row.last_seen_at || null]));
            return ids.map((id) => [id, rows.get(id) || null]);
          })());
        }
        const results = await Promise.allSettled(batches);
        if (disposed) return;
        setHeartbeats((current) => {
          const next = new Map(current);
          for (const result of results) {
            // Preserve the last known heartbeat on network failure; it still ages normally.
            if (result.status === 'fulfilled') {
              result.value.forEach(([id, value]) => next.set(id, value));
            }
          }
          return next;
        });
        setNow(Date.now());
      } finally {
        loading = false;
        if (pending && !disposed) { pending = false; void refresh(); }
      }
    };

    const interval = setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 10000);
    const channel = supabase.channel(`lane-heartbeats-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sensor_health' }, refresh)
      .subscribe();
    window.addEventListener('focus', refresh);
    void refresh();
    return () => {
      disposed = true;
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
      void supabase.removeChannel(channel);
    };
  }, [sensorIdsKey]);

  return { heartbeats, now };
}
