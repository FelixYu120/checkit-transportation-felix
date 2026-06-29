import React from 'react';
import AnalyticsFilters from './AnalyticsFilters';
import ExportCsvButton from './ExportCsvButton';
import styles from './AnalyticsControlBar.module.css';

const AnalyticsControlBar = ({ filters, onFilterChange, exportLabel }) => (
    <section className={styles.controlBar} aria-label="Analytics controls">
        <div className={styles.exportRow}>
            <ExportCsvButton exportLabel={exportLabel} />
        </div>
        <AnalyticsFilters filters={filters} onChange={onFilterChange} />
    </section>
);

export default AnalyticsControlBar;
