import React, { useRef } from 'react';
import { Calendar, Clock, CalendarDays, X } from 'lucide-react';
import styles from './AnalyticsFilters.module.css';

const formatDateLabel = (value, fallback) => {
    if (!value) return fallback;
    return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
    });
};

const formatTimeLabel = (value, fallback) => {
    if (!value) return fallback;
    const [hours, minutes] = value.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;

    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
    });
};

const PickerButton = ({ type, value, label, ariaLabel, onChange }) => {
    const inputRef = useRef(null);

    const openPicker = () => {
        const input = inputRef.current;
        if (!input) return;

        input.focus();
        if (typeof input.showPicker === 'function') {
            input.showPicker();
        } else {
            input.click();
        }
    };

    return (
        <span className={styles.pickerWrapper}>
            <button className={styles.pickerButton} type="button" onClick={openPicker}>
                {label}
            </button>
            <input
                ref={inputRef}
                className={styles.hiddenPicker}
                type={type}
                value={value}
                step={type === 'time' ? 900 : undefined}
                onChange={(event) => onChange(event.target.value)}
                aria-label={ariaLabel}
                tabIndex={-1}
            />
        </span>
    );
};

const AnalyticsFilters = ({ filters, onChange }) => {
    const updateFilter = (key, value) => {
        onChange((current) => ({ ...current, [key]: value }));
    };

    return (
        <section className={styles.filterBar} aria-label="Analytics filters">
            <div className={`${styles.filterControl} ${styles.dateControl}`}>
                <Calendar size={18} />
                <PickerButton
                    type="date"
                    value={filters.startDate}
                    label={formatDateLabel(filters.startDate, 'Start Date')}
                    aria-label="Start date"
                    onChange={(value) => updateFilter('startDate', value)}
                />
                <span aria-hidden="true">-</span>
                <PickerButton
                    type="date"
                    value={filters.endDate}
                    label={formatDateLabel(filters.endDate, 'End Date')}
                    aria-label="End date"
                    onChange={(value) => updateFilter('endDate', value)}
                />
                <button
                    className={styles.clearButton}
                    type="button"
                    aria-label="Clear date range"
                    onClick={() => onChange((current) => ({ ...current, startDate: '', endDate: '' }))}
                >
                    <X size={14} strokeWidth={2.4} />
                </button>
            </div>

            <div className={`${styles.filterControl} ${styles.timeControl}`}>
                <Clock size={18} />
                <div className={styles.timeFields}>
                    <span className={styles.timeField}>
                        <PickerButton
                            type="time"
                            value={filters.startTime || ''}
                            label={formatTimeLabel(filters.startTime, '12:00 AM')}
                            ariaLabel="Start time"
                            onChange={(value) => updateFilter('startTime', value)}
                        />
                    </span>
                    <span className={styles.timeDivider} aria-hidden="true">-</span>
                    <span className={styles.timeField}>
                        <PickerButton
                            type="time"
                            value={filters.endTime || ''}
                            label={formatTimeLabel(filters.endTime, '11:59 PM')}
                            ariaLabel="End time"
                            onChange={(value) => updateFilter('endTime', value)}
                        />
                    </span>
                </div>
                <button
                    className={styles.clearButton}
                    type="button"
                    aria-label="Clear time range"
                    onClick={() => onChange((current) => ({ ...current, startTime: '', endTime: '' }))}
                >
                    <X size={14} strokeWidth={2.4} />
                </button>
            </div>

            <label className={`${styles.filterControl} ${styles.dayControl}`}>
                <CalendarDays size={18} />
                <select
                    value={filters.dayPreset}
                    onChange={(event) => updateFilter('dayPreset', event.target.value)}
                    aria-label="Day filter"
                >
                    <option value="all">All Days</option>
                    <option value="weekdays">Weekdays</option>
                    <option value="weekends">Weekends</option>
                </select>
            </label>
        </section>
    );
};

export default AnalyticsFilters;
