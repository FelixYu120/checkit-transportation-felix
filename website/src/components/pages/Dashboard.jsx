import React, { useState, useEffect, useCallback } from 'react';
import styles from './Dashboard.module.css';
import supabase from '../helper/SupabaseClients';

const slugify = (text) => {
    if (!text) return "unknown";
    return String(text).toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .trim();
};

function Dashboard() {
    const [campusData, setCampusData] = useState([]); 
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState('');
    const [searchTerm, setSearchTerm] = useState("");

    // 1. MOVED INSIDE THE COMPONENT: useCallback must be inside the React function
    const formatData = useCallback((rawCorridorRecords) => {
        const areasMap = {};

        rawCorridorRecords.forEach((corridorRecord) => {
            const peopleCount = Number(corridorRecord.current_people_count) || 0;
            const capacity = Number(corridorRecord.room_capacity) || 0;
            const areaName = corridorRecord.buildings?.name || "Unknown Area";
            const corridorNumber = corridorRecord.floor_number || "1";
            const areaKey = slugify(areaName);
            const corridorKey = `${areaKey}-${corridorNumber}`;

            if (!areasMap[areaKey]) {
                areasMap[areaKey] = { id: areaKey, name: areaName, corridors: {} };
            }

            if (!areasMap[areaKey].corridors[corridorKey]) {
                areasMap[areaKey].corridors[corridorKey] = {
                    id: corridorKey,
                    name: `Corridor ${corridorNumber}`,
                    capacity: 0,
                    peopleCount: 0,
                    segmentCount: 0,
                    latestUpdate: null,
                };
            }

            const corridor = areasMap[areaKey].corridors[corridorKey];
            corridor.capacity += capacity;
            corridor.peopleCount += peopleCount;
            corridor.segmentCount += 1;

            if (corridorRecord.last_updated) {
                const observedAt = new Date(corridorRecord.last_updated);
                if (!corridor.latestUpdate || observedAt > corridor.latestUpdate) {
                    corridor.latestUpdate = observedAt;
                }
            }
        });

        return Object.values(areasMap).map((area) => ({
            ...area,
            corridors: Object.values(area.corridors).map((corridor) => {
                const density = corridor.capacity > 0
                    ? (corridor.peopleCount / corridor.capacity) * 100
                    : 0;
                let status = 'empty';
                if (density >= 85) status = 'full';
                else if (density >= 60) status = 'nearly-full';
                else if (corridor.peopleCount > 0) status = 'partially-full';

                return {
                    ...corridor,
                    density,
                    status,
                    lastUpdated: corridor.latestUpdate
                        ? corridor.latestUpdate.toLocaleTimeString()
                        : 'Never',
                };
            }),
        }));
    }, []);

    const fetchData = useCallback(async ({ showLoading = true } = {}) => {
        try {
            if (showLoading) setLoading(true);
            setFetchError('');
            
            // 2. FIXED QUERY: Removed the deleted room_current_state table
            const { data, error } = await supabase
                .from('rooms')
                .select(`
                    id,
                    current_people_count,
                    room_capacity,
                    floor_number,
                    last_updated,
                    buildings(name)
                `);
            
            if (error) throw error;
            setCampusData(formatData(data));
        } catch (error) {
            console.error("Supabase Fetch error:", error);
            setCampusData([]);
            setFetchError(error.message || 'Unable to load corridors.');
        } finally {
            setLoading(false);
        }
    }, [formatData]);

    useEffect(() => {
        fetchData();

        const subscription = supabase
            .channel('dashboard-changes')
            .on('postgres_changes', { 
                event: '*', 
                schema: 'public', 
                table: 'rooms'  
            }, (payload) => {
                console.info('Dashboard realtime corridor change:', payload);
                fetchData({ showLoading: false }); 
            })
            .subscribe((status, error) => {
                if (status === 'SUBSCRIBED') {
                    console.info('Dashboard realtime connected.');
                }

                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    console.warn('Dashboard realtime disconnected:', status, error);
                }
            });

        return () => {
            supabase.removeChannel(subscription);
        };
    }, [fetchData]);

    const filteredDirectory = campusData.map((area) => {
        const isAreaMatch = area.name.toLowerCase().includes(searchTerm.toLowerCase());
        const filteredCorridors = area.corridors.filter((corridor) =>
            corridor.name.toLowerCase().includes(searchTerm.toLowerCase())
        );

        if (isAreaMatch) return area;
        return { ...area, corridors: filteredCorridors };
    }).filter((area) => area.corridors.length > 0 || area.name.toLowerCase().includes(searchTerm.toLowerCase()));

    return (
        <div className={styles.dashboardContainer}>
            <div className={styles.topBar}>
                <div className={styles.searchWrapper}>
                    <input 
                        type="text" 
                        className={styles.searchInput}
                        placeholder="Search for a corridor or area..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                
                <div className={styles.statusLegend}>
                    <div className={styles.legendItem}>
                        <span>Empty: </span><span className={`${styles.dot} ${styles.greenDot}`}></span>
                    </div>
                    <div className={styles.legendItem}>
                        <span>Partially Full: </span><span className={`${styles.dot} ${styles.yellowDot}`}></span>
                    </div>
                    <div className={styles.legendItem}>
                        <span>Nearly Full: </span><span className={`${styles.dot} ${styles.orangeDot}`}></span>
                    </div>
                    <div className={styles.legendItem}>
                        <span>Full: </span><span className={`${styles.dot} ${styles.redDot}`}></span>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className={styles.noResults}>Loading Campus Data...</div>
            ) : fetchError ? (
                <div className={styles.noResults}>Unable to load corridors: {fetchError}</div>
            ) : filteredDirectory.length > 0 ? (
                <div className={styles.buildingsContainer}>
                    {filteredDirectory.map((area) => (
                        <AreaGroup
                            key={area.id}
                            area={area}
                            isSearching={searchTerm.length > 0}
                        />
                    ))}
                </div>
            ) : (
                <div className={styles.noResults}>No corridors found.</div>
            )}
        </div>
    );
}

