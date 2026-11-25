import { useEffect, useRef, useState } from 'react';

const DEFAULTS = { sidebarCollapsed: false, dataShare: 0.63 };
const DIVIDER_WIDTH = 12;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const splitBounds = width => {
  const available = Math.max(1, width - DIVIDER_WIDTH);
  const min = Math.min(0.63, Math.max(0.5, 360 / available));
  return { min, max: Math.max(min, Math.min(0.7, 1 - 300 / available)) };
};

function readPreferences(key) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key));
    return {
      sidebarCollapsed: saved?.sidebarCollapsed === true,
      dataShare: Number.isFinite(saved?.dataShare) ? clamp(saved.dataShare, 0.5, 0.7) : DEFAULTS.dataShare,
    };
  } catch { return DEFAULTS; }
}

export default function usePortalPanels(storageKey) {
  const workspaceRef = useRef(null);
  const drag = useRef(null);
  const [preferences, setPreferences] = useState(() => readPreferences(storageKey));
  const [resizing, setResizing] = useState(false);
  const [bounds, setBounds] = useState({ min: 0.5, max: 0.7 });
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 961px)').matches);

  useEffect(() => {
    if (resizing) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(preferences)); }
    catch { /* Resizing remains available when browser storage is blocked. */ }
  }, [preferences, resizing, storageKey]);

  useEffect(() => {
    const measure = () => {
      const wide = window.matchMedia('(min-width: 961px)').matches;
      setDesktop(wide);
      if (!wide) return;
      const width = workspaceRef.current?.getBoundingClientRect().width;
      if (!(width > DIVIDER_WIDTH)) return;
      const next = splitBounds(width);
      setBounds(current => current.min === next.min && current.max === next.max ? current : next);
      setPreferences(current => {
        const dataShare = clamp(current.dataShare, next.min, next.max);
        return dataShare === current.dataShare ? current : { ...current, dataShare };
      });
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    const media = window.matchMedia('(min-width: 961px)');
    if (workspaceRef.current) observer?.observe(workspaceRef.current);
    const frame = window.requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    media.addEventListener?.('change', measure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      media.removeEventListener?.('change', measure);
    };
  }, []);

  useEffect(() => {
    const applyMove = () => {
      const current = drag.current;
      if (!current || current.clientX == null) return;
      current.frame = null;
      const rect = workspaceRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= DIVIDER_WIDTH) return;
      const { min, max } = splitBounds(rect.width);
      const dataShare = clamp((current.clientX - rect.left - DIVIDER_WIDTH / 2) / (rect.width - DIVIDER_WIDTH), min, max);
      setPreferences(value => value.dataShare === dataShare ? value : { ...value, dataShare });
    };
    const end = (cancel = false) => {
      const current = drag.current;
      if (!current) return;
      if (current.frame != null) window.cancelAnimationFrame(current.frame);
      if (!cancel) applyMove();
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
      current.clientX = event.clientX;
      if (current.frame == null) current.frame = window.requestAnimationFrame(applyMove);
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
        if (current.frame != null) window.cancelAnimationFrame(current.frame);
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

  const startResize = event => {
    if (event.button !== 0 || drag.current || !window.matchMedia('(min-width: 961px)').matches) return;
    event.preventDefault();
    event.currentTarget.focus();
    drag.current = { pointerId: event.pointerId, initial: preferences, frame: null, clientX: null,
      cursor: document.body.style.cursor, userSelect: document.body.style.userSelect };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    setResizing(true);
  };

  const resizeWithKeyboard = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    setPreferences(current => {
      const step = 0.02 * (event.shiftKey ? 5 : 1);
      const next = event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max : current.dataShare + direction * step;
      return { ...current, dataShare: clamp(next, bounds.min, bounds.max) };
    });
  };

  const resetPanel = () => setPreferences(current => ({ ...current,
    dataShare: clamp(DEFAULTS.dataShare, bounds.min, bounds.max),
  }));
  const toggleSidebar = () => setPreferences(current => ({ ...current, sidebarCollapsed: !current.sidebarCollapsed }));

  return { ...preferences, bounds, desktop, resizing, workspaceRef, startResize, resizeWithKeyboard, resetPanel, toggleSidebar };
}
