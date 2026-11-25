import { useEffect, useRef, useState } from 'react';

const DEFAULTS = { sidebarWidth: 240, sidebarCollapsed: false, dataShare: 0.63 };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const splitBounds = width => ({
  min: Math.max(0.2, Math.min(0.5, 320 / Math.max(1, width - 8))),
  max: Math.min(0.8, Math.max(0.5, 1 - 280 / Math.max(1, width - 8))),
});

function readPreferences(key) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key));
    return {
      sidebarWidth: Number.isFinite(saved?.sidebarWidth) ? clamp(saved.sidebarWidth, 180, 360) : DEFAULTS.sidebarWidth,
      sidebarCollapsed: saved?.sidebarCollapsed === true,
      dataShare: Number.isFinite(saved?.dataShare) ? clamp(saved.dataShare, 0.2, 0.8) : DEFAULTS.dataShare,
    };
  } catch { return DEFAULTS; }
}

export default function usePortalPanels(storageKey) {
  const containerRef = useRef(null);
  const workspaceRef = useRef(null);
  const drag = useRef(null);
  const [preferences, setPreferences] = useState(() => readPreferences(storageKey));
  const [resizing, setResizing] = useState(false);
  const [bounds, setBounds] = useState({ min: 0.2, max: 0.8 });

  useEffect(() => {
    if (resizing) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(preferences)); }
    catch { /* Resizing remains available when browser storage is blocked. */ }
  }, [preferences, resizing, storageKey]);

  useEffect(() => {
    const measure = () => {
      if (!window.matchMedia('(min-width: 961px)').matches) return;
      const width = workspaceRef.current?.getBoundingClientRect().width;
      if (!(width > 8)) return;
      const next = splitBounds(width);
      setBounds(current => current.min === next.min && current.max === next.max ? current : next);
      setPreferences(current => {
        const dataShare = clamp(current.dataShare, next.min, next.max);
        return dataShare === current.dataShare ? current : { ...current, dataShare };
      });
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (workspaceRef.current) observer?.observe(workspaceRef.current);
    const frame = window.requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    const end = (cancel = false) => {
      const current = drag.current;
      if (!current) return;
      drag.current = null;
      document.body.style.cursor = current.cursor;
      document.body.style.userSelect = current.userSelect;
      if (cancel) setPreferences(current.initial);
      setResizing(false);
      window.dispatchEvent(new Event('resize'));
    };
    const move = event => {
      const current = drag.current;
      if (!current || event.pointerId !== current.pointerId) return;
      if (!window.matchMedia('(min-width: 961px)').matches) { end(); return; }
      if (current.kind === 'sidebar') {
        const left = containerRef.current?.getBoundingClientRect().left || 0;
        setPreferences(value => ({ ...value, sidebarWidth: clamp(event.clientX - left, 180, 360) }));
      } else {
        const rect = workspaceRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 8) return;
        const { min, max } = splitBounds(rect.width);
        setPreferences(value => ({ ...value, dataShare: clamp((event.clientX - rect.left - 4) / (rect.width - 8), min, max) }));
      }
    };
    const release = event => { if (event.pointerId === drag.current?.pointerId) end(event.type === 'pointercancel'); };
    const blur = () => end();
    const escape = event => {
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); end(true); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', escape);
    return () => {
      const current = drag.current;
      if (current) {
        document.body.style.cursor = current.cursor;
        document.body.style.userSelect = current.userSelect;
      }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', escape);
    };
  }, []);

  const startResize = (kind, event) => {
    if (event.button !== 0 || drag.current || !window.matchMedia('(min-width: 961px)').matches) return;
    event.preventDefault();
    event.currentTarget.focus();
    drag.current = { kind, pointerId: event.pointerId, initial: preferences,
      cursor: document.body.style.cursor, userSelect: document.body.style.userSelect };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    setResizing(true);
  };

  const resizeWithKeyboard = (kind, event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    setPreferences(current => {
      const sidebar = kind === 'sidebar';
      const min = sidebar ? 180 : bounds.min;
      const max = sidebar ? 360 : bounds.max;
      const key = sidebar ? 'sidebarWidth' : 'dataShare';
      const step = (sidebar ? 10 : 0.02) * (event.shiftKey ? 5 : 1);
      const next = event.key === 'Home' ? min : event.key === 'End' ? max : current[key] + direction * step;
      return { ...current, [key]: clamp(next, min, max) };
    });
  };

  const resetPanel = kind => setPreferences(current => ({ ...current,
    ...(kind === 'sidebar' ? { sidebarWidth: DEFAULTS.sidebarWidth } : { dataShare: clamp(DEFAULTS.dataShare, bounds.min, bounds.max) }),
  }));
  const toggleSidebar = () => setPreferences(current => ({ ...current, sidebarCollapsed: !current.sidebarCollapsed }));

  return { ...preferences, bounds, resizing, containerRef, workspaceRef, startResize, resizeWithKeyboard, resetPanel, toggleSidebar };
}
