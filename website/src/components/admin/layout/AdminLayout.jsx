import React from 'react';
import { Outlet, useParams } from 'react-router-dom';
import Sidebar from '../navigation/Sidebar';
import PromiSidebar from '../ai/PromiSidebar';
import EsriMap from '../../maps/EsriMap';
import styles from './AdminLayout.module.css';

const AdminLayout = () => {
  const { floorId } = useParams();

  return (
    <div className={styles['admin-layout']}>
      <div className={styles['admin-container']}>
        <aside className={styles['sidebar-rail']}>
          <Sidebar />
        </aside>

        <div className={styles['workspace-shell']}>
          <main className={styles['analytics-panel']}>
            <div className={styles['admin-content']}>
              <Outlet />
            </div>
          </main>

          <aside className={styles['map-panel']}>
            <EsriMap embedded />
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
