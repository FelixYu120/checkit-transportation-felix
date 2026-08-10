export const DEFAULT_ANALYTICS_FILTERS = {
  startDate: '',
  endDate: '',
  startTime: '00:00',
  endTime: '23:59',
  dayPreset: 'all',
};

const isDefaultStartTime = (value) => !value || value === DEFAULT_ANALYTICS_FILTERS.startTime;
const isDefaultEndTime = (value) => !value || value === DEFAULT_ANALYTICS_FILTERS.endTime;
const ANALYTICS_TIME_ZONE = 'America/Los_Angeles';
const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const analyticsDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ANALYTICS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});



const analyticsWeekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ANALYTICS_TIME_ZONE,
  weekday: 'short',
});

const getAnalyticsDateParts = (date) => (
  Object.fromEntries(
    analyticsDateTimeFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  )
);

const createAnalyticsDateInputValue = (date = new Date()) => {
  const parts = getAnalyticsDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const createAnalyticsDateBound = (dateValue, fallbackHours, fallbackMinutes, fallbackSeconds, fallbackMilliseconds) => {
  if (!dateValue) return null;

  if (dateValue instanceof Date) {
    const date = new Date(dateValue);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = getAnalyticsDateParts(date);
    return createAnalyticsDateBound(`${parts.year}-${parts.month}-${parts.day}`, fallbackHours, fallbackMinutes, fallbackSeconds, fallbackMilliseconds);
  }

  if (typeof dateValue !== 'string' || !DATE_INPUT_PATTERN.test(dateValue)) {
    const date = new Date(dateValue);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = getAnalyticsDateParts(date);
    return createAnalyticsDateBound(`${parts.year}-${parts.month}-${parts.day}`, fallbackHours, fallbackMinutes, fallbackSeconds, fallbackMilliseconds);
  }

  const [year, month, day] = dateValue.split('-').map(Number);
  const targetUtc = Date.UTC(year, month - 1, day, fallbackHours, fallbackMinutes, fallbackSeconds, fallbackMilliseconds);
  let utc = targetUtc;

  for (let index = 0; index < 3; index += 1) {
    const parts = getAnalyticsDateParts(new Date(utc));
    const renderedUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
      fallbackMilliseconds
    );
    const delta = targetUtc - renderedUtc;
    if (delta === 0) break;
    utc += delta;
  }

  return new Date(utc);
};

export const hasActiveTimeFilter = (filters) => (
  !isDefaultStartTime(filters?.startTime) || !isDefaultEndTime(filters?.endTime)
);

export const isSingleDateFilter = (filters) => {
  if (!filters?.startDate && !filters?.endDate) return false;

  const startDate = filters.startDate || filters.endDate;
  const endDate = filters.endDate || filters.startDate;
  return startDate === endDate;
};

export const getDateBounds = (filters) => {
  const timeOnly = !filters?.startDate && !filters?.endDate && hasActiveTimeFilter(filters);
  if (!filters?.startDate && !filters?.endDate && !timeOnly) return {};

  const today = createAnalyticsDateInputValue();
  const startDate = filters.startDate || filters.endDate || today;
  const endDate = filters.endDate || filters.startDate || today;

  return {
    start: createAnalyticsDateBound(startDate, 0, 0, 0, 0),
    end: createAnalyticsDateBound(endDate, 23, 59, 59, 999),
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

export const matchesAnalyticsDayFilter = (date, filters) => {
  if (!filters) return true;
  if (!Number.isFinite(date?.getTime?.())) return false;

  const weekday = analyticsWeekdayFormatter.format(date);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  if (filters.dayPreset === 'weekdays') return day !== 0 && day !== 6;
  if (filters.dayPreset === 'weekends') return day === 0 || day === 6;
  return true;
};

export const matchesAnalyticsTimeFilter = (date, filters) => {
  if (!Number.isFinite(date?.getTime?.())) return false;

  const { startMinutes, endMinutes } = getFilterTimeRange(filters);
  const parts = getAnalyticsDateParts(date);
  const currentMinutes = (Number(parts.hour) * 60) + Number(parts.minute);

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
};

export const matchesAnalyticsPeriodFilters = (row, filters) => {
  if (!filters) return true;

  const observedAt = new Date(row.observed_at);
  return matchesAnalyticsDayFilter(observedAt, filters) && matchesAnalyticsTimeFilter(observedAt, filters);
};

export const matchesAnalyticsFilters = (row, filters) => {
  if (!filters) return true;

  const observedAt = new Date(row.observed_at);
  const { start, end } = getDateBounds(filters);

  if (start && observedAt < start) return false;
  if (end && observedAt > end) return false;
  return matchesAnalyticsPeriodFilters(row, filters);
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
