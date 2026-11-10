export const REPORT_METRICS = {
  transportation: [
    ['total', 'Total movements', 'movements', 'Sum of observed movements in the selected report window.'],
    ['averageSpeed', 'Average speed', 'mph', 'Volume-weighted speed from the recorded traffic summaries.'],
    ['v85Speed', '85th percentile speed', 'mph', 'Aggregated summary percentiles; not a percentile recomputed from all individual passages.'],
    ['maxSpeed', 'Maximum speed', 'mph', 'Highest recorded speed in the selected window.'],
    ['peak', 'Peak movement period', 'movements', 'Highest movement count among the displayed periods.'],
    ['approachShare', 'Approach share', '%', 'Share of recorded directional movements approaching the sensor.'],
  ],
  occupancy: [
    ['current', 'Latest point', 'people', 'Most recent estimated people count in the selected window.'],
    ['average', 'Average people', 'people', 'Average estimated people count over the available observations.'],
    ['peak', 'Peak people', 'people', 'Highest estimated people count in the selected window.'],
    ['avgOccupancy', 'Capacity utilization', '%', 'Average estimated usage relative to the configured capacity; requires a valid capacity.'],
    ['occupancyRate', 'Occupancy rate', '%', 'Share of observed periods with occupancy; missing observations are not evidence of an empty room.'],
    ['typicalDwellTime', 'Typical dwell time', 'duration', 'Duration estimated from recorded occupancy sessions, where session data is available.'],
    ['turnoverRate', 'Sessions', 'sessions or sessions/day', 'Total sessions for daily/custom reports; average sessions per day for weekly, monthly, by-weekday, and by-hour reports.'],
  ],
};

export const DECISION_QUESTIONS = {
  transportation: {
    default: 'When is this corridor busiest, and where should operations focus?',
    operations: 'Which hours need a change to staffing, access, or traffic management?',
    'trend-review': 'When are recorded speeds highest, and what warrants a safety review?',
    'executive-compare': 'Which corridors need attention during peak activity?',
    'corridor-benchmark': 'How do comparable corridors differ in volume and speed?',
  },
  occupancy: {
    default: 'When is this space busiest, and do its operating hours fit demand?',
    operations: 'When should facilities adjust staffing, cleaning, or opening hours?',
    'trend-review': 'Which periods show low observed use, and what should we investigate?',
    'executive-compare': 'Which spaces experience the highest demand?',
    'room-benchmark': 'How do comparable spaces differ in their observed use?',
  },
};

export const getDecisionQuestion = (product, template, mode = 'solo') => (
  template === 'blank' ? '' : mode === 'comparison' && template === 'default'
    ? 'What changed between these locations or periods, and what should we do next?'
    : DECISION_QUESTIONS[product]?.[template] || ''
);

// Derived only from observations and visible buckets; never infer sensor uptime.
export const buildChartEvidence = ({ rows = [], points = [], sources = [], timezone, filters = {}, timeframe, generatedAt = new Date().toISOString(), completeBucketRange = false, isDemo = false }) => {
  const timestamps = rows.map(row => row.observed_at || row.time_bucket)
    .map(value => value ? new Date(value).getTime() : NaN).filter(Number.isFinite);
  const observed = points.filter(point => point.hasData !== false && !point.blank);
  const explicitBuckets = points.length > 0 && points.every(point => typeof point.hasData === 'boolean' || point.blank);
  const sourceIds = [...new Set(rows.map(row => row.sensor_id || row.room_id).filter(Boolean).map(String))];
  return {
    version: 1, generatedAt, sources, isDemo, timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    filters: { ...filters }, timeframe, sourceRows: rows.length,
    firstObservedAt: timestamps.length ? new Date(timestamps.reduce((a,b) => Math.min(a,b), Infinity)).toISOString() : null,
    lastObservedAt: timestamps.length ? new Date(timestamps.reduce((a,b) => Math.max(a,b), -Infinity)).toISOString() : null,
    reportingSourceIds: sourceIds, observedBuckets: observed.length,
    missingBuckets: explicitBuckets && (completeBucketRange || points.some(point => point.hasData === false)) ? points.filter(point => point.hasData === false && !point.blank).length : null,
    coverageNote: 'Displayed bucket availability is not sensor uptime. Missing periods must not be interpreted as zero activity.',
  };
};

export const getReportEvidence = (elements = []) => elements.filter(element => element.type === 'chart').map(element => ({
  id: element.id, title: element.title || element.chartTitle || 'Chart',
  evidence: element.dataEvidence || null,
  hasSnapshot: Array.isArray(element.snapshotData) && element.snapshotData.length > 0,
}));

