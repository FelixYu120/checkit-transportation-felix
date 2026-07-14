import React, { useMemo, useState, useEffect } from "react";
import { NavLink, useParams } from "react-router-dom";
import { Search, ChevronDown, ChevronRight, Menu, X } from "lucide-react";
import supabase from "../../helper/SupabaseClients";
import styles from "./Sidebar.module.css";
import {
    getAdminAreaPath,
    getAdminCollegePath,
    getAdminFloorPath,
} from "../routing/AdminRouteUtils";
import {
    fetchCampusNavigation,
    filterCampusNavigation,
    getSearchTokens,
} from "./SidebarData";

const Sidebar = () => {
    const {
        collegeId: urlCollegeId,
        buildingId: urlAreaId,
    } = useParams();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [colleges, setColleges] = useState([]);
    const [expandedColleges, setExpandedColleges] = useState({});
    const [expandedAreas, setExpandedAreas] = useState({});

    useEffect(() => {
        const fetchEverything = async () => {
            try {
                const formatted = await fetchCampusNavigation(supabase);

                setColleges(formatted);
                // Auto-expand based on URL or default to first institute
                if (urlCollegeId) {
                    setExpandedColleges(prev => ({ ...prev, [urlCollegeId]: true }));
                    if (urlAreaId) {
                        setExpandedAreas(prev => ({ ...prev, [`${urlCollegeId}-${urlAreaId}`]: true }));
                    }
                } else if (formatted.length > 0) {
                    setExpandedColleges({ [formatted[0].id]: true });
                }
            } catch (error) {
                console.error("Fetch error:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchEverything();
    }, [urlAreaId, urlCollegeId]);

    const toggleCollege = (id) => setExpandedColleges(p => ({ ...p, [id]: !p[id] }));
    const toggleArea = (id) => setExpandedAreas(p => ({ ...p, [id]: !p[id] }));
    const handleSelection = () => { setQuery(""); setMobileOpen(false); };
    const handleAreaSelection = (areaKey) => {
        setExpandedAreas((prev) => ({ ...prev, [areaKey]: true }));
        handleSelection();
    };
    const tokens = useMemo(() => getSearchTokens(query), [query]);
    const visibleColleges = useMemo(
        () => filterCampusNavigation(colleges, tokens),
        [colleges, tokens]
    );

    return (
        <>
            <button className={styles.mobileToggle} onClick={() => setMobileOpen(!mobileOpen)}>
                {mobileOpen ? <X size={20} /> : <Menu size={20} />}
                <span>{mobileOpen ? "Close" : "Search"}</span>
            </button>

            <div className={`${styles.sidebar} ${!mobileOpen ? styles.retracted : ""}`}>
                <div className={styles.searchContainer}>
                    <Search size={18} className={styles.searchIcon} />
                    <input
                        type="text"
                        placeholder='Search transportation network...'
                        className={styles.searchInput}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                </div>

                {loading ? (
                    <div style={{ padding: '20px', color: '#666' }}>Loading Institutes...</div>
                ) : (
                    visibleColleges.map((college) => {
                        const isCollegeOpen = tokens.length > 0 || !!expandedColleges[college.id];
                        return (
                            <div key={college.id} className={styles.navGroup}>
                                <div className={styles.navHeader}>
                                    <button
                                        type="button"
                                        className={styles.expandButton}
                                        onClick={() => toggleCollege(college.id)}
                                        aria-label={`${isCollegeOpen ? "Collapse" : "Expand"} ${college.instituteName}`}
                                    >
                                        {isCollegeOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    </button>
                                    <NavLink
                                        end
                                        to={getAdminCollegePath(college.id)}
                                        onClick={handleSelection}
                                        className={({ isActive }) => `${styles.collegeLink} ${isActive ? styles.activeCollege : ""}`}
                                    >
                                        {college.instituteName}
                                    </NavLink>
                                </div>

                                {isCollegeOpen && (
                                    <div className={`${styles.navGroup} ${styles.buildingGroup}`}>
                                        {college.areas.map((area) => {
                                            const areaKey = `${college.id}-${area.id}`;
                                            const isAreaOpen = tokens.length > 0 || !!expandedAreas[areaKey];

                                            return (
                                                <div key={areaKey}>
                                                    <div className={styles.buildingHeaderWrapper}>
                                                        <button
                                                            type="button"
                                                            className={styles.buildingExpandButton}
                                                            onClick={() => toggleArea(areaKey)}
                                                            aria-label={`${isAreaOpen ? "Collapse" : "Expand"} ${area.name}`}
                                                        >
                                                            {isAreaOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                                        </button>
                                                        <NavLink
                                                            end
                                                            to={getAdminAreaPath(college.id, area.id)}
                                                            onClick={() => handleAreaSelection(areaKey)}
                                                            className={({ isActive }) => `${styles.buildingLink} ${isActive ? styles.activeBuilding : ""}`}
                                                        >
                                                            {area.name}
                                                        </NavLink>
                                                    </div>

                                                    {isAreaOpen && (
                                                        <div className={styles.floorList}>
                                                            {area.corridors.map((corridor) => (
                                                                <div key={corridor.id} className={styles.floorGroup}>
                                                                    <NavLink
                                                                        to={getAdminFloorPath(college.id, corridor.id)}
                                                                        onClick={handleSelection}
                                                                        className={({ isActive }) => `${styles.floorLink} ${isActive ? styles.activeFloor : ""}`}
                                                                    >
                                                                        <span>{corridor.name}</span>
                                                                    </NavLink>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </>
    );
};

export default Sidebar;
