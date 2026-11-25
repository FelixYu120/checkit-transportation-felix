import React from 'react';
import { GripVertical } from 'lucide-react';
import styles from './AdminLayout.module.css';

export default function PanelDivider({ label, controls, value, min, max, valueText, onPointerDown, onKeyDown, onReset }) {
  return <div className={styles['panel-divider']} role="separator" tabIndex={0}
    aria-label={label} aria-controls={controls} aria-orientation="vertical"
    aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} aria-valuetext={valueText}
    title={label} onPointerDown={onPointerDown} onKeyDown={onKeyDown} onDoubleClick={onReset}>
    <span className={styles['divider-grip']} aria-hidden="true"><GripVertical size={14} /></span>
  </div>;
}
