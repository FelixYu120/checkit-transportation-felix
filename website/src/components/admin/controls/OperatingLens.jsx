import React, { useEffect, useState } from 'react';
import { Clock3, Plus, X } from 'lucide-react';
import styles from './OperatingLens.module.css';

const CUSTOM_OPERATING_LENS_STORAGE_KEY = 'checkit.transportation.customOperatingLenses';
const MAX_CUSTOM_OPERATING_LENSES = 5;

const OperatingLens = ({ filters, onChange }) => {
    const [modalOpen, setModalOpen] = useState(false);
    const [deleteLensTarget, setDeleteLensTarget] = useState(null);
    const [error, setError] = useState('');
    const [savedLenses, setSavedLenses] = useState(() => {
        if (typeof window === 'undefined') return [];
        try {
            const saved = JSON.parse(window.localStorage.getItem(CUSTOM_OPERATING_LENS_STORAGE_KEY) || '[]');
            return Array.isArray(saved) ? saved.slice(0, MAX_CUSTOM_OPERATING_LENSES) : [];
        } catch {
            return [];
        }
    });
    const [customLens, setCustomLens] = useState({ name: '', startTime: '09:00', endTime: '17:00' });

    useEffect(() => {
        onChange((current) => ({
            ...current,
            startTime: '00:00',
            endTime: '23:59',
        }));
    }, [onChange]);

    const persistLenses = (lenses) => {
        setSavedLenses(lenses);
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(CUSTOM_OPERATING_LENS_STORAGE_KEY, JSON.stringify(lenses));
        }
    };

    const updateCustomLens = (key, value) => {
        setCustomLens((current) => ({ ...current, [key]: value }));
    };

    const applyAllDay = () => {
        onChange((current) => ({
            ...current,
            startTime: '00:00',
            endTime: '23:59',
        }));
    };

    const applyLens = (lens) => {
        onChange((current) => ({
            ...current,
            startTime: lens.startTime,
            endTime: lens.endTime,
        }));
    };

    const requestDeleteLens = (lens) => {
        setDeleteLensTarget(lens);
    };

    const confirmDeleteLens = () => {
        if (!deleteLensTarget) return;
        const lensId = deleteLensTarget.id;
        persistLenses(savedLenses.filter((lens) => lens.id !== lensId));
        setDeleteLensTarget(null);
    };

    const applyCustomLens = () => {
        if (!customLens.name?.trim() || !customLens.startTime || !customLens.endTime) {
            setError('Custom name and time range are required.');
            return;
        }

        const lensName = customLens.name.trim();
        const replacingExisting = savedLenses.some((lens) => lens.name === lensName);
        if (!replacingExisting && savedLenses.length >= MAX_CUSTOM_OPERATING_LENSES) {
            setError(`You can save up to ${MAX_CUSTOM_OPERATING_LENSES} operating lenses.`);
            return;
        }

        const nextLens = {
            id: `${Date.now()}`,
            name: lensName,
            startTime: customLens.startTime,
            endTime: customLens.endTime,
        };
        const nextLenses = [nextLens, ...savedLenses.filter((lens) => lens.name !== nextLens.name)].slice(0, MAX_CUSTOM_OPERATING_LENSES);
        persistLenses(nextLenses);
        setCustomLens({ name: '', startTime: '09:00', endTime: '17:00' });
        setError('');
        setModalOpen(false);
    };

    return (
        <>
            <section className={styles.operatingProfiles} aria-label="Operating hour profiles">
                <div className={styles.profileHeading}>
                    <Clock3 size={16} />
                    <span>Operating lens</span>
                </div>
                <div className={styles.profileButtons}>
                    <button
                        type="button"
                        className={`${styles.profileButton} ${filters.startTime === '00:00' && filters.endTime === '23:59' ? styles.activeProfile : ''}`}
                        onClick={applyAllDay}
                    >
                        All day
                    </button>
                    {savedLenses.map((lens) => {
                        const active = filters.startTime === lens.startTime && filters.endTime === lens.endTime;
                        return (
                            <span key={lens.id} className={`${styles.savedLensPill} ${active ? styles.activeSavedLens : ''}`}>
                                <button type="button" onClick={() => applyLens(lens)}>
                                    {lens.name}
                                </button>
                                <button type="button" onClick={() => requestDeleteLens(lens)} aria-label={`Delete ${lens.name}`}>
                                    <X size={13} />
                                </button>
                            </span>
                        );
                    })}
                    <button
                        type="button"
                        className={styles.addLensButton}
                        onClick={() => {
                            setError('');
                            setCustomLens({ name: '', startTime: '09:00', endTime: '17:00' });
                            setModalOpen(true);
                        }}
                        aria-label="Add custom operating lens"
                    >
                        <Plus size={16} />
                    </button>
                </div>
            </section>
            {modalOpen && (
                <div className={styles.lensModalBackdrop} role="presentation" onMouseDown={() => setModalOpen(false)}>
                    <div className={styles.lensModal} role="dialog" aria-modal="true" aria-label="Custom operating lens" onMouseDown={(event) => event.stopPropagation()}>
                        <div className={styles.lensModalHeader}>
                            <h3>Custom</h3>
                            <button type="button" className={styles.lensModalClose} onClick={() => setModalOpen(false)} aria-label="Close custom operating lens">
                                <X size={18} />
                            </button>
                        </div>
                        <label className={styles.lensModalField}>
                            <span>Custom</span>
                            <input
                                type="text"
                                value={customLens.name}
                                onChange={(event) => updateCustomLens('name', event.target.value)}
                                placeholder="Name"
                            />
                        </label>
                        <div className={styles.lensModalTimeGrid}>
                            <label className={styles.lensModalField}>
                                <span>Start Time</span>
                                <input type="time" step="900" value={customLens.startTime} onChange={(event) => updateCustomLens('startTime', event.target.value)} />
                            </label>
                            <label className={styles.lensModalField}>
                                <span>End Time</span>
                                <input type="time" step="900" value={customLens.endTime} onChange={(event) => updateCustomLens('endTime', event.target.value)} />
                            </label>
                        </div>
                        {error ? <p className={styles.lensModalError}>{error}</p> : null}
                        <button type="button" className={styles.lensModalSave} onClick={applyCustomLens}>
                            Save
                        </button>
                    </div>
                </div>
            )}
            {deleteLensTarget && (
                <div className={styles.lensModalBackdrop} role="presentation" onMouseDown={() => setDeleteLensTarget(null)}>
                    <div className={styles.lensModal} role="dialog" aria-modal="true" aria-label="Delete operating lens" onMouseDown={(event) => event.stopPropagation()}>
                        <div className={styles.lensModalHeader}>
                            <h3>Delete Lens</h3>
                            <button type="button" className={styles.lensModalClose} onClick={() => setDeleteLensTarget(null)} aria-label="Close delete operating lens">
                                <X size={18} />
                            </button>
                        </div>
                        <p className={styles.lensConfirmText}>
                            Delete "{deleteLensTarget.name}"? This removes it from your saved operating lenses.
                        </p>
                        <div className={styles.lensConfirmActions}>
                            <button type="button" className={styles.lensCancelButton} onClick={() => setDeleteLensTarget(null)}>
                                Cancel
                            </button>
                            <button type="button" className={styles.lensDeleteButton} onClick={confirmDeleteLens}>
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default OperatingLens;
