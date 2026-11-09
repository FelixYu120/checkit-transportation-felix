import React, { useCallback, useRef, useState } from 'react';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import Sidebar from '../navigation/Sidebar';
import PromiSidebar from '../ai/PromiSidebar';
import EsriMap from '../../maps/EsriMap';
import styles from './AdminLayout.module.css';

const AdminLayout = () => {
  const { floorId } = useParams();
  const { pathname } = useLocation();
  const mapPanel = useRef(null);
  const [mapFocus, setMapFocus] = useState(null);
  const currentMapFocus = mapFocus?.pathname === pathname ? mapFocus : null;
  const focusSensorOnMap = useCallback((sensorId) => {
    setMapFocus((current) => ({ sensorId, pathname, request: (current?.request || 0) + 1 }));
    mapPanel.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className={styles['admin-layout']}>
      <div className={styles['admin-container']}>
        <aside className={styles['sidebar-rail']}>
          <Sidebar />
        </aside>

        <div className={styles['workspace-shell']}>
          <main className={styles['analytics-panel']}>
            <div className={styles['admin-content']}>
              <Outlet context={{ focusSensorOnMap, focusedSensorId: currentMapFocus?.sensorId }} />
            </div>
          </main>

          <aside ref={mapPanel} className={styles['map-panel']} tabIndex={-1} aria-label="Transportation sensor map">
            <EsriMap embedded focusedSensorId={currentMapFocus?.sensorId} focusRequest={currentMapFocus?.request} />
          </aside>
        </div>
      </div>

      <PromiSidebar
        floorId={floorId}
      />
    </div>
  );
};

export default AdminLayout;
