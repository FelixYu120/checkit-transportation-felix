import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import AnalyticsFilters from './AnalyticsFilters';
import ExportCsvButton from './ExportCsvButton';
import { DEFAULT_ANALYTICS_FILTERS, hasActiveTimeFilter } from './AnalyticsFilterUtils';
import styles from './AnalyticsControlBar.module.css';

const AnalyticsControlBar = ({ filters, onFilterChange, exportLabel, exportRows = [], exportFilename, exportLoading = false, getExportRows }) => {
    const [filtersOpen, setFiltersOpen] = useState(false);
    const triggerRef = useRef(null);
    const panelRef = useRef(null);
    const controlsRef = useRef(null);
    const panelId = useId();
    const titleId = `${panelId}-title`;
    const activeCount = Number(Boolean(filters?.startDate || filters?.endDate))
        + Number(hasActiveTimeFilter(filters))
        + Number(Boolean(filters?.dayPreset && filters.dayPreset !== 'all'));
    const filterLabel = activeCount ? `Filters, ${activeCount} active` : 'Filters';

    const closeFilters = useCallback(() => {
        setFiltersOpen(false);
        triggerRef.current?.focus();
    }, []);

    useEffect(() => {
        if (!filtersOpen) return undefined;

        panelRef.current?.querySelector('[aria-label="Analytics filters"] button')?.focus();

        const handlePointerDown = (event) => {
            if (!controlsRef.current?.contains(event.target)) setFiltersOpen(false);
        };
        const handleKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            closeFilters();
        };
        const handleFocusIn = (event) => {
            if (!controlsRef.current?.contains(event.target)) setFiltersOpen(false);
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('focusin', handleFocusIn);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('focusin', handleFocusIn);
        };
    }, [filtersOpen, closeFilters]);

    return (
        <section className={styles.controlBar} aria-label="Analytics controls">
            <div className={styles.filterAnchor} ref={controlsRef}>
                <button
                    ref={triggerRef}
                    type="button"
                    className={`${styles.filterTrigger} ${activeCount ? styles.hasActiveFilters : ''}`}
                    aria-label={filterLabel}
                    title={filterLabel}
                    aria-haspopup="dialog"
                    aria-expanded={filtersOpen}
                    aria-controls={filtersOpen ? panelId : undefined}
                    onClick={() => setFiltersOpen((open) => !open)}
                >
                    <SlidersHorizontal size={17} strokeWidth={1.8} aria-hidden="true" />
                    {activeCount > 0 && <span className={styles.activeBadge} aria-hidden="true">{activeCount}</span>}
                </button>
                {filtersOpen && (
                    <div ref={panelRef} id={panelId} className={styles.filterPanel} role="dialog" aria-labelledby={titleId}>
                        <div className={styles.panelHeader}>
                            <h2 id={titleId}>Filters</h2>
                            <button
                                type="button"
                                className={styles.resetButton}
                                disabled={activeCount === 0}
                                onClick={() => onFilterChange((current) => ({ ...current, ...DEFAULT_ANALYTICS_FILTERS }))}
                            >
                                Reset all
                            </button>
                            <button type="button" className={styles.closeButton} aria-label="Close filters" onClick={closeFilters}>
                                <X size={16} aria-hidden="true" />
                            </button>
                        </div>
                        <AnalyticsFilters filters={filters} onChange={onFilterChange} />
                    </div>
                )}
            </div>
            <div className={styles.exportControl}>
                <ExportCsvButton
                    exportLabel={exportLabel}
                    rows={exportRows}
                    filename={exportFilename}
                    loading={exportLoading}
                    getRows={getExportRows}
                />
            </div>
        </section>
    );
};

export default AnalyticsControlBar;