export const mergeChartEvidence = (items = []) => {
  const entries = items.filter(Boolean);
  const dates = (key, descending = false) => entries.map(item => item[key]).filter(Boolean).sort((a,b) => descending ? b.localeCompare(a) : a.localeCompare(b))[0] || null;
  return {
    version: 1, generatedAt: new Date().toISOString(), isDemo: entries.some(item => item.isDemo),
    timezone: entries[0]?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    sources: [...new Set(entries.flatMap(item => item.sources || []))],
    firstObservedAt: dates('firstObservedAt'), lastObservedAt: dates('lastObservedAt', true),
    sourceRows: entries.reduce((total,item) => total + item.sourceRows, 0),
    reportingSourceIds: [...new Set(entries.flatMap(item => item.reportingSourceIds || []))],
    observedBuckets: entries.reduce((total,item) => total + item.observedBuckets, 0),
    missingBuckets: entries.every(item => item.missingBuckets != null) ? entries.reduce((total,item) => total + item.missingBuckets, 0) : null,
    timeframe: entries[0]?.timeframe, filters: entries[0]?.filters || {},
    series: entries,
  };
};

export const compareReportVersions = (baseline, followup, product) => {
  const left = baseline?.snapshot?.layout_data;
  const right = followup?.snapshot?.layout_data;
  if (!left || !right) return { warning: 'Choose two saved versions to compare.', rows: [] };
  const scope = layout => JSON.stringify({ selections: layout.selections, comparisonSelections: layout.comparisonSelections,
    charts: (layout.elements || []).filter(item => item.type === 'chart').map(item => ({ id: item.id, selections: item.selections, comparisonSelections: item.comparisonSelections, comparisonSelectionList: item.comparisonSelectionList })) });
  const warnings = [];
  if (scope(left) !== scope(right)) warnings.push('The selected locations differ. Interpret the results in that context.');
  const filters = layout => JSON.stringify(['timeframe', 'startTime', 'endTime', 'dayPreset'].map(key => layout.reportSettings?.[key]));
  if (filters(left) !== filters(right)) warnings.push('The aggregation or time-of-day filters differ.');
  const periodDays = layout => {
    const start = layout.reportSettings?.startDate; const end = layout.reportSettings?.endDate;
    if (!start || !end) return null;
    return Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  };
  if (periodDays(left) != null && periodDays(right) != null && periodDays(left) !== periodDays(right)) warnings.push('The report windows have different numbers of days.');
  const summarize = layout => (layout.elements || []).filter(item => item.type === 'summary' && item.snapshotData && !Array.isArray(item.snapshotData));
  const rows = [];
  if (left.reportSettings?.metricDefinitionVersion !== right.reportSettings?.metricDefinitionVersion) {
    return { warning: 'The metric definitions changed between these versions. Open each version to inspect its saved definitions before comparing.', rows };
  }
  for (const before of summarize(left)) {
    const after = summarize(right).find(item => item.id === before.id);
    if (!after) continue;
    for (const [key, label, unit] of left.reportSettings?.metricDefinitions || REPORT_METRICS[product] || []) {
      if (key === 'typicalDwellTime') continue; // Its display value may be a formatted duration.
      const sessionsUnit = layout => ['weekly','monthly','weekday','hourOfDay'].includes(layout.reportSettings?.timeframe || 'weekly') ? 'sessions/day' : 'sessions';
      if (key === 'turnoverRate' && sessionsUnit(left) !== sessionsUnit(right)) continue;
      const a = before.snapshotData[key]; const b = after.snapshotData[key];
      if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) continue;
      rows.push({ key: `${before.id}-${key}`, label, unit: key === 'turnoverRate' ? sessionsUnit(left) : unit, before: a, after: b, difference: b - a });
    }
  }
  if (!rows.length) warnings.push('These versions have no matching saved numeric summary metrics. Open each version to inspect its charts.');
  warnings.push('A before/after difference does not by itself establish the effect of an intervention. Check dates, coverage, and other changes.');
  return { warning: warnings.join(' '), rows };
};

export const workflowErrorMessage = error => /PGRST202|42P01|function .* does not exist/i.test(`${error?.code} ${error?.message}`)
  ? 'Report review is not available until the report-workflow database update is installed.'
  : error?.message || 'The report workspace could not connect. Please try again.';

export const loadReportWorkspace = async (client, reportId) => {
  const { data, error } = await client.rpc('insights_report_workspace', { p_report_id: reportId });
  if (error) throw error;
  if (!data) throw new Error('The report workspace did not return a result.');
  return data;
};

export const runReportCommand = async (client, reportId, command, payload = {}) => {
  const { data, error } = await client.rpc('insights_report_command', { p_report_id: reportId, p_command: command, p_payload: payload });
  if (error) throw error;
  return data;
};

export const loadReportVersion = async (client, reportId, versionId) => {
  const { data, error } = await client.from('insight_report_versions').select('*')
    .eq('report_id', reportId).eq('id', versionId).single();
  if (error) throw error;
  if (!data?.snapshot) throw new Error('The saved version is unavailable.');
  return data;
};
