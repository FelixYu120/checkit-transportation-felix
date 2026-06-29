export const DEFAULT_ANALYTICS_FILTERS = {
  startDate: '',
  endDate: '',
  startTime: '00:00',
  endTime: '23:59',
  dayPreset: 'all',
};

const isDefaultStartTime = (value) => !value || value === DEFAULT_ANALYTICS_FILTERS.startTime;
const isDefaultEndTime = (value) => !value || value === DEFAULT_ANALYTICS_FILTERS.endTime;

export const hasActiveTimeFilter = (filters) => (
  !isDefaultStartTime(filters?.startTime) || !isDefaultEndTime(filters?.endTime)
);

export const isSingleDateFilter = (filters) => {
  if (!filters?.startDate && !filters?.endDate) return false;

  const startDate = filters.startDate || filters.endDate;
  const endDate = filters.endDate || filters.startDate;
  return startDate === endDate;
};

const getLocalDateInputValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const createDateBound = (dateValue, fallbackHours, fallbackMinutes, fallbackSeconds, fallbackMilliseconds) => {
  if (!dateValue) return null;

  const date = new Date(`${dateValue}T00:00:00`);
  date.setHours(fallbackHours, fallbackMinutes, fallbackSeconds, fallbackMilliseconds);
  return date;
};

export const getDateBounds = (filters) => {
  const timeOnly = !filters?.startDate && !filters?.endDate && hasActiveTimeFilter(filters);
  if (!filters?.startDate && !filters?.endDate && !timeOnly) return {};

  const today = getLocalDateInputValue();
  const startDate = filters.startDate || filters.endDate || today;
  const endDate = filters.endDate || filters.startDate || today;

  return {
    start: createDateBound(startDate, 0, 0, 0, 0),
    end: createDateBound(endDate, 23, 59, 59, 999),
  };
};

export const getTimeMinutes = (value, fallback) => {
  if (!value) return fallback;
  if (!/^\d{1,2}:\d{2}$/.test(value)) return fallback;
  const [hours, minutes] = value.split(':').map(Number);
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return fallback;
  }

  return (hours * 60) + minutes;
};

export const getFilterTimeRange = (filters) => {
  const startMinutes = getTimeMinutes(filters?.startTime, 0);
  const endMinutes = getTimeMinutes(filters?.endTime, 1439);

  return { startMinutes, endMinutes };
};

export const matchesAnalyticsFilters = (row, filters) => {
  if (!filters) return true;

  const observedAt = new Date(row.observed_at);
  const { start, end } = getDateBounds(filters);

  if (start && observedAt < start) return false;
  if (end && observedAt > end) return false;

  const day = observedAt.getDay();
  if (filters.dayPreset === 'weekdays' && (day === 0 || day === 6)) return false;
  if (filters.dayPreset === 'weekends' && day !== 0 && day !== 6) return false;

  const { startMinutes, endMinutes } = getFilterTimeRange(filters);
  const currentMinutes = (observedAt.getHours() * 60) + observedAt.getMinutes();

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
};

export const applyAnalyticsFilters = (rows = [], filters) =>
  rows.filter((row) => matchesAnalyticsFilters(row, filters));

export const applyDateQueryBounds = (query, filters) => {
  const { start, end } = getDateBounds(filters);
  let nextQuery = query;

  if (start) nextQuery = nextQuery.gte('observed_at', start.toISOString());
  if (end) nextQuery = nextQuery.lte('observed_at', end.toISOString());

  return nextQuery;
};
