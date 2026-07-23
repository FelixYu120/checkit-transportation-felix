import React from 'react';
import { Download } from 'lucide-react';
import styles from './ExportCsvButton.module.css';

const escapeCsvValue = (value) => {
    if (value === null || value === undefined) return '';
    const stringValue = String(value);

    return /[",\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
};

const buildCsv = (rows = []) => {
    if (!rows.length) return '';

    const headers = Object.keys(rows[0]);
    const lines = [
        headers.join(','),
        ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(',')),
    ];

    return lines.join('\n');
};

const createFilename = (exportLabel) => (
    `${String(exportLabel || 'export')
        .trim()
        .replace(/['’]/g, '')
        .replace(/[_\s]+/g, '-')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/(^-|-$)/g, '') || 'export'}.csv`
);

const ExportCsvButton = ({ exportLabel = 'this view', rows = [], filename, loading = false }) => {
    const handleExport = () => {
        const csv = buildCsv(rows);
        if (!csv) return;

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = filename || createFilename(exportLabel);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    return (
        <button
            onClick={handleExport}
            className={styles.exportButton}
            type="button"
            disabled={loading || !rows.length}
            title={rows.length ? `Export ${exportLabel}` : 'No rows to export'}
        >
            <Download size={16} strokeWidth={2} />
            <span>Export</span>
        </button>
    );
};

export default ExportCsvButton;
