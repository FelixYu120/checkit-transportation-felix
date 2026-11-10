export const normalizeStudioRole = (role) => {
  const value = String(role || 'viewer').trim().toLowerCase() || 'viewer';
  return value === 'user' ? 'viewer' : value;
};

export const getComparableReportState = (reportState, docMeta = {}) => {
  const settings = { ...(reportState.reportSettings || {}) };
  delete settings.lastSavedAt;
  delete settings.lastSavedBy;
  return {
    ...reportState,
    elements: (reportState.elements || []).map((element) => {
      const stable = { ...element };
      delete stable.snapshotData;
      delete stable.snapshotKey;
      delete stable.dataEvidence;
      return stable;
    }),
    reportSettings: settings,
    docMeta: {
      title: docMeta.title || '', author: docMeta.author || '',
      date: docMeta.date || '', period: docMeta.period || '',
    },
  };
};

export const getCheckpointDocMeta = (checkpoint, fallback = {}) => {
  try { return JSON.parse(checkpoint)?.docMeta || fallback; } catch { return fallback; }
};

export const applyTextDraftsToLayout = (elements = [], drafts = {}) => elements.map((element) => (
  element.type === 'text' && typeof drafts[element.id] === 'string'
    ? { ...element, html: drafts[element.id] }
    : element
));

export const decodeReportLayout = (value) => {
  let layout = value;
  if (typeof layout === 'string') {
    try { layout = JSON.parse(layout); } catch { return null; }
  }
  const elements = Array.isArray(layout) ? layout : layout?.elements;
  if (!Array.isArray(elements) || elements.some((element) => !element || typeof element !== 'object' || Array.isArray(element))) {
    return null;
  }
  return layout;
};

export const normalizeReportPageCount = (value, required = 1) => {
  const count = Number(value);
  return Math.max(required, Number.isSafeInteger(count) && count > 0 ? count : 1);
};

// Data provenance lives in Report details. Remove its old generated widget and
// close only pages that contained no other report content. Saved input is kept
// intact so historical snapshots and user-authored notes are never rewritten.
export const removeReportDataNotes = (elements = [], pageCount = 1, pageHeight = 1200) => {
  const notes = elements.filter(element => element.type === 'data-notes');
  if (!notes.length) return { elements, pageCount };
  const kept = elements.filter(element => element.type !== 'data-notes');
  const pagesFor = element => {
    const y = Math.max(0, Number(element.y) || 0);
    const height = Math.max(1, Number(element.height) || 1);
    const start = Math.floor(y / pageHeight);
    const end = Math.floor((y + height - 1) / pageHeight);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  };
  const occupiedPages = new Set(kept.flatMap(pagesFor));
  const removedPages = [...new Set(notes.flatMap(pagesFor))].filter(page => !occupiedPages.has(page)).sort((a,b) => a-b);
  const originalCount = normalizeReportPageCount(pageCount, Math.max(1, ...elements.flatMap(pagesFor).map(page => page + 1)));
  return {
    elements: kept.map(element => {
      const offset = removedPages.filter(page => page < Math.floor((Number(element.y) || 0) / pageHeight)).length * pageHeight;
      return offset ? { ...element, y: Number(element.y) - offset } : element;
    }),
    pageCount: Math.max(1, originalCount - removedPages.length),
  };
};

export const hasSelectionValue = (selections = {}) => Boolean(
  selections?.areaId || selections?.buildingId || selections?.roomId
  || (selections?.floorNumber !== '' && selections?.floorNumber != null)
);

export const inferReportModeFromLayout = (layout) => {
  if (!layout) return 'solo';
  if (['solo', 'comparison'].includes(layout.mode)) return layout.mode;
  if (hasSelectionValue(layout.comparisonSelections)) return 'comparison';
  if ((layout.elements || []).some((element) => (
    hasSelectionValue(element.comparisonSelections)
    || (Array.isArray(element.comparisonSelectionList) && element.comparisonSelectionList.some(hasSelectionValue))
  ))) return 'comparison';
  return 'solo';
};

// Repeated clicks join the same write instead of inserting duplicate reports.
export const createSingleFlightTask = () => {
  let pending = null;
  return (task) => {
    if (pending) return pending;
    pending = Promise.resolve().then(task).then(
      (value) => { pending = null; return value; },
      (error) => { pending = null; throw error; },
    );
    return pending;
  };
};

export const saveReportRecord = async (client, { reportId, payload, user }) => {
  if (!user?.id) throw new Error('Sign in again before saving this report.');
  const query = reportId
    ? client.from('saved_reports').update(payload).eq('id', reportId)
    : client.from('saved_reports').insert([{ ...payload, owner_id: user.id }]);
  const { data, error } = await query.select('id').single();
  if (error) throw error;
  if (!data?.id) throw new Error('The report was not saved.');
  return String(data.id);
};

export const waitForReportReady = async (element, timeoutMs = 8000, pollMs = 100) => {
  if (!element) return false;
  const startedAt = Date.now();
  while (element.querySelector('[data-report-loading="true"]')) {
    if (Date.now() - startedAt >= timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return true;
};

export const requireReportReady = async (element, timeoutMs = 8000) => {
  if (!await waitForReportReady(element, timeoutMs)) {
    throw new Error('Charts are still loading. Try again once they finish.');
  }
};
