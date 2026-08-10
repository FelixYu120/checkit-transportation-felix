import React, { useEffect, useState } from 'react';
import { Clock3, Plus, X } from 'lucide-react';
import styles from './OperatingLens.module.css';

const CUSTOM_OPERATING_LENS_STORAGE_KEY = 'checkit.transportation.customOperatingLenses';
const MAX_CUSTOM_OPERATING_LENSES = 5;

const OperatingLens = ({ filters, onChange, onLensNavigate }) => {
    const [modalOpen, setModalOpen] = useState(false);
    const [deleteLensTarget, setDeleteLensTarget] = useState(null);
    const [editingLensId, setEditingLensId] = useState(null);
    const [contextMenu, setContextMenu] = useState(null);
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

    useEffect(() => {
        if (!contextMenu) return undefined;

        const closeContextMenu = () => setContextMenu(null);
        window.addEventListener('click', closeContextMenu);
        window.addEventListener('scroll', closeContextMenu, true);
        return () => {
            window.removeEventListener('click', closeContextMenu);
            window.removeEventListener('scroll', closeContextMenu, true);
        };
    }, [contextMenu]);

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
        if (filters.startTime !== '00:00' || filters.endTime !== '23:59') {
            onLensNavigate?.();
        }
        onChange((current) => ({
            ...current,
            startTime: '00:00',
            endTime: '23:59',
        }));
    };

    const applyLens = (lens) => {
        if (filters.startTime !== lens.startTime || filters.endTime !== lens.endTime) {
            onLensNavigate?.();
        }
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

    const openCreateLens = () => {
        setError('');
        setEditingLensId(null);
        setCustomLens({ name: '', startTime: '09:00', endTime: '17:00' });
        setModalOpen(true);
    };

    const openEditLens = (lens) => {
        setError('');
        setEditingLensId(lens.id);
        setCustomLens({
            name: lens.name,
            startTime: lens.startTime,
            endTime: lens.endTime,
        });
        setContextMenu(null);
        setModalOpen(true);
    };

    const openLensContextMenu = (event, lens) => {
        event.preventDefault();
        setContextMenu({
            lens,
            x: event.clientX,
            y: event.clientY,
        });
    };

    const applyCustomLens = () => {
        if (!customLens.name?.trim() || !customLens.startTime || !customLens.endTime) {
            setError('Custom name and time range are required.');
            return;
        }

        const lensName = customLens.name.trim();
        const replacingExisting = savedLenses.some((lens) => lens.id === editingLensId || lens.name === lensName);
        const duplicateName = savedLenses.some((lens) => lens.name === lensName && lens.id !== editingLensId);
        if (duplicateName) {
            setError('An operating lens with this name already exists.');
            return;
        }
        if (!replacingExisting && savedLenses.length >= MAX_CUSTOM_OPERATING_LENSES) {
            setError(`You can save up to ${MAX_CUSTOM_OPERATING_LENSES} operating lenses.`);
            return;
        }

        const nextLens = {
            id: editingLensId || `${Date.now()}`,
            name: lensName,
            startTime: customLens.startTime,
            endTime: customLens.endTime,
        };
        const nextLenses = editingLensId
            ? savedLenses.map((lens) => (lens.id === editingLensId ? nextLens : lens))
            : [nextLens, ...savedLenses].slice(0, MAX_CUSTOM_OPERATING_LENSES);
        persistLenses(nextLenses);
        setCustomLens({ name: '', startTime: '09:00', endTime: '17:00' });
        setEditingLensId(null);
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
                            <span
                                key={lens.id}
                                className={`${styles.savedLensPill} ${active ? styles.activeSavedLens : ''}`}
                                onContextMenu={(event) => openLensContextMenu(event, lens)}
                            >
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
                        onClick={openCreateLens}
                        aria-label="Add custom operating lens"
                    >
                        <Plus size={16} />
                    </button>
                </div>
            </section>
            {contextMenu && (
                <div
                    className={styles.lensContextMenu}
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    role="menu"
                    onClick={(event) => event.stopPropagation()}
                >
                    <button type="button" role="menuitem" onClick={() => openEditLens(contextMenu.lens)}>
                        Edit
                    </button>
                </div>
            )}
            {modalOpen && (
                <div className={styles.lensModalBackdrop} role="presentation" onMouseDown={() => { setModalOpen(false); setEditingLensId(null); }}>
                    <div className={styles.lensModal} role="dialog" aria-modal="true" aria-label="Custom operating lens" onMouseDown={(event) => event.stopPropagation()}>
                        <div className={styles.lensModalHeader}>
                            <h3>{editingLensId ? 'Edit Lens' : 'Custom'}</h3>
                            <button type="button" className={styles.lensModalClose} onClick={() => { setModalOpen(false); setEditingLensId(null); }} aria-label="Close custom operating lens">
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
                            {editingLensId ? 'Save Changes' : 'Save'}
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
