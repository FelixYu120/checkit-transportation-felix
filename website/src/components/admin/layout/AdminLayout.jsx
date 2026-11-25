import React, { useCallback, useRef, useState } from 'react';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import Sidebar from '../navigation/Sidebar';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import usePortalPanels from './usePortalPanels';
import PanelDivider from './PanelDivider';
import PromiSidebar from '../ai/PromiSidebar';
import EsriMap from '../../maps/EsriMap';
import styles from './AdminLayout.module.css';

const AdminLayout = () => {
  const { sidebarCollapsed, dataShare, bounds, desktop, resizing, workspaceRef, startResize, resizeWithKeyboard, resetPanel, toggleSidebar } = usePortalPanels('checkit:transportation:portal-panels:v1');
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
      <div className={styles['admin-container']} data-resizing={resizing}>
        <aside className={styles['sidebar-rail']} data-collapsed={sidebarCollapsed}>
          <button type="button" className={styles['sidebar-toggle']} onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? 'Expand tree menu' : 'Collapse tree menu'}
            title={sidebarCollapsed ? 'Expand tree menu' : 'Collapse tree menu'}
            aria-expanded={!sidebarCollapsed} aria-controls="portal-navigation">
            {sidebarCollapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          </button>
          <div id="portal-navigation" className={styles['sidebar-content']} inert={sidebarCollapsed && desktop ? true : undefined}><Sidebar /></div>
        </aside>

        <div ref={workspaceRef} className={styles['workspace-shell']}
          style={{ '--data-share': `${dataShare}fr`, '--map-share': `${1 - dataShare}fr` }}>
          <main id="admin-data-panel" className={styles['analytics-panel']}>
            <div className={styles['admin-content']}>
              <Outlet context={{ focusSensorOnMap, focusedSensorId: currentMapFocus?.sensorId }} />
            </div>
          </main>
          <PanelDivider label="Resize data and map" controls="admin-data-panel admin-map-panel"
            value={Math.round(dataShare * 100)} min={Math.round(bounds.min * 100)} max={Math.round(bounds.max * 100)}
            valueText={`${Math.round(dataShare * 100)}% data, ${Math.round((1 - dataShare) * 100)}% map`}
            onPointerDown={startResize} onKeyDown={resizeWithKeyboard} onReset={resetPanel} />

          <aside id="admin-map-panel" ref={mapPanel} className={styles['map-panel']} tabIndex={-1} aria-label="Transportation sensor map">
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
