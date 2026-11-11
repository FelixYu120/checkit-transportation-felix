export const normalizeSensorIds = (ids = []) => [...new Set(ids
  .filter(id => typeof id === 'string' || typeof id === 'number')
  .map(id => String(id).trim()).filter(Boolean))].sort();

// Read genuine check-ins only. A successful empty result clears old health;
// failed batches preserve their last known check-in in the caller.
export async function fetchSensorHeartbeats(client, sensorIds, { table, idColumn }) {
  const ids = normalizeSensorIds(sensorIds);
  const updates = new Map();
  const unavailable = new Set();
  const batches = [];
  for (let offset = 0; offset < ids.length; offset += 200) batches.push(ids.slice(offset, offset + 200));
  const results = await Promise.allSettled(batches.map(async batch => {
    if (!client) throw new Error('Health connection unavailable');
    const { data, error } = await client.from(table).select(`${idColumn}, last_seen_at`).in(idColumn, batch);
    if (error) throw error;
    const rows = new Map((data || []).map(row => [String(row[idColumn]).trim(), row.last_seen_at || null]));
    return batch.map(id => [id, rows.get(id) || null]);
  }));
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') result.value.forEach(([id, timestamp]) => updates.set(id, timestamp));
    else batches[index].forEach(id => unavailable.add(id));
  });
  return { updates, unavailable };
}