const AreaGroup = ({ area, isSearching }) => {
    const [isOpen, setIsOpen] = useState(true);
    const showContent = isSearching ? true : isOpen;
    const totalCorridors = area.corridors.length;
    const openCorridors = area.corridors.filter((corridor) => Number(corridor.density) < 100).length;

    return (
        <div id={`building-card-${area.id}`} className={styles.buildingCard}>
            <div className={styles.buildingHeader} onClick={() => setIsOpen(!isOpen)}>
                <div className={styles.buildingInfo}>
                    <span className={styles.buildingName}>{area.name}</span>
                    <span className={styles.buildingSub}>
                        {openCorridors}/{totalCorridors} corridors open
                    </span>
                </div>
                <span className={`${styles.arrow} ${showContent ? styles.down : ''}`}>▼</span>
            </div>

            {showContent && (
                <div className={styles.floorList}>
                    {area.corridors.map((corridor) => (
                        <CorridorCard key={corridor.id} corridor={corridor} />
                    ))}
                </div>
            )}
        </div>
    );
};

const CorridorCard = ({ corridor }) => {
    let dotClass = styles.greenDot;
    if (corridor.status === 'partially-full') dotClass = styles.yellowDot;
    else if (corridor.status === 'nearly-full') dotClass = styles.orangeDot;
    else if (corridor.status === 'full') dotClass = styles.redDot;

    return (
        <div className={styles.floorCard}>
            <div className={styles.roomInfo}>
                <div className={styles.roomTitleRow}>
                    <h4 className={styles.roomName} title={corridor.name}>{corridor.name}</h4>
                    <div className={styles.statusContainer}>
                        <span className={styles.statusPercent}>{Math.round(corridor.density)}%</span>
                        <div className={`${styles.statusDot} ${dotClass}`}></div>
                    </div>
                </div>
                <p className={styles.roomDetails}>Capacity: {corridor.capacity}</p>
            </div>
        </div>
    );
};

export default Dashboard;
