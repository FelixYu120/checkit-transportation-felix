import React, { useRef, useState } from 'react';
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

const formatTimeLabel = (value) => {
    if (!value) return 'Any Time';
    return new Date(`2000-01-01T${value}`).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
    });
};

const TIME_OPTIONS = Array.from({ length: 24 }, (_, hours) => {
    const value = `${String(hours).padStart(2, '0')}:00`;

    return {
        value,
        label: formatTimeLabel(value),
    };
});

const PickerButton = ({ type, value, label, ariaLabel, onChange }) => {
    const inputRef = useRef(null);

    const openPicker = () => {
        inputRef.current?.showPicker?.();
        inputRef.current?.focus();
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

const TimePickerSelect = ({ value, ariaLabel, onChange, includeEndOfDay = false }) => {
    const isPresetValue =
        !value ||
        TIME_OPTIONS.some((option) => option.value === value) ||
        (includeEndOfDay && value === '23:59');
    const [isCustom, setIsCustom] = useState(!isPresetValue);
    const showCustom = isCustom || (value && !isPresetValue);

    const handleSelectChange = (event) => {
        const nextValue = event.target.value;

        if (nextValue === 'custom') {
            setIsCustom(true);
            return;
        }

        setIsCustom(false);
        onChange(nextValue);
    };

    if (showCustom) {
        return (
            <input
                className={styles.customTimeInput}
                type="text"
                inputMode="numeric"
                placeholder="HH:MM"
                maxLength={5}
                value={value || ''}
                onChange={(event) => onChange(event.target.value.replace(/[^\d:]/g, ''))}
                aria-label={`${ariaLabel} custom value`}
            />
        );
    }

    return (
        <select
            className={styles.timeSelect}
            value={value}
            onChange={handleSelectChange}
            aria-label={ariaLabel}
        >
            <option value="">Any Time</option>
            {TIME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
            {includeEndOfDay && (
                <option value="23:59">11:59 PM</option>
            )}
            <option value="custom">Custom...</option>
        </select>
    );
};

const AnalyticsFilters = ({ filters, onChange }) => {
    const updateFilter = (key, value) => {
        onChange((current) => ({ ...current, [key]: value }));
    };

    return (
        <section className={styles.filterBar} aria-label="Analytics filters">
            <label className={`${styles.filterControl} ${styles.dateControl}`}>
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
            </label>

            <label className={`${styles.filterControl} ${styles.timeControl}`}>
                <Clock size={18} />
                <TimePickerSelect
                    value={filters.startTime}
                    aria-label="Start time"
                    onChange={(value) => updateFilter('startTime', value)}
                />
                <span aria-hidden="true">-</span>
                <TimePickerSelect
                    value={filters.endTime}
                    aria-label="End time"
                    includeEndOfDay
                    onChange={(value) => updateFilter('endTime', value)}
                />
                <button
                    className={styles.clearButton}
                    type="button"
                    aria-label="Clear time range"
                    onClick={() => onChange((current) => ({ ...current, startTime: '', endTime: '' }))}
                >
                    <X size={14} strokeWidth={2.4} />
                </button>
            </label>

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
