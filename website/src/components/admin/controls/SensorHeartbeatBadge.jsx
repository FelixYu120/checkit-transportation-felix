import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSensorHeartbeatPresentation } from '../data/SensorHeartbeatPresentation.js';
import { getHeartbeatStatusSince } from '../../../sensorHeartbeat.js';
import styles from './SensorHeartbeatBadge.module.css';

const STATUS_OPTIONS = [
  { key: 'active', label: 'Active' },
  { key: 'down', label: 'Down' },
  { key: 'offline', label: 'Offline' },
];

function StatusDateIndicator({ dateLabel, since, children, className, ...statusProps }) {
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const closeTimer = useRef(null);
  const tooltipId = useId();
  const show = () => {
    clearTimeout(closeTimer.current);
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(304, window.innerWidth - 24);
    const below = rect.top < 96;
    setPosition({
      width,
      left: Math.min(Math.max(rect.left + rect.width / 2, width / 2 + 12), window.innerWidth - width / 2 - 12),
      top: below ? rect.bottom + 8 : rect.top - 8,
      transform: below ? 'translateX(-50%)' : 'translate(-50%, -100%)',
    });
  };
  const scheduleClose = event => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof window.Node && (tooltipRef.current?.contains(nextTarget) || triggerRef.current?.contains(nextTarget))) return;
    if (event.type === 'mouseleave' && document.activeElement === triggerRef.current) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setPosition(null), 120);
  };
  const open = Boolean(position);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setPosition(null);
    const outside = event => {
      if (!triggerRef.current?.contains(event.target) && !tooltipRef.current?.contains(event.target)) close();
    };
    const keydown = event => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keydown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keydown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return <>
    <button {...statusProps} ref={triggerRef} type="button" title="" className={`${className} ${styles.dateTrigger}`}
      data-status-since={since} aria-label={dateLabel} aria-describedby={open ? tooltipId : undefined}
      onMouseEnter={show} onMouseLeave={scheduleClose} onFocus={show} onBlur={scheduleClose} onClick={show}>
      {children}
    </button>
    {position && createPortal(<div ref={tooltipRef} id={tooltipId} role="tooltip" className={styles.tooltip} style={position}
      onMouseEnter={() => clearTimeout(closeTimer.current)} onMouseLeave={scheduleClose}>
      <strong>{dateLabel}</strong>
    </div>, document.body)}
  </>;
}

export default function SensorHeartbeatBadge({ sensorId, state, showLabel = false, dotOnly = false }) {
  const id = sensorId == null ? '' : String(sensorId).trim();
  if (!id || !state.heartbeats.has(id)) return null;
  const heartbeat = getSensorHeartbeatPresentation({ health_last_seen_at: state.heartbeats.get(id) }, state.now);
  if (!heartbeat.timestamp) return null;
  const currentLabel = STATUS_OPTIONS.find(option => option.key === heartbeat.status)?.label;
  const statusSince = getHeartbeatStatusSince(heartbeat.timestamp, state.now);
  const statusDateLabel = statusSince ? `${currentLabel} since ${new Date(statusSince).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })}` : '';
  if (dotOnly) {
    const props = { className: `${styles.indicator} ${styles.compact}`, 'data-status': heartbeat.status, 'data-state': heartbeat.status, 'aria-current': 'true' };
    const dot = <span className={styles.dot} aria-hidden="true" />;
    return statusSince
      ? <StatusDateIndicator {...props} dateLabel={statusDateLabel} since={statusSince}>{dot}</StatusDateIndicator>
      : <span {...props} role="img" aria-label={`Sensor status: ${currentLabel}`}>{dot}</span>;
  }
  return <div className={styles.root} data-status={heartbeat.status} role="group" aria-label={`Sensor status: ${currentLabel}`}
    title={state.unavailable?.has(id) ? 'Last known status; refresh unavailable' : undefined}>
    <div className={styles.indicators}>
      {showLabel && <strong className={styles.label}>Sensor Status:</strong>}
      {STATUS_OPTIONS.filter(option => option.key === heartbeat.status).map(option => {
        const current = heartbeat.status === option.key;
        const indicatorProps = { className: styles.indicator, 'data-state': option.key, 'aria-current': current ? 'true' : undefined };
        const content = <><span className={styles.dot} aria-hidden="true" />{option.label}</>;
        return current && statusSince
          ? <StatusDateIndicator key={`${id}-${option.key}`} {...indicatorProps} dateLabel={statusDateLabel} since={statusSince}>{content}</StatusDateIndicator>
          : <span key={option.key} {...indicatorProps}>{content}</span>;
      })}
    </div>
  </div>;
}
