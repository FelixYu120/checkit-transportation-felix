import React from 'react';
import { Download } from 'lucide-react';
import styles from './ExportCsvButton.module.css';

const ExportCsvButton = ({ exportLabel = 'this view' }) => {
    const handleExport = () => {
        alert(`Exporting CSV for ${exportLabel}...`);
    };

    return (
        <button onClick={handleExport} className={styles.exportButton} type="button">
            Export as CSV
            <Download size={16} strokeWidth={2} />
        </button>
    );
};

export default ExportCsvButton;
