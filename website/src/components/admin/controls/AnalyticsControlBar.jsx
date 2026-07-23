import React from 'react';
import AnalyticsFilters from './AnalyticsFilters';
import ExportCsvButton from './ExportCsvButton';
import styles from './AnalyticsControlBar.module.css';

const AnalyticsControlBar = ({ filters, onFilterChange, exportLabel, exportRows = [], exportFilename, exportLoading = false }) => (
    <section className={styles.controlBar} aria-label="Analytics controls">
        <div className={styles.controlsRow}>
            <AnalyticsFilters filters={filters} onChange={onFilterChange} />
            <ExportCsvButton
                exportLabel={exportLabel}
                rows={exportRows}
                filename={exportFilename}
                loading={exportLoading}
            />
        </div>
    </section>
);

export default AnalyticsControlBar;
