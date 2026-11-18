// Saved chart data is document content. A newer cache key must never replace it.
export const hasReportSnapshot = element => element?.snapshotData != null;

const restoreTarget = (saved, fallback = {}) => {
  if (!saved) return fallback;
  return { ...fallback, ...saved,
    label: saved.label || (saved.id === fallback.id ? fallback.label : saved.id),
  };
};

export const getReportSnapshotContext = (element, current) => {
  if (!hasReportSnapshot(element)) return current;
  if (element.snapshotContext) return { ...current, ...element.snapshotContext };
  // Older reports recorded their query context in the key, before snapshotContext existed.
  try {
    const saved = JSON.parse(element.snapshotKey);
    if (!saved || typeof saved !== 'object') return current;
    return {
      ...current,
      mode: saved.mode || current.mode,
      timeframe: saved.timeframe || current.timeframe,
      filters: saved.filters || current.filters,
      target: saved.targetLevel ? restoreTarget({ level: saved.targetLevel, id: saved.targetId,
        floorNumber: saved.targetFloorNumber ?? '' }, current.target) : current.target,
      secondaryTarget: saved.secondaryTargetLevel ? restoreTarget({ level: saved.secondaryTargetLevel,
        id: saved.secondaryTargetId, floorNumber: saved.secondaryTargetFloorNumber ?? '' }, current.secondaryTarget) : current.secondaryTarget,
      targets: saved.targets?.length ? saved.targets.map((target, index) => restoreTarget(target,
        current.targets?.find(candidate => candidate.id === target.id && candidate.floorNumber === target.floorNumber) || current.targets?.[index])) : current.targets,
    };
  } catch { return current; }
};

// Refreshing a chart also refreshes the summaries that derive their values from it.
export const refreshReportSnapshots = (elements, id = null) => elements.map(element => {
  if (!['chart', 'summary'].includes(element.type)) return element;
  if (id && element.id !== id && element.attachedChartId !== id) return element;
  return { ...element, snapshotData: undefined, snapshotKey: undefined, snapshotContext: undefined,
    dataEvidence: undefined, snapshotRefreshRevision: (element.snapshotRefreshRevision || 0) + 1 };
});

export const captureReportSnapshot = (element, { key, data, evidence, context, revision = 0 }) => {
  // Ignore a late response from a previous refresh, and capture each result only once.
  if (hasReportSnapshot(element) || (element.snapshotRefreshRevision || 0) !== revision || data == null) return element;
  return { ...element, snapshotKey: key, snapshotData: data, snapshotContext: context,
    ...(evidence ? { dataEvidence: evidence } : {}) };
};
