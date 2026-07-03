import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  Download,
  Type,
  BarChart2,
  Layers,
  MinusSquare,
  ImagePlus,
  Link2,
  FileText,
  User,
  ArrowRight,
  Calendar,
  Trash2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  RefreshCw,
} from 'lucide-react';
import supabase from "../../helper/SupabaseClients";
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import styles from './InsightsStudio.module.css';


import { Rnd } from 'react-rnd';
import AggregateChart from '../visualizations/AggregateChart';
import ComparisonAggregateChart from '../visualizations/ComparisonAggregateChart';
import { AGGREGATE_CHART_TYPES, COMPARISON_CHART_TYPES } from '../visualizations/AggregateChartTypes';
import SummaryMetrics from '../summaries/SummaryMetrics';
import ComparisonSummaryMetrics from '../summaries/ComparisonSummaryMetrics';
import { fetchSensorDirectory } from '../data/SensorDirectoryData';

const DEFAULT_CARD_BACKGROUND = '#ffffff';
const DEFAULT_TEXT_COLOR = '#0f172a';
const DEFAULT_PAGE_COUNT = 1;
const GRID_SIZE = 24;
const PAGE_HEIGHT = 1200;
const PAGE_WIDTH = 820;
const DEFAULT_REPORT_WIDTH = 720;
const DEFAULT_SUMMARY_HEIGHT = 240;
const DEFAULT_CHART_HEIGHT = 480;
const SUMMARY_CARD_ROW_HEIGHT = 108;
const SUMMARY_CARD_GAP = 12;
const SUMMARY_CARD_MIN_HEIGHT = 132;
const SUMMARY_CARD_MAX_COLUMNS = 4;
const SNAP_THRESHOLD = 12;
const DEFAULT_REPORT_SETTINGS = {
  timeframe: 'weekly',
  startDate: '',
  endDate: '',
  startTime: '00:00',
  endTime: '23:59',
  dayPreset: 'all',
  pdfSize: 'a4',
  pdfOrientation: 'portrait',
  showCoverPage: true,
  showDocumentHeader: true,
  showFooter: true,
  coverEyebrow: 'Insights Studio',
  coverSubtitle: 'Add a short report subtitle',
  coverAccentColor: '#2f716f',
  coverBackground: '#f7fbfa',
  coverLayout: 'classic',
  coverEyebrowX: 72,
  coverEyebrowY: 88,
  coverTitleX: 72,
  coverTitleY: 160,
  coverSubtitleX: 72,
  coverSubtitleY: 312,
  coverMetaX: 72,
  coverMetaY: 1040,
  coverEyebrowFontSize: '13px',
  coverTitleFontSize: '62px',
  coverSubtitleFontSize: '18px',
  coverMetaFontSize: '13px',
  coverFontFamily: 'Inter, system-ui, sans-serif',
  lastSavedBy: '',
  lastSavedAt: '',
};
const FONT_SIZE_OPTIONS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];
const FONT_FAMILY_OPTIONS = [
  { value: 'Inter, system-ui, sans-serif', label: 'Default' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Times New Roman", Times, serif', label: 'Times New Roman' },
  { value: '"Courier New", Courier, monospace', label: 'Courier New' },
];

const CHART_PRESETS = {
  solo: [
    {
      id: 'utilization-trend',
      label: 'Volume + speed',
      updates: {
        label: 'Volume + Speed',
        chartType: 'combo',
        highlightPeak: true,
        showLegend: true,
        occupancyColor: '#2f716f',
        peopleColor: '#94a3b8',
      },
    },
    {
      id: 'people-activity',
      label: 'Direction split',
      updates: {
        label: 'Direction Split',
        chartType: 'direction_bar',
        highlightPeak: true,
        showLegend: true,
        occupancyColor: '#2f716f',
        peopleColor: '#9fbfb8',
      },
    },
    {
      id: 'threshold-review',
      label: 'Speed profile',
      updates: {
        label: 'Speed Profile',
        chartType: 'speed_profile',
        thresholdEnabled: true,
        thresholdValue: 50,
        thresholdLabel: 'Threshold',
        thresholdColor: '#ef4444',
        showLegend: true,
        legendItems: { occupancy: true, people: true, threshold: true },
      },
    },
  ],
  comparison: [
    {
      id: 'peak-comparison',
      label: 'Peak comparison',
      updates: {
        label: 'Peak Comparison',
        chartType: 'combo',
        showLegend: true,
        thresholdEnabled: false,
        seriesColors: ['#2f716f', '#8b5cf6', '#0ea5e9'],
        peopleSeriesColors: ['#64748b', '#b8a2f3', '#94a3b8'],
      },
    },
    {
      id: 'utilization-comparison',
      label: 'Speed comparison',
      updates: {
        label: 'Speed Comparison',
        chartType: 'line',
        showLegend: true,
        thresholdEnabled: false,
        seriesColors: ['#0f766e', '#7c3aed', '#0284c7'],
      },
    },
    {
      id: 'capacity-watch',
      label: 'Threshold watch',
      updates: {
        label: 'Threshold Watch',
        chartType: 'combo',
        showLegend: true,
        thresholdEnabled: true,
        thresholdValue: 50,
        thresholdLabel: 'Threshold',
        thresholdColor: '#ef4444',
        legendItems: { occupancy: true, people: true, threshold: true },
      },
    },
  ],
};
const DEFAULT_SUMMARY_METRICS = ['total', 'peak', 'averageSpeed', 'busiestTime'];
const SUMMARY_METRIC_OPTIONS = [
  { value: 'total', label: 'Total Traffic Volume' },
  { value: 'peak', label: 'Peak Traffic Volume' },
  { value: 'averageSpeed', label: 'Average Speed' },
  { value: 'v85Speed', label: '85th Speed' },
  { value: 'maxSpeed', label: 'Max Speed' },
  { value: 'approachShare', label: 'Approach Share' },
  { value: 'busiestDay', label: 'Highest Volume Day' },
  { value: 'busiestTime', label: 'Highest Volume Time' },
];
const COMPARISON_SUMMARY_MODES = [
  { value: 'average', label: 'Average Difference' },
  { value: 'peak', label: 'Peak Difference' },
  { value: 'change', label: 'Change From Start' },
  { value: 'totalVolume', label: 'Total Traffic Volume' },
  { value: 'groupAverage', label: 'Group Average' },
  { value: 'topVolume', label: 'Top Volume Corridor' },
  { value: 'topAverage', label: 'Top Average Corridor' },
  { value: 'range', label: 'Traffic Spread' },
];
const DEFAULT_COMPARISON_SUMMARY_METRICS = ['totalVolume', 'topVolume', 'groupAverage', 'range'];

const roundToGrid = (value) => Math.ceil(value / GRID_SIZE) * GRID_SIZE;

const getSummaryMetricCount = (element, isComparisonReport) => {
  const fallbackMetrics = isComparisonReport ? DEFAULT_COMPARISON_SUMMARY_METRICS : DEFAULT_SUMMARY_METRICS;
  const metrics = Array.isArray(element?.summaryMetrics) && element.summaryMetrics.length > 0
    ? element.summaryMetrics
    : fallbackMetrics;
  return Math.max(metrics.length, 1);
};

const getAutoSummaryHeight = (element, isComparisonReport, width = element?.width || DEFAULT_REPORT_WIDTH) => {
  const metricCount = getSummaryMetricCount(element, isComparisonReport);
  const columnsByWidth = Math.max(1, Math.min(SUMMARY_CARD_MAX_COLUMNS, Math.floor(width / 168)));
  const rows = Math.ceil(metricCount / columnsByWidth);
  const estimatedHeight = rows * SUMMARY_CARD_ROW_HEIGHT + Math.max(0, rows - 1) * SUMMARY_CARD_GAP;
  return roundToGrid(Math.max(SUMMARY_CARD_MIN_HEIGHT, estimatedHeight));
};
const TEMPLATE_OPTIONS = {
  solo: [
    {
      id: 'default',
      name: 'Default Template',
      description: 'Cover, header, summary cards, and a weekly trend chart.',
      previewClass: 'default',
    },
    {
      id: 'operations',
      name: 'Operations Snapshot',
      description: 'Compact KPI strip, 24h activity, and a short notes area.',
      previewClass: 'operations',
    },
    {
      id: 'trend-review',
      name: 'Trend Review',
      description: 'Large weekly visualization with supporting takeaways below.',
      previewClass: 'trend',
    },
    {
      id: 'blank',
      name: 'Blank Report',
      description: 'Starts completely empty: no cover, header, footer, or generated modules.',
      previewClass: 'blank',
    },
  ],
  comparison: [
    {
      id: 'default',
      name: 'Default Template',
      description: 'Cover, header, and one comparison visualization.',
      previewClass: 'default',
    },
    {
      id: 'executive-compare',
      name: 'Executive Compare',
      description: 'A comparison banner, chart, and interpretation block.',
      previewClass: 'executive',
    },
    {
      id: 'corridor-benchmark',
      name: 'Corridor Benchmark',
      description: 'Side-by-side comparison modules for transportation reviews.',
      previewClass: 'benchmark',
    },
    {
      id: 'blank',
      name: 'Blank Report',
      description: 'Starts completely empty: no cover, header, footer, or generated modules.',
      previewClass: 'blank',
    },
  ],
};

const getTemplateOptions = (mode) => TEMPLATE_OPTIONS[mode] || TEMPLATE_OPTIONS.solo;

const getTemplateConfig = (mode, templateId) =>
  getTemplateOptions(mode).find((option) => option.id === templateId) || getTemplateOptions(mode)[0];

const TEMPLATE_COVER_SETTINGS = {
  default: {
    coverEyebrow: 'Usage Report',
    coverSubtitle: 'A focused snapshot of corridor traffic and operational context.',
    coverLayout: 'classic',
    coverAccentColor: '#2f716f',
    coverBackground: '#f7fbfa',
  },
  operations: {
    coverEyebrow: 'Operations Snapshot',
    coverSubtitle: 'Daily activity, sensor notes, and corridor-use indicators.',
    coverAccentColor: '#2f716f',
    coverBackground: '#eef8f6',
    coverLayout: 'banded',
    coverTitleX: 72,
    coverTitleY: 132,
    coverSubtitleX: 72,
    coverSubtitleY: 324,
    coverMetaX: 72,
    coverMetaY: 984,
  },
  'trend-review': {
    coverEyebrow: 'Trend Review',
    coverSubtitle: 'A weekly narrative view for patterns, peaks, and changes.',
    coverAccentColor: '#6b8e23',
    coverBackground: '#f7faf0',
    coverLayout: 'editorial',
    coverTitleX: 96,
    coverTitleY: 252,
    coverSubtitleX: 96,
    coverSubtitleY: 436,
    coverMetaX: 96,
    coverMetaY: 936,
  },
  'executive-compare': {
    coverEyebrow: 'Executive Compare',
    coverSubtitle: 'Side-by-side performance context for leadership review.',
    coverAccentColor: '#475569',
    coverBackground: '#f4f7fb',
    coverLayout: 'executive',
    coverTitleX: 72,
    coverTitleY: 216,
    coverSubtitleX: 72,
    coverSubtitleY: 372,
    coverMetaX: 72,
    coverMetaY: 976,
  },
  'corridor-benchmark': {
    coverEyebrow: 'Corridor Benchmark',
    coverSubtitle: 'Benchmark corridor traffic and identify outliers across selected data sources.',
    coverAccentColor: '#8b5cf6',
    coverBackground: '#f5f3ff',
    coverLayout: 'benchmark',
    coverTitleX: 84,
    coverTitleY: 176,
    coverSubtitleX: 84,
    coverSubtitleY: 348,
    coverMetaX: 84,
    coverMetaY: 984,
  },
  blank: {
    showCoverPage: false,
    showDocumentHeader: false,
    showFooter: false,
  },
};

const getTemplateReportSettings = (templateId) => ({
  ...DEFAULT_REPORT_SETTINGS,
  ...(TEMPLATE_COVER_SETTINGS[templateId] || {}),
});

const TEMPLATE_DOC_META = {
  operations: {
    title: 'Operations Snapshot',
    period: 'Last 24 Hours',
  },
  'trend-review': {
    title: 'Usage Trend Review',
    period: 'Last 7 Days',
  },
  'executive-compare': {
    title: 'Executive Comparison Report',
    period: 'Last 7 Days',
  },
  'corridor-benchmark': {
    title: 'Corridor Benchmark Report',
    period: 'Last 7 Days',
  },
};

const waitForNextPaint = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

const createPageImageFromCanvas = (canvas, pageIndex) => ({
  label: `Page ${pageIndex + 1}`,
  src: canvas.toDataURL('image/png'),
  width: canvas.width,
  height: canvas.height,
});

const createPageImageFromReportCanvas = (sourceCanvas, pageIndex) => {
  const scale = sourceCanvas.width / PAGE_WIDTH || 1;
  const pageCanvas = document.createElement('canvas');
  pageCanvas.width = Math.round(PAGE_WIDTH * scale);
  pageCanvas.height = Math.round(PAGE_HEIGHT * scale);

  const context = pageCanvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
  context.drawImage(
    sourceCanvas,
    0,
    Math.round(pageIndex * PAGE_HEIGHT * scale),
    pageCanvas.width,
    pageCanvas.height,
    0,
    0,
    pageCanvas.width,
    pageCanvas.height
  );

  return createPageImageFromCanvas(pageCanvas, pageIndex);
};

const waitForReportReady = async (element, timeoutMs = 8000) => {
  const startedAt = Date.now();

  while (element?.querySelector('[data-report-loading="true"]')) {
    if (Date.now() - startedAt > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return true;
};

const getSnappedElementPosition = (movingElement, layout, nextX, nextY) => {
  if (!movingElement) return { x: nextX, y: nextY, verticalGuides: [], horizontalGuides: [] };

  const movingPage = Math.floor(nextY / PAGE_HEIGHT);
  const verticalCandidates = [
    { edge: 'left', value: nextX, offset: 0 },
    { edge: 'center', value: nextX + (movingElement.width / 2), offset: movingElement.width / 2 },
    { edge: 'right', value: nextX + movingElement.width, offset: movingElement.width },
  ];
  const horizontalCandidates = [
    { edge: 'top', value: nextY, offset: 0 },
    { edge: 'middle', value: nextY + (movingElement.height / 2), offset: movingElement.height / 2 },
    { edge: 'bottom', value: nextY + movingElement.height, offset: movingElement.height },
  ];

  let snappedX = nextX;
  let snappedY = nextY;
  let bestVertical = null;
  let bestHorizontal = null;

  layout
    .filter((element) => element.id !== movingElement.id && Math.floor(element.y / PAGE_HEIGHT) === movingPage)
    .forEach((element) => {
      const targetVerticalEdges = [element.x, element.x + (element.width / 2), element.x + element.width];
      const targetHorizontalEdges = [element.y, element.y + (element.height / 2), element.y + element.height];

      verticalCandidates.forEach((candidate) => {
        targetVerticalEdges.forEach((targetValue) => {
          const distance = Math.abs(candidate.value - targetValue);
          if (distance <= SNAP_THRESHOLD && (!bestVertical || distance < bestVertical.distance)) {
            bestVertical = { distance, targetValue, offset: candidate.offset };
          }
        });
      });

      horizontalCandidates.forEach((candidate) => {
        targetHorizontalEdges.forEach((targetValue) => {
          const distance = Math.abs(candidate.value - targetValue);
          if (distance <= SNAP_THRESHOLD && (!bestHorizontal || distance < bestHorizontal.distance)) {
            bestHorizontal = { distance, targetValue, offset: candidate.offset };
          }
        });
      });
    });

  if (bestVertical) snappedX = Math.round((bestVertical.targetValue - bestVertical.offset) / GRID_SIZE) * GRID_SIZE;
  if (bestHorizontal) snappedY = Math.round((bestHorizontal.targetValue - bestHorizontal.offset) / GRID_SIZE) * GRID_SIZE;

  return {
    x: snappedX,
    y: snappedY,
    verticalGuides: bestVertical ? [bestVertical.targetValue] : [],
    horizontalGuides: bestHorizontal ? [bestHorizontal.targetValue] : [],
  };
};

const getColorInputValue = (value, fallback) =>
  /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;

const normalizeFontSizeValue = (value, fallback = '16px') => {
  const nextValue = String(value || '').trim();
  if (!nextValue) return fallback;
  return /^\d+(\.\d+)?$/.test(nextValue) ? `${nextValue}px` : nextValue;
};

const getFontSizeNumber = (value, fallback = 16) => {
  const match = String(value || '').match(/\d+(\.\d+)?/);
  return match ? match[0] : String(fallback);
};

const stripHtml = (html = '') => {
  const element = document.createElement('div');
  element.innerHTML = html;
  return element.textContent || element.innerText || '';
};

const getTextHtml = (element) => element.html || element.content || '';

const getTextFontSize = (element) => {
  const baseSize = Number(getFontSizeNumber(element?.style?.fontSize, 16));
  const widthScale = Math.max(0.72, Math.min(1.45, (element?.width || 240) / 260));
  const heightScale = Math.max(0.72, Math.min(1.45, (element?.height || 96) / 120));
  return `${Math.round(baseSize * Math.min(widthScale, heightScale))}px`;
};

const getSelectionInsideTextElement = (elementId) => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  const container = document.querySelector(`[data-text-element-id="${elementId}"]`);
  if (!container || !container.contains(range.commonAncestorContainer)) return null;

  return { selection, range, container };
};

const getRequiredPageCount = (layout = []) => {
  const maxBottom = Math.max(...layout.map((el) => el.y + el.height), PAGE_HEIGHT);
  return Math.max(DEFAULT_PAGE_COUNT, Math.ceil(maxBottom / PAGE_HEIGHT));
};

const EMPTY_TARGET_SELECTION = { areaId: '', buildingId: '', floorNumber: '', roomId: '' };
const CHART_SNAPSHOT_VERSION = 9;

const isFormField = (element) =>
  ['INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName) || element?.isContentEditable;

const getSnapshotKey = ({ mode, target, secondaryTarget, targets, filters, timeframe }) =>
  JSON.stringify({
    chartSnapshotVersion: CHART_SNAPSHOT_VERSION,
    mode,
    targetLevel: target?.level || '',
    targetId: target?.id || '',
    secondaryTargetLevel: secondaryTarget?.level || '',
    secondaryTargetId: secondaryTarget?.id || '',
    targets: (targets || []).map((nextTarget) => ({
      level: nextTarget?.level || '',
      id: nextTarget?.id || '',
    })),
    filters,
    timeframe,
  });

const ConfirmDialog = ({ dialog, onClose }) => {
  if (!dialog) return null;
  const actions = dialog.actions || [
    { value: false, label: dialog.cancelLabel || 'Cancel', variant: 'secondary' },
    { value: true, label: dialog.confirmLabel || 'Save', variant: 'primary' },
  ];

  return (
    <div className={styles.modalOverlay} role="presentation">
      <div className={styles.confirmDialog} role="dialog" aria-modal="true" aria-labelledby="insights-confirm-title">
        <h2 id="insights-confirm-title">{dialog.title}</h2>
        <p>{dialog.message}</p>
        <div className={styles.confirmActions}>
          {actions.map((action) => (
            <button
              key={action.value}
              type="button"
              className={action.variant === 'primary' ? styles.primaryBtn : action.variant === 'danger' ? styles.dangerInlineBtn : styles.secondaryBtn}
              onClick={() => onClose(action.value)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const ExportPreviewModal = ({ isOpen, pageCount = 1, renderPage, onClose, onDownload, isDownloading }) => {
  const [activePageIndex, setActivePageIndex] = useState(0);

  if (!isOpen) return null;
  const previewPages = Array.from({ length: Math.max(1, pageCount) }, (_, index) => ({ label: `Page ${index + 1}` }));
  const safeActivePageIndex = Math.min(activePageIndex, previewPages.length - 1);

  if (typeof document === 'undefined') return null;

  return createPortal((
    <div className={styles.modalOverlay} role="presentation">
      <div className={styles.exportPreviewDialog} role="dialog" aria-modal="true" aria-labelledby="export-preview-title">
        <div className={styles.exportPreviewHeader}>
          <div>
            <h2 id="export-preview-title">Export Preview</h2>
            <p>Review the report capture before downloading the PDF.</p>
          </div>
          <button type="button" className={styles.secondaryBtn} onClick={onClose}>Close</button>
        </div>
        <div className={styles.exportPreviewBody}>
          <div className={styles.exportPreviewThumbnails} aria-label="PDF page thumbnails">
            {previewPages.map((page, index) => (
              <button
                key={page.label}
                type="button"
                className={`${styles.exportPreviewThumbnail} ${index === safeActivePageIndex ? styles.exportPreviewThumbnailActive : ''}`}
                onClick={() => {
                  setActivePageIndex(index);
                  document.querySelector(`[data-export-preview-page="${index}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                <span className={styles.exportPreviewThumbnailSheet} aria-hidden="true" />
                <span>{page.label}</span>
              </button>
            ))}
          </div>
          <div className={styles.exportPreviewFrame}>
            {previewPages.map((page, index) => (
              <figure key={page.label} className={styles.exportPreviewPage} data-export-preview-page={index}>
                <figcaption>{page.label}</figcaption>
                {renderPage?.(index)}
              </figure>
            ))}
          </div>
        </div>
        <div className={styles.confirmActions}>
          <button type="button" className={styles.secondaryBtn} onClick={onClose}>Keep editing</button>
          <button type="button" className={styles.primaryBtn} onClick={onDownload} disabled={isDownloading}>
            {isDownloading ? 'Preparing...' : 'Download PDF'}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
};

const FontSizeControl = ({ label = 'Font Size', value, fallback = 16, onChange }) => (
  <>
    <label className={styles.inputLabel}>{label}</label>
    <input
      className={styles.inputField}
      type="number"
      min="8"
      max="96"
      step="1"
      list="insights-font-size-options"
      value={getFontSizeNumber(value, fallback)}
      onChange={(event) => onChange(normalizeFontSizeValue(event.target.value, `${fallback}px`))}
    />
    <datalist id="insights-font-size-options">
      {FONT_SIZE_OPTIONS.map((size) => (
        <option key={size} value={size} />
      ))}
    </datalist>
  </>
);

const FontFamilyControl = ({ label = 'Font', value, onChange }) => (
  <>
    <label className={styles.inputLabel}>{label}</label>
    <select className={styles.inputField} value={value || FONT_FAMILY_OPTIONS[0].value} onChange={(event) => onChange(event.target.value)}>
      {FONT_FAMILY_OPTIONS.map((font) => (
        <option key={font.value} value={font.value}>{font.label}</option>
      ))}
    </select>
  </>
);

const getChartDisplayName = (chartElement, index = 0) => (
  chartElement?.label?.trim() || `Chart ${index + 1}`
);

const ChartFrame = ({ title, children }) => {
  const frameRef = useRef(null);

  useEffect(() => {
    const notifyResize = () => window.dispatchEvent(new Event('resize'));
    notifyResize();
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(notifyResize);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [title]);

  return (
    <div ref={frameRef} className={styles.reportChartFrame}>
      <div className={styles.reportChartTitle}>{title}</div>
      <div className={styles.reportChartBody}>{children}</div>
    </div>
  );
};

const normalizeReportElements = (elements = []) => elements.map((element) => {
  if (element.type === 'chart') {
    return {
      ...element,
      width: element.width || DEFAULT_REPORT_WIDTH,
      height: element.height || DEFAULT_CHART_HEIGHT,
    };
  }

  if (element.type === 'summary') {
    return {
      ...element,
      width: element.width || DEFAULT_REPORT_WIDTH,
      height: element.height || DEFAULT_SUMMARY_HEIGHT,
    };
  }

  if (element.type === 'table') {
    return {
      ...element,
      width: element.width || DEFAULT_REPORT_WIDTH,
      height: element.height || 360,
    };
  }

  return element;
});

const getSavedReportState = ({
  mode,
  elements,
  pageCount,
  selections,
  comparisonSelections,
  reportSettings,
}) => ({
  version: 2,
  mode,
  elements,
  pageCount,
  selections,
  comparisonSelections,
  reportSettings,
});

const parseSavedLayoutData = (layoutData) => {
  if (Array.isArray(layoutData)) {
    const elements = normalizeReportElements(layoutData);

    return {
      elements,
      pageCount: getRequiredPageCount(elements),
      selections: EMPTY_TARGET_SELECTION,
      comparisonSelections: EMPTY_TARGET_SELECTION,
      reportSettings: DEFAULT_REPORT_SETTINGS,
      mode: 'solo',
    };
  }

  if (layoutData && typeof layoutData === 'object') {
    const savedElements = normalizeReportElements(Array.isArray(layoutData.elements) ? layoutData.elements : []);
    return {
      elements: savedElements,
      pageCount: layoutData.pageCount || getRequiredPageCount(savedElements),
      selections: { ...EMPTY_TARGET_SELECTION, ...(layoutData.selections || {}) },
      comparisonSelections: { ...EMPTY_TARGET_SELECTION, ...(layoutData.comparisonSelections || {}) },
      reportSettings: { ...DEFAULT_REPORT_SETTINGS, ...(layoutData.reportSettings || {}) },
      mode: layoutData.mode || 'solo',
    };
  }

  return null;
};

const getReportMode = (report) => parseSavedLayoutData(report?.layout_data)?.mode || 'solo';

const getReportSettings = (report) => parseSavedLayoutData(report?.layout_data)?.reportSettings || {};

const getReportLastSavedDate = (report) => (
  getReportSettings(report).lastSavedAt || report.created_at || report.date || null
);

const formatReportDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
};

const sortReportsByLastSaved = (reports = []) => [...reports].sort((a, b) => {
  const aTime = new Date(getReportLastSavedDate(a) || 0).getTime();
  const bTime = new Date(getReportLastSavedDate(b) || 0).getTime();
  return bTime - aTime;
});

const createDividerElement = (id, x, y, width = DEFAULT_REPORT_WIDTH, height = 24, orientation = 'horizontal') => ({
  id,
  type: 'divider',
  x,
  y,
  width,
  height,
  orientation,
  style: { line: '2px solid #e2e8f0', borderBottom: '2px solid #e2e8f0' },
});

const createDefaultTemplateElements = (isComparison) => [
  ...(isComparison ? [] : [{ id: 'summary-1', type: 'summary', x: 48, y: 192, width: DEFAULT_REPORT_WIDTH, height: DEFAULT_SUMMARY_HEIGHT, summaryMetrics: DEFAULT_SUMMARY_METRICS, useReportTimeframe: true, attachedChartId: 'chart-1', style: { background: 'transparent', borderRadius: '12px' } }]),
  createDividerElement('divider-1', 48, isComparison ? 168 : 432),
  { id: 'chart-1', type: 'chart', x: 48, y: isComparison ? 192 : 456, width: DEFAULT_REPORT_WIDTH, height: DEFAULT_CHART_HEIGHT, timeType: 'weekly', chartType: isComparison ? 'line' : 'combo', style: { background: 'transparent', borderRadius: '12px' } },
];

const createTemplateElements = (templateId, isComparison) => {
  if (templateId === 'blank') return [];

  if (!isComparison && templateId === 'operations') {
    return [
      { id: 'summary-1', type: 'summary', x: 48, y: 192, width: DEFAULT_REPORT_WIDTH, height: 168, summaryMetrics: ['total', 'peak', 'busiestTime'], useReportTimeframe: true, attachedChartId: 'chart-1', style: { background: 'transparent', borderRadius: '12px' } },
      createDividerElement('divider-1', 48, 372),
      { id: 'chart-1', type: 'chart', x: 48, y: 396, width: 432, height: 360, timeType: 'daily', chartType: 'bar', useReportTimeframe: true, style: { background: 'transparent', borderRadius: '12px' } },
      createDividerElement('divider-2', 488, 396, 24, 360, 'vertical'),
      { id: 'text-1', type: 'text', x: 512, y: 396, width: 256, height: 168, content: 'Operational notes', style: { fontSize: '22px', fontFamily: FONT_FAMILY_OPTIONS[0].value, color: DEFAULT_TEXT_COLOR, background: DEFAULT_CARD_BACKGROUND, fontWeight: '700', textAlign: 'left' } },
      { id: 'text-2', type: 'text', x: 512, y: 588, width: 256, height: 168, content: 'Add sensor maintenance, signal timing, or corridor-use observations here.', style: { fontSize: '15px', fontFamily: FONT_FAMILY_OPTIONS[0].value, color: '#475569', background: DEFAULT_CARD_BACKGROUND, fontWeight: 'normal', textAlign: 'left' } },
    ];
  }

  if (!isComparison && templateId === 'trend-review') {
    return [
      { id: 'chart-1', type: 'chart', x: 48, y: 192, width: DEFAULT_REPORT_WIDTH, height: 528, timeType: 'weekly', chartType: 'combo', useReportTimeframe: true, style: { background: 'transparent', borderRadius: '12px' } },
      createDividerElement('divider-1', 48, 732),
      { id: 'summary-1', type: 'summary', x: 48, y: 756, width: 336, height: 216, summaryMetrics: ['total', 'peak'], useReportTimeframe: true, attachedChartId: 'chart-1', style: { background: 'transparent', borderRadius: '12px' } },
      createDividerElement('divider-2', 396, 756, 24, 216, 'vertical'),
      { id: 'text-1', type: 'text', x: 420, y: 756, width: 348, height: 216, content: 'Key takeaways', style: { fontSize: '24px', fontFamily: FONT_FAMILY_OPTIONS[0].value, color: DEFAULT_TEXT_COLOR, background: DEFAULT_CARD_BACKGROUND, fontWeight: '700', textAlign: 'left' } },
    ];
  }

  if (isComparison && templateId === 'executive-compare') {
    return [
      { id: 'summary-1', type: 'summary', x: 48, y: 192, width: DEFAULT_REPORT_WIDTH, height: 132, summaryMetric: 'average', useReportTimeframe: true, attachedChartId: 'chart-1', style: { background: 'transparent', borderRadius: '12px' } },
      createDividerElement('divider-1', 48, 336),
      { id: 'chart-1', type: 'chart', x: 48, y: 360, width: DEFAULT_REPORT_WIDTH, height: 432, timeType: 'weekly', chartType: 'combo', useReportTimeframe: true, style: { background: 'transparent', borderRadius: '12px' } },
      createDividerElement('divider-2', 48, 804),
      { id: 'text-1', type: 'text', x: 48, y: 828, width: DEFAULT_REPORT_WIDTH, height: 120, content: 'Executive interpretation', style: { fontSize: '24px', fontFamily: FONT_FAMILY_OPTIONS[0].value, color: DEFAULT_TEXT_COLOR, background: DEFAULT_CARD_BACKGROUND, fontWeight: '700', textAlign: 'left' } },
    ];
  }

  if (isComparison && templateId === 'corridor-benchmark') {
    return [
      { id: 'chart-1', type: 'chart', x: 48, y: 192, width: 336, height: 360, timeType: 'daily', chartType: 'bar', useReportTimeframe: true, style: { background: 'transparent', borderRadius: '12px' } },
      createDividerElement('divider-1', 396, 192, 24, 360, 'vertical'),
      { id: 'chart-2', type: 'chart', x: 432, y: 192, width: 336, height: 360, timeType: 'weekly', chartType: 'line', useReportTimeframe: true, style: { background: 'transparent', borderRadius: '12px' } },
      createDividerElement('divider-2', 48, 564),
      { id: 'summary-1', type: 'summary', x: 48, y: 588, width: DEFAULT_REPORT_WIDTH, height: 156, summaryMetric: 'peak', useReportTimeframe: true, attachedChartId: 'chart-1', style: { background: 'transparent', borderRadius: '12px' } },
      { id: 'text-1', type: 'text', x: 48, y: 780, width: DEFAULT_REPORT_WIDTH, height: 120, content: 'Benchmark notes', style: { fontSize: '22px', fontFamily: FONT_FAMILY_OPTIONS[0].value, color: DEFAULT_TEXT_COLOR, background: DEFAULT_CARD_BACKGROUND, fontWeight: '700', textAlign: 'left' } },
    ];
  }

  return createDefaultTemplateElements(isComparison);
};

export const InsightBuilderPage = ({ type = 'solo', title = 'Solo Insight' }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams(); 
  const isComparison = type === 'comparison';
  const template = searchParams.get('template') || 'default';
  const templateConfig = getTemplateConfig(type, template);

  const reportRef = useRef(null);
  const canvasRef = useRef(null);
  const uploadInputRef = useRef(null);
  const hasLoadedReportRef = useRef(false);
  const lastCleanSnapshotRef = useRef(null);
  const confirmResolveRef = useRef(null);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const exportPageCountRef = useRef(DEFAULT_PAGE_COUNT);
  const copiedElementRef = useRef(null);
  const textDraftsRef = useRef({});
  const textSelectionRef = useRef(null);
  
  const [isSaved, setIsSaved] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [exportPreviewImage, setExportPreviewImage] = useState('');
  const [exportPreviewPages, setExportPreviewPages] = useState([]);
  const [reportId, setReportId] = useState(searchParams.get('id'));
  const [isReportLoading, setIsReportLoading] = useState(Boolean(searchParams.get('id')));
  const [reportSettings, setReportSettings] = useState(() => getTemplateReportSettings(templateConfig.id));
  const [editingTextId, setEditingTextId] = useState(null);
  const [snapGuides, setSnapGuides] = useState({ vertical: [], horizontal: [] });
  
  // --- DOCUMENT METADATA ---
  const [docMeta, setDocMeta] = useState({
    title: TEMPLATE_DOC_META[templateConfig.id]?.title || (isComparison ? 'Comparison Report' : 'Activity & Operations Report'),
    author: 'Transportation Analytics Team',
    date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    period: TEMPLATE_DOC_META[templateConfig.id]?.period || 'Last 7 Days'
  });

  const [areas, setAreas] = useState([]);
  const [allRooms, setAllRooms] = useState([]);
  const [selections, setSelections] = useState(EMPTY_TARGET_SELECTION);
  const [comparisonSelections, setComparisonSelections] = useState(EMPTY_TARGET_SELECTION);

  useEffect(() => {
    fetchSensorDirectory(supabase).then(({ institutes }) => setAreas((institutes || []).map((institute) => ({
        id: institute.institute_id,
        name: institute.full_name || institute.institute_id,
      }))));
  }, []);
  useEffect(() => {
    fetchSensorDirectory(supabase).then(({ sensors }) => setAllRooms(sensors || []));
  }, []);
  useEffect(() => {
    const fetchExistingLayout = async () => {
      if (reportId) { 
        setIsReportLoading(true);
        try {
          const { data, error } = await supabase
            .from('saved_reports')
            .select('*')
            .eq('id', reportId)
            .single();

          if (error) throw error;
          
          if (data) {
            setDocMeta({
              title: data.title || 'Activity & Operations Report',
              author: data.author || 'Transportation Analytics Team',
              date: data.date || new Date().toLocaleDateString(),
              period: data.period || 'Last 7 Days'
            });
            
            const savedLayout = parseSavedLayoutData(data.layout_data);
            if (savedLayout) {
              if (savedLayout.mode && savedLayout.mode !== type) {
                navigate(`/insights-studio/${savedLayout.mode}?id=${reportId}`, { replace: true });
                return;
              }

              setElements(savedLayout.elements);
              setPageCount(savedLayout.pageCount);
              setSelections(savedLayout.selections);
              setComparisonSelections(savedLayout.comparisonSelections);
              setReportSettings(savedLayout.reportSettings);
              lastCleanSnapshotRef.current = JSON.stringify(getSavedReportState({
                mode: type,
                elements: savedLayout.elements,
                pageCount: savedLayout.pageCount,
                selections: savedLayout.selections,
                comparisonSelections: savedLayout.comparisonSelections,
                reportSettings: savedLayout.reportSettings,
              }));
            }
            setIsDirty(false);
          }
        } catch (err) {
          console.error("Failed to load existing layout:", err.message);
        } finally {
          hasLoadedReportRef.current = true;
          setIsReportLoading(false);
        }
      } else {
        hasLoadedReportRef.current = true;
        setIsReportLoading(false);
      }
    };

    fetchExistingLayout();
  }, [navigate, reportId, type]);

  // Initial Elements - Resized to fit nicely
  const [elements, setElements] = useState(() => (reportId ? [] : createTemplateElements(templateConfig.id, isComparison)));
  const [pageCount, setPageCount] = useState(DEFAULT_PAGE_COUNT);

  const [selectedElementId, setSelectedElementId] = useState(null);
  const activeElement = elements.find(el => el.id === selectedElementId);
  const isCoverSelected = selectedElementId === 'cover';
  const hasCoverPage = reportSettings.showCoverPage;
  const hasDocumentHeader = reportSettings.showDocumentHeader;
  const reportContentOffset = hasCoverPage ? PAGE_HEIGHT : 0;
  const visiblePageCount = Math.max(pageCount, getRequiredPageCount(elements));
  const totalVisiblePageCount = visiblePageCount + (hasCoverPage ? 1 : 0);

  const getCurrentReportSnapshotString = useCallback((candidateElements = elements, candidateReportSettings = reportSettings) => JSON.stringify(getSavedReportState({
    mode: type,
    elements: candidateElements,
    pageCount: visiblePageCount,
    selections,
    comparisonSelections,
    reportSettings: candidateReportSettings,
  })), [comparisonSelections, elements, reportSettings, selections, type, visiblePageCount]);

  const hasActualUnsavedChanges = useCallback((candidateElements = elements) => (
    !lastCleanSnapshotRef.current || getCurrentReportSnapshotString(candidateElements) !== lastCleanSnapshotRef.current
  ), [elements, getCurrentReportSnapshotString]);

  const getRoomsForSelections = (targetSelections) => {
    if (!targetSelections.areaId) return [];

    return allRooms.filter((sensor) => sensor.institute_id === targetSelections.areaId);
  };

  const getFloorsForSelections = (targetSelections) => (
    [...new Set(getRoomsForSelections(targetSelections)
      .map((sensor) => sensor.sensor_id)
      .filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b)))
  );

  const getTargetFromSelections = (targetSelections, fallbackLabel) => {
    const selectedArea = areas.find((area) => area.id === targetSelections.areaId);

    if (targetSelections.floorNumber) {
      const selectedSensor = allRooms.find((sensor) => sensor.sensor_id === targetSelections.floorNumber);
      return {
        level: 'floor',
        id: targetSelections.floorNumber,
        label: selectedSensor?.corridor_name || `Corridor ${targetSelections.floorNumber}`,
      };
    }

    return {
      level: 'area',
      id: targetSelections.areaId,
      label: selectedArea?.name || fallbackLabel,
    };
  };

  const primaryTarget = getTargetFromSelections(selections, '');
  const reportFilters = useMemo(() => (
    reportSettings.timeframe === 'custom'
      ? {
        startDate: reportSettings.startDate,
        endDate: reportSettings.endDate,
        startTime: reportSettings.startTime,
        endTime: reportSettings.endTime,
        dayPreset: reportSettings.dayPreset,
      }
      : {
        startDate: '',
        endDate: '',
        startTime: '',
        endTime: '',
        dayPreset: reportSettings.dayPreset,
      }
  ), [
    reportSettings.dayPreset,
    reportSettings.endDate,
    reportSettings.endTime,
    reportSettings.startDate,
    reportSettings.startTime,
    reportSettings.timeframe,
  ]);

  const markDirty = useCallback(() => {
    if (hasLoadedReportRef.current) setIsDirty(true);
  }, []);

  const getReportSnapshot = useCallback(() => ({
    docMeta,
    elements,
    pageCount,
    selections,
    comparisonSelections,
    reportSettings,
  }), [comparisonSelections, docMeta, elements, pageCount, reportSettings, selections]);

  const pushUndoSnapshot = useCallback(() => {
    if (!hasLoadedReportRef.current) return;
    undoStackRef.current = [...undoStackRef.current.slice(-39), getReportSnapshot()];
    redoStackRef.current = [];
  }, [getReportSnapshot]);

  const restoreSnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    setDocMeta(snapshot.docMeta);
    setElements(snapshot.elements);
    setPageCount(snapshot.pageCount);
    setSelections(snapshot.selections);
    setComparisonSelections(snapshot.comparisonSelections);
    setReportSettings(snapshot.reportSettings);
    markDirty();
  }, [markDirty]);

  const undoLastChange = useCallback(() => {
    const previousSnapshot = undoStackRef.current.pop();
    if (previousSnapshot) {
      redoStackRef.current = [...redoStackRef.current.slice(-39), getReportSnapshot()];
    }
    restoreSnapshot(previousSnapshot);
  }, [getReportSnapshot, restoreSnapshot]);

  const redoLastChange = useCallback(() => {
    const nextSnapshot = redoStackRef.current.pop();
    if (nextSnapshot) {
      undoStackRef.current = [...undoStackRef.current.slice(-39), getReportSnapshot()];
    }
    restoreSnapshot(nextSnapshot);
  }, [getReportSnapshot, restoreSnapshot]);

  const clearDataSnapshots = (layout) => layout.map((element) => (
    element.snapshotData || element.snapshotKey
      ? { ...element, snapshotData: undefined, snapshotKey: undefined }
      : element
  ));

  const updateDocMeta = (updates) => {
    pushUndoSnapshot();
    setDocMeta((current) => ({ ...current, ...updates }));
    markDirty();
  };

  const updateReportSettings = (updates) => {
    pushUndoSnapshot();
    const shouldRefreshSnapshots = ['timeframe', 'startDate', 'endDate', 'startTime', 'endTime', 'dayPreset'].some((key) => key in updates);
    if (shouldRefreshSnapshots) {
      setElements((current) => clearDataSnapshots(current));
    }
    setReportSettings((current) => ({ ...current, ...updates }));
    markDirty();
  };

  const updateReportTimeframe = (timeframe) => {
    updateReportSettings(
      timeframe === 'custom'
        ? { timeframe }
        : { timeframe, startDate: '', endDate: '', startTime: '00:00', endTime: '23:59' }
    );
  };

  const resetCustomTimeframe = () => {
    updateReportSettings({
      startDate: '',
      endDate: '',
      startTime: '00:00',
      endTime: '23:59',
    });
  };

  const updateElement = (id, updates) => {
    pushUndoSnapshot();
    const shouldRefreshSnapshot = ['chartType', 'summaryMetric', 'summaryMetrics', 'customMetrics', 'selections', 'comparisonSelections', 'comparisonSelectionList', 'attachedChartId'].some((key) => key in updates);
    setElements(elements.map((el) => {
      if (el.id !== id) return el;
      const nextElement = { ...el, ...(shouldRefreshSnapshot ? { snapshotData: undefined, snapshotKey: undefined } : {}), ...updates };
      if (nextElement.type === 'summary' && ('summaryMetrics' in updates || 'width' in updates)) {
        nextElement.height = Math.max(nextElement.height || 0, getAutoSummaryHeight(nextElement, isComparison, nextElement.width));
      }
      return nextElement;
    }));
    markDirty();
  };
  const updateElementStyle = (id, property, value) => {
    const selectedText = getSelectionInsideTextElement(id) || (
      textSelectionRef.current?.id === id
        ? { range: textSelectionRef.current.range, container: textSelectionRef.current.container }
        : null
    );
    if (selectedText && property !== 'background' && property !== 'textAlign') {
      pushUndoSnapshot();
      const span = document.createElement('span');
      span.style[property] = value;
      span.appendChild(selectedText.range.extractContents());
      selectedText.range.insertNode(span);
      const nextHtml = selectedText.container.innerHTML;
      textDraftsRef.current[id] = nextHtml;
      setElements(elements.map(el => el.id === id ? { ...el, html: nextHtml, content: stripHtml(nextHtml) } : el));
      markDirty();
      return;
    }

    pushUndoSnapshot();
    setElements(elements.map(el => el.id === id ? { ...el, style: { ...el.style, [property]: value } } : el));
    markDirty();
  };

  const updateElementArrayValue = (id, key, index, value) => {
    const element = elements.find((candidate) => candidate.id === id);
    if (!element) return;
    const nextValues = [...(Array.isArray(element[key]) ? element[key] : [])];
    nextValues[index] = value;
    updateElement(id, { [key]: nextValues });
  };

  const updateElementObjectValue = (id, key, property, value) => {
    const element = elements.find((candidate) => candidate.id === id);
    if (!element) return;
    updateElement(id, { [key]: { ...(element[key] || {}), [property]: value } });
  };

  const saveTextSelection = (id) => {
    const selectedText = getSelectionInsideTextElement(id);
    if (!selectedText) return;
    textSelectionRef.current = {
      id,
      range: selectedText.range.cloneRange(),
      container: selectedText.container,
    };
  };

  const commitTextDrafts = useCallback((sourceElements = elements) => {
    let didChange = false;
    const nextElements = sourceElements.map((element) => {
      if (element.type !== 'text') return element;
      const node = document.querySelector(`[data-text-element-id="${element.id}"]`);
      const nextHtml = textDraftsRef.current[element.id] ?? node?.innerHTML;
      if (typeof nextHtml !== 'string' || nextHtml === getTextHtml(element)) return element;
      didChange = true;
      return { ...element, html: nextHtml, content: stripHtml(nextHtml) };
    });

    if (didChange) {
      setElements(nextElements);
      markDirty();
    }

    return nextElements;
  }, [elements, markDirty]);

  const getNextZIndex = useCallback(() => Math.max(0, ...elements.map((element) => element.zIndex || 1)) + 1, [elements]);

  const updateElementSnapshot = useCallback((id, snapshotKey, snapshotData) => {
    setElements((currentElements) => currentElements.map((element) => {
      if (element.id !== id || element.snapshotKey === snapshotKey) return element;
      return { ...element, snapshotKey, snapshotData };
    }));
  }, []);

  const refreshElementSnapshot = (id) => {
    pushUndoSnapshot();
    setElements(elements.map((element) => (
      element.id === id ? { ...element, snapshotData: undefined, snapshotKey: undefined } : element
    )));
    markDirty();
  };

  const getAttachedChart = (element) => (
    element?.attachedChartId
      ? elements.find((candidate) => candidate.id === element.attachedChartId && candidate.type === 'chart')
      : null
  );

  const getElementPrimarySelections = (element) => {
    const attachedChart = getAttachedChart(element);
    return attachedChart?.selections || element?.selections || selections;
  };

  const getElementComparisonSelections = (element) => {
    const attachedChart = getAttachedChart(element);
    return attachedChart?.comparisonSelections || element?.comparisonSelections || comparisonSelections;
  };

  const getElementComparisonSelectionList = (element) => {
    const attachedChart = getAttachedChart(element);
    const sourceElement = attachedChart || element;
    const savedList = Array.isArray(sourceElement?.comparisonSelectionList)
      ? sourceElement.comparisonSelectionList
      : [];
    return [
      sourceElement?.selections || selections,
      sourceElement?.comparisonSelections || comparisonSelections,
      ...savedList,
    ];
  };

  const getElementComparisonTargets = (element) => (
    getElementComparisonSelectionList(element).map((targetSelections) => (
      getTargetFromSelections(targetSelections, '')
    ))
  );

  const updateElementTarget = (id, key, nextSelections) => {
    updateElement(id, { [key]: nextSelections });
  };

  const updateElementComparisonListTarget = (id, targetIndex, nextSelections) => {
    const element = elements.find((candidate) => candidate.id === id);
    if (!element) return;

    if (targetIndex === 0) {
      updateElement(id, { selections: nextSelections });
      return;
    }

    if (targetIndex === 1) {
      updateElement(id, { comparisonSelections: nextSelections });
      return;
    }

    const nextList = [...(Array.isArray(element.comparisonSelectionList) ? element.comparisonSelectionList : [])];
    nextList[targetIndex - 2] = nextSelections;
    updateElement(id, { comparisonSelectionList: nextList });
  };

  const addComparisonTarget = (id) => {
    const element = elements.find((candidate) => candidate.id === id);
    if (!element) return;
    const nextList = [...(Array.isArray(element.comparisonSelectionList) ? element.comparisonSelectionList : []), EMPTY_TARGET_SELECTION];
    updateElement(id, { comparisonSelectionList: nextList });
  };

  const applyChartPreset = (preset) => {
    if (!activeElement || activeElement.type !== 'chart') return;
    updateElement(activeElement.id, preset.updates);
  };

  const copySelectedElement = useCallback(() => {
    if (!activeElement) return;
    copiedElementRef.current = activeElement;
  }, [activeElement]);

  const pasteCopiedElement = useCallback(() => {
    const copiedElement = copiedElementRef.current;
    if (!copiedElement) return;

    const newId = `${copiedElement.type}-${Date.now()}`;
    const pastedElement = {
      ...copiedElement,
      id: newId,
      x: Math.min(PAGE_WIDTH - copiedElement.width - 48, copiedElement.x + GRID_SIZE),
      y: copiedElement.y + GRID_SIZE,
      zIndex: getNextZIndex(),
      snapshotData: copiedElement.snapshotData,
      snapshotKey: copiedElement.snapshotKey,
    };

    if (pastedElement.type === 'chart') {
      pastedElement.label = `${getChartDisplayName(copiedElement)} Copy`;
    }

    pushUndoSnapshot();
    setElements([...elements, pastedElement]);
    setSelectedElementId(newId);
    markDirty();
  }, [elements, getNextZIndex, markDirty, pushUndoSnapshot]);

  const removeComparisonTarget = (id, targetIndex) => {
    const element = elements.find((candidate) => candidate.id === id);
    if (!element || targetIndex < 2) return;
    const nextList = (Array.isArray(element.comparisonSelectionList) ? element.comparisonSelectionList : [])
      .filter((_, index) => index !== targetIndex - 2);
    updateElement(id, { comparisonSelectionList: nextList });
  };

  const requestConfirmation = (dialog) => new Promise((resolve) => {
    confirmResolveRef.current = resolve;
    setConfirmDialog(dialog);
  });

  const resolveConfirmation = (result) => {
    confirmResolveRef.current?.(result);
    confirmResolveRef.current = null;
    setConfirmDialog(null);
  };

  const handleDragResizeStop = (id, newX, newY, newWidth, newHeight) => {
      const resizedElement = elements.find((element) => element.id === id);
      const snappedPosition = getSnappedElementPosition(
        { ...resizedElement, width: newWidth, height: newHeight },
        elements,
        newX,
        newY
      );
      const finalHeight = resizedElement?.type === 'summary'
        ? Math.max(newHeight, getAutoSummaryHeight({ ...resizedElement, width: newWidth }, isComparison, newWidth))
        : newHeight;
      const finalX = snappedPosition.x;
      let finalY = snappedPosition.y;
      const startPage = Math.floor(finalY / PAGE_HEIGHT);
      const endPage = Math.floor((finalY + finalHeight - 1) / PAGE_HEIGHT);

      if (startPage !== endPage) finalY = (endPage * PAGE_HEIGHT) + 48;
      
      updateElement(id, { x: finalX, y: finalY, width: newWidth, height: finalHeight });
      setSnapGuides({ vertical: [], horizontal: [] });
      setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  };

  const handleElementDrag = (id, data) => {
    const movingElement = elements.find((element) => element.id === id);
    if (!movingElement) return;
    const snappedPosition = getSnappedElementPosition(
      movingElement,
      elements,
      data.x,
      data.y - reportContentOffset
    );
    setSnapGuides({
      vertical: snappedPosition.verticalGuides,
      horizontal: snappedPosition.horizontalGuides,
    });
  };

  const getNewElementPosition = () => {
    const scrollTop = canvasRef.current ? canvasRef.current.scrollTop : 0;
    const viewportY = scrollTop - reportContentOffset + 120;
    const minY = hasDocumentHeader ? 192 : 48;
    return {
      x: 48,
      y: Math.max(minY, Math.floor(viewportY / GRID_SIZE) * GRID_SIZE),
    };
  };

  const addNewElement = (type) => {
    const selectedChart = elements.find((element) => element.id === selectedElementId && element.type === 'chart');
    const summaryForChart = type === 'summary' && selectedChart;
    const defaultPosition = getNewElementPosition();
    const x = summaryForChart ? selectedChart.x : defaultPosition.x;
    const aboveChartY = summaryForChart ? selectedChart.y - DEFAULT_SUMMARY_HEIGHT - GRID_SIZE : defaultPosition.y;
    const y = summaryForChart
      ? (aboveChartY >= 192 ? aboveChartY : selectedChart.y + selectedChart.height + GRID_SIZE)
      : defaultPosition.y;

    const newId = `${type}-${Date.now()}`;
    const newEl = { id: newId, type, x, y, zIndex: getNextZIndex(), style: {} };

    // Strict color declarations keep exports consistent with the light report theme.
    if (type === 'text') { 
        newEl.width = 384; newEl.height = 72; newEl.content = 'New Text Block'; 
        newEl.style = { fontSize: '16px', fontFamily: FONT_FAMILY_OPTIONS[0].value, color: DEFAULT_TEXT_COLOR, background: DEFAULT_CARD_BACKGROUND, fontWeight: 'normal', textAlign: 'left' };
    }
    if (type === 'divider') {
      newEl.width = DEFAULT_REPORT_WIDTH;
      newEl.height = 24;
      newEl.orientation = 'horizontal';
      newEl.style = { line: '2px solid #e2e8f0', borderBottom: '2px solid #e2e8f0' };
    }
    if (type === 'chart' || type === 'summary') { 
        newEl.width = DEFAULT_REPORT_WIDTH;
        newEl.height = type === 'summary' ? getAutoSummaryHeight(newEl, isComparison, DEFAULT_REPORT_WIDTH) : DEFAULT_CHART_HEIGHT;
        newEl.label = type === 'chart' ? `Chart ${elements.filter((element) => element.type === 'chart').length + 1}` : undefined;
        newEl.useReportTimeframe = true;
        newEl.timeType = reportSettings.timeframe;
        newEl.chartType = type === 'chart' ? (isComparison ? 'line' : 'combo') : undefined;
        newEl.summaryMetric = type === 'summary' && isComparison ? 'totalVolume' : undefined;
        newEl.summaryMetrics = type === 'summary'
          ? (isComparison ? DEFAULT_COMPARISON_SUMMARY_METRICS : DEFAULT_SUMMARY_METRICS)
          : undefined;
        if (type === 'summary') newEl.height = getAutoSummaryHeight(newEl, isComparison, newEl.width);
        newEl.selections = summaryForChart ? selectedChart.selections : selections;
        newEl.comparisonSelections = summaryForChart ? selectedChart.comparisonSelections : comparisonSelections;
        newEl.comparisonSelectionList = summaryForChart ? selectedChart.comparisonSelectionList : [];
        newEl.attachedChartId = summaryForChart ? selectedChart.id : undefined;
        newEl.style = { borderRadius: '12px', background: '#ffffff' }; 
    }
    
    pushUndoSnapshot();
    setElements([...elements, newEl]);
    setSelectedElementId(newId);
    markDirty();
  };

  const addLinkElement = () => {
    const { x, y } = getNewElementPosition();
    const newId = `link-${Date.now()}`;
    const newEl = {
      id: newId,
      type: 'link',
      x,
      y,
      width: 384,
      height: 96,
      zIndex: getNextZIndex(),
      label: 'Reference Link',
      href: 'https://',
      style: { borderRadius: '12px', background: '#ffffff' },
    };

    pushUndoSnapshot();
    setElements([...elements, newEl]);
    setSelectedElementId(newId);
    markDirty();
  };

  const addUploadedElement = (file) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const { x, y } = getNewElementPosition();
      const isImage = file.type.startsWith('image/');
      const newId = `${isImage ? 'image' : 'attachment'}-${Date.now()}`;
      const newEl = {
        id: newId,
        type: isImage ? 'image' : 'attachment',
        x,
        y,
        width: isImage ? 432 : 384,
        height: isImage ? 288 : 112,
        zIndex: getNextZIndex(),
        src: reader.result,
        fileName: file.name,
        fileType: file.type,
        label: file.name,
        style: { borderRadius: '12px', background: '#ffffff' },
      };

      pushUndoSnapshot();
      setElements([...elements, newEl]);
      setSelectedElementId(newId);
      markDirty();
    };
    reader.readAsDataURL(file);
  };

  const addPage = () => {
    pushUndoSnapshot();
    setPageCount((currentPageCount) => currentPageCount + 1);
    markDirty();
  };

  const removePage = () => {
    pushUndoSnapshot();
    setPageCount((currentPageCount) => Math.max(DEFAULT_PAGE_COUNT, currentPageCount - 1));
    markDirty();
  };

  const deleteSelected = useCallback(() => {
    if (selectedElementId) {
      pushUndoSnapshot();
      setElements(elements.filter(el => el.id !== selectedElementId));
      setSelectedElementId(null);
      markDirty();
    }
  }, [elements, markDirty, pushUndoSnapshot, selectedElementId]);

  const alignSelectedHorizontal = (position) => {
    if (!activeElement) return;
    const pageWidth = PAGE_WIDTH;
    const nextX = position === 'left'
      ? 48
      : position === 'right'
        ? pageWidth - activeElement.width - 48
        : Math.round((pageWidth - activeElement.width) / 2 / GRID_SIZE) * GRID_SIZE;

    pushUndoSnapshot();
    setElements(elements.map((element) => (
      element.id === activeElement.id ? { ...element, x: nextX } : element
    )));
    markDirty();
  };

  const alignSelectedVertical = (position) => {
    if (!activeElement) return;
    const currentPage = Math.max(0, Math.floor(activeElement.y / PAGE_HEIGHT));
    const pageTop = currentPage * PAGE_HEIGHT;
    const pageContentTop = currentPage === 0 && hasDocumentHeader ? 192 : pageTop + 48;
    const pageBottom = pageTop + PAGE_HEIGHT - 80;
    const nextY = position === 'top'
      ? pageContentTop
      : position === 'bottom'
        ? pageBottom - activeElement.height
        : Math.round((pageTop + ((PAGE_HEIGHT - activeElement.height) / 2)) / GRID_SIZE) * GRID_SIZE;

    pushUndoSnapshot();
    setElements(elements.map((element) => (
      element.id === activeElement.id ? { ...element, y: nextY } : element
    )));
    markDirty();
  };

  const captureReportPages = async () => {
    commitTextDrafts();
    const element = reportRef.current;
    if (!element) return [];
    let originalHeight = '';

    flushSync(() => {
      setIsDownloading(true);
    });

    try {
      await waitForNextPaint();
      
      const totalRequiredHeight = totalVisiblePageCount * PAGE_HEIGHT;
      
      originalHeight = element.style.height;
      element.style.height = `${totalRequiredHeight}px`;
      await waitForReportReady(element, 2500);
      await waitForNextPaint();

      const captureOptions = {
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        ignoreElements: (node) => node?.classList?.contains?.('recharts-tooltip-wrapper'),
      };

      let reportCanvas;
      try {
        reportCanvas = await html2canvas(element, {
          ...captureOptions,
          width: PAGE_WIDTH,
          height: totalRequiredHeight,
          windowWidth: PAGE_WIDTH,
          windowHeight: totalRequiredHeight,
          scale: 2,
        });
      } catch (primaryError) {
        console.warn('High resolution report capture failed, retrying preview capture:', primaryError);
        reportCanvas = await html2canvas(element, {
          ...captureOptions,
          width: PAGE_WIDTH,
          height: totalRequiredHeight,
          windowWidth: PAGE_WIDTH,
          windowHeight: totalRequiredHeight,
          scale: 1,
          foreignObjectRendering: true,
        });
      }

      return Array.from({ length: totalVisiblePageCount }, (_, pageIndex) => (
        createPageImageFromReportCanvas(reportCanvas, pageIndex)
      ));
    } catch (error) {
      console.error("Failed to capture report:", error);
      return [];
    } finally {
      element.style.height = originalHeight;
      setIsDownloading(false);
    }
  };

  const downloadPdfFromPages = (pages = []) => {
    if (!pages.length) return;

    const pdf = new jsPDF(reportSettings.pdfOrientation === 'landscape' ? 'l' : 'p', 'mm', reportSettings.pdfSize);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    pages.forEach((page, pageIndex) => {
      if (pageIndex > 0) pdf.addPage();

      const pageWidth = page.width || PAGE_WIDTH;
      const pageHeight = page.height || PAGE_HEIGHT;
      const fitScale = Math.min(pdfWidth / pageWidth, pdfHeight / pageHeight);
      const imgWidth = pageWidth * fitScale;
      const imgHeight = pageHeight * fitScale;
      const x = (pdfWidth - imgWidth) / 2;
      const y = (pdfHeight - imgHeight) / 2;

      pdf.addImage(page.src, 'PNG', x, y, imgWidth, imgHeight);
    });
    
    pdf.save(`${docMeta.title.replace(/\s+/g, '_')}_Report.pdf`);
  };

  const handleExportPreview = () => {
    exportPageCountRef.current = totalVisiblePageCount;
    setExportPreviewPages(Array.from({ length: totalVisiblePageCount }, (_, index) => ({ label: `Page ${index + 1}` })));
    setExportPreviewImage('standard-page-view');
  };

  const handleDownloadPDF = async () => {
    const pages = await captureReportPages();
    if (!pages.length) {
      alert('Export could not be generated. Please try again after the charts finish rendering.');
      return;
    }
    downloadPdfFromPages(pages);
    setExportPreviewImage('');
    setExportPreviewPages([]);
    exportPageCountRef.current = DEFAULT_PAGE_COUNT;
  };

  const handleSaveLayout = async() => {
    setIsSaved(false);
    const committedElements = commitTextDrafts();
    if (reportRef.current) {
      await waitForReportReady(reportRef.current);
      await waitForNextPaint();
    }

    const { data: userResult } = await supabase.auth.getUser();
    const savedBy = userResult?.user?.email || docMeta.author || 'Unknown user';
    const nextReportSettings = {
      ...reportSettings,
      lastSavedBy: savedBy,
      lastSavedAt: new Date().toISOString(),
    };

    const payload = {
        title: docMeta.title,
        author: docMeta.author,
        period: docMeta.period,
        date: docMeta.date,
        layout_data: getSavedReportState({
          mode: type,
          elements: committedElements,
          pageCount: visiblePageCount,
          selections,
          comparisonSelections,
          reportSettings: nextReportSettings,
        }),
    };

    try {
      let response;
      
      if (reportId) {
        // Update existing report
        response = await supabase
          .from('saved_reports')
          .update(payload)
          .eq('id', reportId);
      } else {
        // Insert brand new report
        response = await supabase
          .from('saved_reports')
          .insert([payload])
          .select(); 
          
        if (!response.error && response.data?.[0]) {
          const newId = response.data[0].id;
          setReportId(newId);
          // Safely updates the URL so React Router knows this is now an existing document
          setSearchParams({ id: newId }); 
        }
      }

      if (response.error) throw response.error;

      setReportSettings(nextReportSettings);
      lastCleanSnapshotRef.current = JSON.stringify(getSavedReportState({
        mode: type,
        elements: committedElements,
        pageCount: visiblePageCount,
        selections,
        comparisonSelections,
        reportSettings: nextReportSettings,
      }));
      setIsSaved(true);
      setIsDirty(false);
      setTimeout(() => setIsSaved(false), 3000);
      return true;
    } catch (error) {
      console.error('Failed to save layout:', error.message);
      alert('Failed to save layout. Make sure your database table exists!');
      return false;
    }
  };

  const handleExitRequest = async () => {
    const committedElements = commitTextDrafts();
    if (!isDirty) {
      navigate('/insights-studio');
      return;
    }

    if (!hasActualUnsavedChanges(committedElements)) {
      setIsDirty(false);
      navigate('/insights-studio');
      return;
    }

    const exitAction = await requestConfirmation({
      title: 'Unsaved report changes',
      message: 'Save this report before leaving Insights Studio?',
      actions: [
        { value: 'cancel', label: 'Keep editing', variant: 'secondary' },
        { value: 'discard', label: 'Leave without saving', variant: 'danger' },
        { value: 'save', label: 'Save and leave', variant: 'primary' },
      ],
    });

    if (exitAction === 'save') {
      const didSave = await handleSaveLayout();
      if (didSave) navigate('/insights-studio');
    }

    if (exitAction === 'discard') {
      navigate('/insights-studio');
    }
  };

  useEffect(() => {
    if (!isDirty || !hasActualUnsavedChanges()) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasActualUnsavedChanges, isDirty]);

  useEffect(() => {
    const handleKeyboardDelete = (event) => {
      const isUndo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z';
      const isRedo = isUndo && event.shiftKey;
      const isCopy = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c';
      const isPaste = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v';
      if (isRedo && !confirmDialog && !isFormField(event.target)) {
        event.preventDefault();
        redoLastChange();
        return;
      }

      if (isUndo && !confirmDialog && !isFormField(event.target)) {
        event.preventDefault();
        undoLastChange();
        return;
      }

      if (isCopy && selectedElementId && !confirmDialog && !isFormField(event.target)) {
        event.preventDefault();
        copySelectedElement();
        return;
      }

      if (isPaste && !confirmDialog && !isFormField(event.target)) {
        event.preventDefault();
        pasteCopiedElement();
        return;
      }

      if ((event.key !== 'Delete' && event.key !== 'Backspace') || !selectedElementId || confirmDialog || isFormField(event.target)) {
        return;
      }

      event.preventDefault();
      deleteSelected();
    };

    window.addEventListener('keydown', handleKeyboardDelete);
    return () => window.removeEventListener('keydown', handleKeyboardDelete);
  }, [confirmDialog, copySelectedElement, deleteSelected, pasteCopiedElement, redoLastChange, selectedElementId, undoLastChange]);

  const renderTargetControls = ({
    title: sectionTitle = 'Data Source',
    targetSelections,
    targetFloors,
    onChange,
  }) => (
    <div className={styles.sidebarSection}>
      <h4 className={styles.sidebarSectionTitle}>{sectionTitle}</h4>
      <label className={styles.inputLabel}>Institute</label>
      <select className={styles.inputField} value={targetSelections.areaId} onChange={(e) => onChange({ ...EMPTY_TARGET_SELECTION, areaId: e.target.value })}>
        <option value="">Select an Institute...</option>
        {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>

      {targetSelections.areaId && targetFloors.length > 0 && (
        <>
          <label className={styles.inputLabel}>Corridor</label>
          <select className={styles.inputField} value={targetSelections.floorNumber} onChange={(e) => onChange({ ...targetSelections, buildingId: '', floorNumber: e.target.value, roomId: '' })}>
            <option value="">Whole Institute</option>
            {targetFloors.map((f) => {
              const targetSensor = allRooms.find((sensor) => sensor.sensor_id === f);
              return (
                <option key={f} value={f}>
                  {targetSensor?.corridor_name || `Corridor ${f}`}
                </option>
              );
            })}
          </select>
        </>
      )}

      {targetSelections.areaId && targetFloors.length === 0 && (
        <p className={styles.fieldHint}>No corridors found for this institute yet.</p>
      )}
    </div>
  );

  const renderModuleTargetControls = (element) => {
    const primarySelections = getElementPrimarySelections(element);
    const comparisonSelectionList = getElementComparisonSelectionList(element);

    if (isComparison) {
      return (
        <>
          {comparisonSelectionList.map((targetSelections, index) => (
            <div key={`${element.id}-comparison-target-${index}`} className={styles.comparisonTargetBlock}>
              {renderTargetControls({
                title: 'Data source',
                targetSelections,
                targetFloors: getFloorsForSelections(targetSelections),
                onChange: (nextSelections) => updateElementComparisonListTarget(element.id, index, nextSelections),
              })}
              {index >= 2 && (
                <button type="button" className={styles.dangerInlineBtn} onClick={() => removeComparisonTarget(element.id, index)}>
                  Remove
                </button>
              )}
            </div>
          ))}
          <button type="button" className={styles.secondaryBtnFull} onClick={() => addComparisonTarget(element.id)}>
            Add another data source
          </button>
        </>
      );
    }

    return (
      <>
        {renderTargetControls({
          title: 'Data source',
          targetSelections: primarySelections,
          targetFloors: getFloorsForSelections(primarySelections),
          onChange: (nextSelections) => updateElementTarget(element.id, 'selections', nextSelections),
        })}
      </>
    );
  };

  const renderElementContent = (el) => {
    const elementPrimarySelections = getElementPrimarySelections(el);
    const elementComparisonSelections = getElementComparisonSelections(el);
    const elementPrimaryTarget = getTargetFromSelections(elementPrimarySelections, '');
    const elementSecondaryTarget = getTargetFromSelections(elementComparisonSelections, '');
    const elementComparisonTargets = isComparison ? getElementComparisonTargets(el) : [elementPrimaryTarget, elementSecondaryTarget];
    const elementHasSoloTarget = Boolean(elementPrimaryTarget.id);
    const elementHasComparisonTargets = elementComparisonTargets.filter((target) => target.id).length >= 2;
    const elementSnapshotKey = getSnapshotKey({
      mode: type,
      target: elementPrimaryTarget,
      secondaryTarget: elementSecondaryTarget,
      targets: isComparison ? elementComparisonTargets : undefined,
      filters: reportFilters,
      timeframe: reportSettings.timeframe,
    });

    if (el.type === 'text') {
      const isEditing = editingTextId === el.id;
      const savedTextHtml = getTextHtml(el);
      const textHtml = textDraftsRef.current[el.id] ?? savedTextHtml;

      return (
        <div
          data-text-element-id={el.id}
          contentEditable={isEditing && !isDownloading}
          suppressContentEditableWarning
          onFocus={() => setSelectedElementId(el.id)}
          onInput={(event) => {
            const nextHtml = event.currentTarget.innerHTML;
            textDraftsRef.current[el.id] = nextHtml;
            markDirty();
          }}
          onBlur={(event) => {
            const nextHtml = event.currentTarget.innerHTML;
            textDraftsRef.current[el.id] = nextHtml;
            if (event.relatedTarget?.closest?.('[data-insights-editor-sidebar="true"]')) {
              markDirty();
              return;
            }
            if (nextHtml !== savedTextHtml) updateElement(el.id, { html: nextHtml, content: stripHtml(nextHtml) });
            setEditingTextId(null);
          }}
          onMouseUp={() => saveTextSelection(el.id)}
          onKeyUp={() => saveTextSelection(el.id)}
          onMouseDown={(event) => {
            if (isEditing) event.stopPropagation();
          }}
          style={{ width: '100%', height: '100%', overflow: 'hidden', fontSize: getTextFontSize(el), fontFamily: el.style.fontFamily || FONT_FAMILY_OPTIONS[0].value, color: el.style.color || DEFAULT_TEXT_COLOR, fontWeight: el.style.fontWeight, textAlign: el.style.textAlign, outline: 'none', whiteSpace: 'pre-wrap', cursor: isEditing ? 'text' : 'move', lineHeight: 1.18 }}
          dangerouslySetInnerHTML={{ __html: textHtml }}
        />
      );
    }
    if (el.type === 'divider') {
      const lineStyle = el.style.line || el.style.borderBottom || el.style.borderLeft || '2px solid #e2e8f0';
      const isVertical = el.orientation === 'vertical';
      return (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={isVertical ? { height: '100%', borderLeft: lineStyle } : { width: '100%', borderBottom: lineStyle }} />
        </div>
      );
    }
    if (el.type === 'image') return <img src={el.src} alt={el.label || el.fileName || 'Inserted report visual'} className={styles.insertedImage} />;
    if (el.type === 'attachment') return (
      <a href={el.src} download={el.fileName} className={styles.attachmentCard}>
        <FileText size={24} />
        <span>{el.label || el.fileName || 'Attachment'}</span>
        <small>{el.fileType || 'File'}</small>
      </a>
    );
    if (el.type === 'link') return (
      <a href={el.href} target="_blank" rel="noreferrer" className={styles.linkCard}>
        <Link2 size={22} />
        <span>{el.label || 'Reference Link'}</span>
        <small>{el.href}</small>
      </a>
    );
    if (isComparison && !elementHasComparisonTargets) return <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', fontStyle: 'italic', opacity: 0.6 }}>Select two data sources in the sidebar.</div>;
    if (!isComparison && !elementHasSoloTarget) return <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', fontStyle: 'italic', opacity: 0.6 }}>Select a data source in the sidebar.</div>;

    if (el.type === 'summary' && isComparison) return <div style={{ width: '100%', height: '100%' }}><ComparisonSummaryMetrics targets={elementComparisonTargets} filters={reportFilters} timeframe={reportSettings.timeframe} metricMode={el.summaryMetric || 'totalVolume'} metricModes={el.summaryMetrics || DEFAULT_COMPARISON_SUMMARY_METRICS} snapshotData={el.snapshotKey === elementSnapshotKey ? el.snapshotData : undefined} onSnapshotData={(data) => updateElementSnapshot(el.id, elementSnapshotKey, data)} /></div>;
    if (el.type === 'summary') return <div style={{ width: '100%', height: '100%' }}><SummaryMetrics level={elementPrimaryTarget.level} id={elementPrimaryTarget.id} filters={reportFilters} timeframe={reportSettings.timeframe} metrics={el.summaryMetrics || DEFAULT_SUMMARY_METRICS} snapshotData={el.snapshotKey === elementSnapshotKey ? el.snapshotData : undefined} onSnapshotData={(data) => updateElementSnapshot(el.id, elementSnapshotKey, data)} /></div>;
    if (el.type === 'chart' && isComparison) return (
      <ChartFrame title={getChartDisplayName(el)}>
        <ComparisonAggregateChart targets={elementComparisonTargets} filters={reportFilters} type={reportSettings.timeframe} plotType={el.chartType || 'line'} snapshotData={el.snapshotKey === elementSnapshotKey ? el.snapshotData : undefined} onSnapshotData={(data) => updateElementSnapshot(el.id, elementSnapshotKey, data)} seriesColors={el.seriesColors || []} peopleSeriesColors={el.peopleSeriesColors || []} thresholdEnabled={Boolean(el.thresholdEnabled)} thresholdValue={el.thresholdValue} thresholdLabel={el.thresholdLabel || 'Threshold'} thresholdColor={el.thresholdColor || '#ef4444'} showLegend={el.showLegend ?? true} legendItems={el.legendItems} customMetrics={el.customMetrics} frameless />
      </ChartFrame>
    );
    if (el.type === 'chart') return (
      <ChartFrame title={getChartDisplayName(el)}>
        <AggregateChart level={elementPrimaryTarget.level} id={elementPrimaryTarget.id} filters={reportFilters} type={reportSettings.timeframe} plotType={el.chartType || 'combo'} snapshotData={el.snapshotKey === elementSnapshotKey ? el.snapshotData : undefined} onSnapshotData={(data) => updateElementSnapshot(el.id, elementSnapshotKey, data)} highlightMode={el.highlightPeak ? 'peak' : 'none'} highlightLabel={el.highlightLabel || 'Peak'} occupancyColor={el.occupancyColor || '#7cb49c'} peopleColor={el.peopleColor || '#6b7280'} highlightColor={el.highlightColor || '#f59e0b'} thresholdEnabled={Boolean(el.thresholdEnabled)} thresholdValue={el.thresholdValue} thresholdLabel={el.thresholdLabel || 'Threshold'} thresholdColor={el.thresholdColor || '#ef4444'} showLegend={el.showLegend ?? ['combo', 'custom'].includes(el.chartType || 'combo')} legendItems={el.legendItems} customMetrics={el.customMetrics} frameless />
      </ChartFrame>
    );
    if (el.type === 'table') return <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', opacity: 0.6 }}>[ Customizable Data Table ]</div>;
    return null;
  };

  const renderStandardPreviewPage = (pageIndex) => {
    const pageTop = pageIndex * PAGE_HEIGHT;

    return (
      <div className={styles.exportPreviewLivePage}>
        <div
          className={styles.exportPreviewLiveReport}
          style={{ height: `${totalVisiblePageCount * PAGE_HEIGHT}px`, top: `-${pageTop}px` }}
        >
          {hasCoverPage && (
            <section
              className={`${styles.coverPage} ${styles[`coverPage${String(reportSettings.coverLayout || 'classic').charAt(0).toUpperCase()}${String(reportSettings.coverLayout || 'classic').slice(1)}`] || ''}`}
              style={{
                '--cover-accent': getColorInputValue(reportSettings.coverAccentColor, '#2f716f'),
                '--cover-bg': getColorInputValue(reportSettings.coverBackground, '#f7fbfa'),
              }}
            >
              <p
                className={styles.coverEyebrow}
                style={{
                  position: 'absolute',
                  left: `${reportSettings.coverEyebrowX ?? 72}px`,
                  top: `${reportSettings.coverEyebrowY ?? 88}px`,
                  width: '704px',
                  height: '48px',
                  fontSize: reportSettings.coverEyebrowFontSize,
                  fontFamily: reportSettings.coverFontFamily,
                }}
              >
                {reportSettings.coverEyebrow}
              </p>
              <h1
                style={{
                  position: 'absolute',
                  left: `${reportSettings.coverTitleX ?? 72}px`,
                  top: `${reportSettings.coverTitleY ?? 160}px`,
                  width: '704px',
                  height: '136px',
                  fontSize: reportSettings.coverTitleFontSize,
                  fontFamily: reportSettings.coverFontFamily,
                }}
              >
                {docMeta.title}
              </h1>
              <p
                style={{
                  position: 'absolute',
                  left: `${reportSettings.coverSubtitleX ?? 72}px`,
                  top: `${reportSettings.coverSubtitleY ?? 312}px`,
                  width: '704px',
                  height: '72px',
                  fontSize: reportSettings.coverSubtitleFontSize,
                  fontFamily: reportSettings.coverFontFamily,
                }}
              >
                {reportSettings.coverSubtitle || 'Add a short report subtitle'}
              </p>
              <div
                className={styles.coverMeta}
                style={{
                  position: 'absolute',
                  left: `${reportSettings.coverMetaX ?? 72}px`,
                  top: `${reportSettings.coverMetaY ?? 1040}px`,
                  width: '704px',
                  height: '88px',
                  fontSize: reportSettings.coverMetaFontSize,
                  fontFamily: reportSettings.coverFontFamily,
                }}
              >
                <span>Prepared by {docMeta.author}</span>
                <span>{docMeta.date}</span>
                <span>{primaryTarget.label || docMeta.title}</span>
              </div>
            </section>
          )}

          {hasDocumentHeader && (
            <div className={styles.documentHeader} style={{ position: 'absolute', top: `${reportContentOffset + 48}px`, left: '48px', right: '48px', width: `${DEFAULT_REPORT_WIDTH}px` }}>
              <h1 className={styles.documentTitle}>{docMeta.title}</h1>
              <div className={styles.documentMetaGrid}>
                <div className={styles.metaItem}><span className={styles.metaLabel}>Author</span><span className={styles.metaValue}>{docMeta.author}</span></div>
                <div className={styles.metaItem}><span className={styles.metaLabel}>Date Created</span><span className={styles.metaValue}>{docMeta.date}</span></div>
                <div className={styles.metaItem}><span className={styles.metaLabel}>Timeframe</span><span className={styles.metaValue}>{reportSettings.timeframe === 'daily' ? '24hr' : reportSettings.timeframe === 'weekly' ? 'Weekly' : reportSettings.timeframe === 'monthly' ? 'Monthly' : 'Custom'}</span></div>
              </div>
            </div>
          )}

          {elements.map((el) => {
            const currentBg = el.style.background || DEFAULT_CARD_BACKGROUND;

            return (
              <div
                key={el.id}
                style={{
                  position: 'absolute',
                  left: `${el.x}px`,
                  top: `${el.y + reportContentOffset}px`,
                  width: `${el.width}px`,
                  height: `${el.height}px`,
                  zIndex: el.zIndex || 1,
                  pointerEvents: 'none',
                }}
              >
                <div
                  className={`${styles.widgetBox} ${el.type === 'chart' ? styles.chartWidgetBox : ''}`}
                  style={{
                    backgroundColor: ['divider', 'chart', 'summary'].includes(el.type) ? 'transparent' : currentBg,
                    borderRadius: el.style.borderRadius,
                    padding: ['divider', 'image', 'chart', 'summary'].includes(el.type) ? '0' : '16px',
                    boxSizing: 'border-box',
                    border: ['text', 'divider', 'image', 'chart', 'summary'].includes(el.type) ? 'none' : undefined,
                    boxShadow: ['text', 'divider', 'image', 'chart', 'summary'].includes(el.type) ? 'none' : undefined,
                  }}
                >
                  {renderElementContent(el)}
                </div>
              </div>
            );
          })}

          {reportSettings.showFooter && Array.from({ length: totalVisiblePageCount }).map((_, index) => (
            <footer key={`preview-footer-${index}`} className={styles.reportFooter} style={{ top: `${((index + 1) * PAGE_HEIGHT) - 56}px` }}>
              <span>CheckIt</span>
              <span>{docMeta.title}</span>
              <span>Page {index + 1}</span>
            </footer>
          ))}
        </div>
      </div>
    );
  };

  // Ensure app stays strictly in light mode
  return (
    <main className={styles.builderPage} data-theme="light">
      
      {/* TOP NAVBAR */}
      <header className={styles.builderTopNav}>
        <div className={styles.navGroup}>
          <button onClick={handleExitRequest} className={styles.backLink}>← Back</button>
          <span className={styles.navTitle}>{title} Builder</span>
        </div>
        
        <div className={styles.navGroup}>
          <button onClick={() => addNewElement('text')} className={styles.toolbarBtn}><Type size={14} /> Text</button>
          <button onClick={() => addNewElement('chart')} className={styles.toolbarBtn}><BarChart2 size={14} /> Chart</button>
          <button onClick={() => addNewElement('summary')} className={styles.toolbarBtn}><Layers size={14} /> Banner</button>
          <button onClick={() => uploadInputRef.current?.click()} className={styles.toolbarBtn}><ImagePlus size={14} /> Insert</button>
          <button onClick={addLinkElement} className={styles.toolbarBtn}><Link2 size={14} /> Link</button>
          <button onClick={() => addNewElement('divider')} className={styles.toolbarBtn}><MinusSquare size={14} /> Divider</button>
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*,application/pdf"
            className={styles.hiddenFileInput}
            onChange={(event) => {
              addUploadedElement(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>

        <div className={styles.navGroup}>
          <button onClick={handleExportPreview} disabled={isDownloading} className={styles.toolbarBtn}>
             <Download size={16} /> Preview Export
          </button>
          <button onClick={handleSaveLayout} className={styles.primaryBtn}>
             {isSaved ? 'Saved!' : 'Save Layout'}
          </button>
        </div>
      </header>

      <div className={styles.workspace}>
        
        {/* LEFT SIDEBAR */}
        <div className={`${styles.sidebarPanel} ${styles.left}`}>
          <h3 className={styles.sidebarTitle}>Document Metadata</h3>
          
          <label className={styles.inputLabel}>Report Title</label>
          <input type="text" value={docMeta.title} onChange={(e) => updateDocMeta({ title: e.target.value })} className={styles.inputField} />
          
          <label className={styles.inputLabel}>Author / Department</label>
          <input type="text" value={docMeta.author} onChange={(e) => updateDocMeta({ author: e.target.value })} className={styles.inputField} />
          
          <label className={styles.inputLabel}>Date</label>
          <input type="text" value={docMeta.date} onChange={(e) => updateDocMeta({ date: e.target.value })} className={styles.inputField} />
          
          <h3 className={styles.sidebarTitle}>Report Timeframe</h3>
          <label className={styles.inputLabel}>Default Timeframe</label>
          <select className={styles.inputField} value={reportSettings.timeframe} onChange={(e) => updateReportTimeframe(e.target.value)}>
            <option value="daily">24hr</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="custom">Custom</option>
          </select>

          {reportSettings.timeframe === 'custom' && (
            <>
              <button type="button" onClick={resetCustomTimeframe} className={styles.timeframeResetBtn}>
                <RefreshCw size={14} /> Reset custom range
              </button>
              <div className={styles.twoColumnFields}>
                <div>
                  <label className={styles.inputLabel}>Start Date</label>
                  <input type="date" value={reportSettings.startDate} onChange={(e) => updateReportSettings({ startDate: e.target.value })} className={styles.inputField} />
                </div>
                <div>
                  <label className={styles.inputLabel}>End Date</label>
                  <input type="date" value={reportSettings.endDate} onChange={(e) => updateReportSettings({ endDate: e.target.value })} className={styles.inputField} />
                </div>
              </div>

              <div className={styles.twoColumnFields}>
                <div>
                  <label className={styles.inputLabel}>Start Time</label>
                  <input type="time" value={reportSettings.startTime} onChange={(e) => updateReportSettings({ startTime: e.target.value })} className={styles.inputField} />
                </div>
                <div>
                  <label className={styles.inputLabel}>End Time</label>
                  <input type="time" value={reportSettings.endTime} onChange={(e) => updateReportSettings({ endTime: e.target.value })} className={styles.inputField} />
                </div>
              </div>
            </>
          )}

          <label className={styles.inputLabel}>Days</label>
          <select className={styles.inputField} value={reportSettings.dayPreset} onChange={(e) => updateReportSettings({ dayPreset: e.target.value })}>
            <option value="all">All days</option>
            <option value="weekdays">Weekdays only</option>
            <option value="weekends">Weekends only</option>
          </select>

          <h3 className={styles.sidebarTitle}>Export</h3>
          <div className={styles.twoColumnFields}>
            <div>
              <label className={styles.inputLabel}>PDF Size</label>
              <select className={styles.inputField} value={reportSettings.pdfSize} onChange={(e) => updateReportSettings({ pdfSize: e.target.value })}>
                <option value="a4">A4</option>
                <option value="letter">Letter</option>
              </select>
            </div>
            <div>
              <label className={styles.inputLabel}>Orientation</label>
              <select className={styles.inputField} value={reportSettings.pdfOrientation} onChange={(e) => updateReportSettings({ pdfOrientation: e.target.value })}>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </div>
          </div>

          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={reportSettings.showCoverPage} onChange={(e) => updateReportSettings({ showCoverPage: e.target.checked })} />
            Cover page
          </label>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={reportSettings.showDocumentHeader} onChange={(e) => updateReportSettings({ showDocumentHeader: e.target.checked })} />
            Report header
          </label>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={reportSettings.showFooter} onChange={(e) => updateReportSettings({ showFooter: e.target.checked })} />
            Footer branding
          </label>
          <p className={styles.fieldHint}>Last saved by {reportSettings.lastSavedBy || 'Not saved yet'}</p>
        </div>

        {/* CENTER CANVAS */}
        <div ref={canvasRef} onMouseDown={(e) => { if(e.target === e.currentTarget) { commitTextDrafts(); setSelectedElementId(null); } }} className={styles.canvasArea}>
          {isReportLoading ? (
            <div className={styles.reportLoadingState}>Loading report...</div>
          ) : (
          <>
            <div
            ref={reportRef}
            className={styles.paperBoundary}
            onMouseDown={(e) => { if(e.target === e.currentTarget) { commitTextDrafts(); setSelectedElementId(null); } }}
            style={{ height: `${totalVisiblePageCount * PAGE_HEIGHT}px`, backgroundColor: '#ffffff' }}
          >
            
            {Array.from({ length: totalVisiblePageCount }).map((_, i) => (
                i > 0 && (
                    <div key={`page-break-${i}`} data-html2canvas-ignore="true" className={styles.pageBreakMarker} style={{ top: i * PAGE_HEIGHT }}>
                        <span className={styles.pageBreakLabel}>Page {i + 1}</span>
                    </div>
                )
            ))}

            {!isDownloading && (
              <div data-html2canvas-ignore="true" className={styles.snapGuideLayer}>
                {snapGuides.vertical.map((x, index) => (
                  <span key={`snap-v-${index}-${x}`} className={styles.snapGuideVertical} style={{ left: `${x}px` }} />
                ))}
                {snapGuides.horizontal.map((y, index) => (
                  <span key={`snap-h-${index}-${y}`} className={styles.snapGuideHorizontal} style={{ top: `${y + reportContentOffset}px` }} />
                ))}
              </div>
            )}

            {hasCoverPage && (
              <section
                className={`${styles.coverPage} ${styles[`coverPage${String(reportSettings.coverLayout || 'classic').charAt(0).toUpperCase()}${String(reportSettings.coverLayout || 'classic').slice(1)}`] || ''}`}
                onMouseDown={() => {
                  setSelectedElementId('cover');
                  setEditingTextId(null);
                }}
                style={{
                  '--cover-accent': getColorInputValue(reportSettings.coverAccentColor, '#2f716f'),
                  '--cover-bg': getColorInputValue(reportSettings.coverBackground, '#f7fbfa'),
                }}
              >
                <Rnd
                  bounds="parent"
                  size={{ width: 704, height: 48 }}
                  position={{ x: reportSettings.coverEyebrowX ?? 72, y: reportSettings.coverEyebrowY ?? 88 }}
                  dragGrid={[GRID_SIZE, GRID_SIZE]}
                  enableResizing={false}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    setSelectedElementId('cover');
                  }}
                  onDragStop={(event, data) => updateReportSettings({ coverEyebrowX: data.x, coverEyebrowY: data.y })}
                >
                  <p
                    className={styles.coverEyebrow}
                    contentEditable={!isDownloading}
                    suppressContentEditableWarning
                    onMouseDown={(event) => event.stopPropagation()}
                    onBlur={(event) => updateReportSettings({ coverEyebrow: event.currentTarget.innerText })}
                    style={{ fontSize: reportSettings.coverEyebrowFontSize, fontFamily: reportSettings.coverFontFamily }}
                  >
                    {reportSettings.coverEyebrow}
                  </p>
                </Rnd>
                <Rnd
                  bounds="parent"
                  size={{ width: 704, height: 136 }}
                  position={{ x: reportSettings.coverTitleX ?? 72, y: reportSettings.coverTitleY ?? 160 }}
                  dragGrid={[GRID_SIZE, GRID_SIZE]}
                  enableResizing={false}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    setSelectedElementId('cover');
                  }}
                  onDragStop={(event, data) => updateReportSettings({ coverTitleX: data.x, coverTitleY: data.y })}
                >
                  <h1
                    contentEditable={!isDownloading}
                    suppressContentEditableWarning
                    onMouseDown={(event) => event.stopPropagation()}
                    onBlur={(event) => updateDocMeta({ title: event.currentTarget.innerText })}
                    style={{ fontSize: reportSettings.coverTitleFontSize, fontFamily: reportSettings.coverFontFamily }}
                  >
                    {docMeta.title}
                  </h1>
                </Rnd>
                <Rnd
                  bounds="parent"
                  size={{ width: 704, height: 72 }}
                  position={{ x: reportSettings.coverSubtitleX ?? 72, y: reportSettings.coverSubtitleY ?? 312 }}
                  dragGrid={[GRID_SIZE, GRID_SIZE]}
                  enableResizing={false}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    setSelectedElementId('cover');
                  }}
                  onDragStop={(event, data) => updateReportSettings({ coverSubtitleX: data.x, coverSubtitleY: data.y })}
                >
                  <p
                    contentEditable={!isDownloading}
                    suppressContentEditableWarning
                    onMouseDown={(event) => event.stopPropagation()}
                    onBlur={(event) => updateReportSettings({ coverSubtitle: event.currentTarget.innerText })}
                    style={{ fontSize: reportSettings.coverSubtitleFontSize, fontFamily: reportSettings.coverFontFamily }}
                  >
                    {reportSettings.coverSubtitle || 'Add a short report subtitle'}
                  </p>
                </Rnd>
                <Rnd
                  bounds="parent"
                  size={{ width: 704, height: 88 }}
                  position={{ x: reportSettings.coverMetaX ?? 72, y: reportSettings.coverMetaY ?? 1040 }}
                  dragGrid={[GRID_SIZE, GRID_SIZE]}
                  enableResizing={false}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    setSelectedElementId('cover');
                  }}
                  onDragStop={(event, data) => updateReportSettings({ coverMetaX: data.x, coverMetaY: data.y })}
                >
                  <div
                    className={styles.coverMeta}
                    style={{
                      fontSize: reportSettings.coverMetaFontSize,
                      fontFamily: reportSettings.coverFontFamily,
                    }}
                  >
                    <span>Prepared by {docMeta.author}</span>
                    <span>{docMeta.date}</span>
                    <span>{primaryTarget.label || docMeta.title}</span>
                  </div>
                </Rnd>
              </section>
            )}

            {hasDocumentHeader && (
              <div className={styles.documentHeader} onMouseDown={() => { commitTextDrafts(); setSelectedElementId(null); }} style={{ position: 'absolute', top: `${reportContentOffset + 48}px`, left: '48px', right: '48px', width: `${DEFAULT_REPORT_WIDTH}px` }}>
                <h1 className={styles.documentTitle}>{docMeta.title}</h1>
                <div className={styles.documentMetaGrid}>
                    <div className={styles.metaItem}><span className={styles.metaLabel}>Author</span><span className={styles.metaValue}>{docMeta.author}</span></div>
                    <div className={styles.metaItem}><span className={styles.metaLabel}>Date Created</span><span className={styles.metaValue}>{docMeta.date}</span></div>
                    <div className={styles.metaItem}><span className={styles.metaLabel}>Timeframe</span><span className={styles.metaValue}>{reportSettings.timeframe === 'daily' ? '24hr' : reportSettings.timeframe === 'weekly' ? 'Weekly' : reportSettings.timeframe === 'monthly' ? 'Monthly' : 'Custom'}</span></div>
                </div>
              </div>
            )}
            
            {elements.map((el) => {
              const isSelected = !isDownloading && selectedElementId === el.id;
              const currentBg = el.style.background || DEFAULT_CARD_BACKGROUND;

              return (
                <Rnd
                  key={el.id}
                  bounds="parent"
                  size={{ width: el.width, height: el.height }}
                  position={{ x: el.x, y: el.y + reportContentOffset }}
                  dragGrid={[GRID_SIZE, GRID_SIZE]} 
                  resizeGrid={[GRID_SIZE, GRID_SIZE]}
                  onResize={() => window.dispatchEvent(new Event('resize'))}
                  onDrag={(event, data) => handleElementDrag(el.id, data)}
                  onDragStop={(e, d) => handleDragResizeStop(el.id, d.x, d.y - reportContentOffset, el.width, el.height)}
                  onResizeStop={(e, direction, ref, delta, position) => {
                    const newWidth = parseInt(ref.style.width, 10);
                    const newHeight = parseInt(ref.style.height, 10);
                    handleDragResizeStop(el.id, position.x, position.y - reportContentOffset, newWidth, newHeight);
                  }}
                  onMouseDown={() => {
                    if (editingTextId && editingTextId !== el.id) commitTextDrafts();
                    setSelectedElementId(el.id);
                    if (editingTextId && editingTextId !== el.id) setEditingTextId(null);
                    if (el.type === 'text' && selectedElementId === el.id) {
                      setEditingTextId(el.id);
                      setTimeout(() => {
                        document.querySelector(`[data-text-element-id="${el.id}"]`)?.focus?.();
                      }, 0);
                    }
                  }}
                  onDoubleClick={(event) => {
                    setSelectedElementId(el.id);
                    if (el.type === 'text') {
                      setEditingTextId(el.id);
                      setTimeout(() => event.target?.focus?.(), 0);
                    }
                  }}
                  style={{ zIndex: isSelected ? (el.zIndex || 1) + 1000 : (el.zIndex || 1) }}
                  disableDragging={editingTextId === el.id}
                  enableResizing={isSelected} 
                  resizeHandleStyles={{
                    bottomRight: { width: '12px', height: '12px', background: '#3b82f6', border: '2px solid #fff', right: '-6px', bottom: '-6px', borderRadius: '50%', zIndex: 50 },
                    bottomLeft: { width: '12px', height: '12px', background: '#3b82f6', border: '2px solid #fff', left: '-6px', bottom: '-6px', borderRadius: '50%', zIndex: 50 },
                    topRight: { width: '12px', height: '12px', background: '#3b82f6', border: '2px solid #fff', right: '-6px', top: '-6px', borderRadius: '50%', zIndex: 50 },
                    topLeft: { width: '12px', height: '12px', background: '#3b82f6', border: '2px solid #fff', left: '-6px', top: '-6px', borderRadius: '50%', zIndex: 50 },
                  }}
                >
                  <div className={`${styles.widgetBox} ${el.type === 'chart' ? styles.chartWidgetBox : ''} ${isSelected ? styles.widgetBoxSelected : ''}`} style={{
                      backgroundColor: ['divider', 'chart', 'summary'].includes(el.type) ? 'transparent' : currentBg,
                      borderRadius: el.style.borderRadius, 
                      pointerEvents: isSelected || ['text', 'image', 'attachment', 'link'].includes(el.type) ? 'auto' : 'none', 
                      padding: ['divider', 'image', 'chart', 'summary'].includes(el.type) ? '0' : '16px',
                      boxSizing: 'border-box',
                      border: ['text', 'divider', 'image', 'chart', 'summary'].includes(el.type) ? 'none' : undefined,
                      boxShadow: ['text', 'divider', 'image', 'chart', 'summary'].includes(el.type) ? 'none' : undefined
                  }}>
                     {renderElementContent(el)}
                  </div>
                </Rnd>
              );
            })}

            {reportSettings.showFooter && Array.from({ length: totalVisiblePageCount }).map((_, index) => (
              <footer key={`footer-${index}`} className={styles.reportFooter} style={{ top: `${((index + 1) * PAGE_HEIGHT) - 56}px` }}>
                <span>CheckIt</span>
                <span>{docMeta.title}</span>
                <span>Page {index + 1}</span>
              </footer>
            ))}

          </div>

          {!isDownloading && pageCount > DEFAULT_PAGE_COUNT && (
            <div className={styles.pageControl} data-html2canvas-ignore="true" aria-label="Page controls">
              <button
                type="button"
                className={styles.pageControlButton}
                onClick={removePage}
                aria-label="Remove page"
                title="Remove page"
              >
                -
              </button>
              <button
                type="button"
                className={styles.pageControlButton}
                onClick={addPage}
                aria-label="Add page"
                title="Add page"
              >
                +
              </button>
            </div>
          )}

          {!isDownloading && pageCount === DEFAULT_PAGE_COUNT && (
            <div className={styles.pageControl} data-html2canvas-ignore="true" aria-label="Page controls">
              <button
                type="button"
                className={styles.pageControlButton}
                onClick={addPage}
                aria-label="Add page"
                title="Add page"
              >
                +
              </button>
            </div>
          )}
          </>
          )}
        </div>

        {/* RIGHT SIDEBAR */}
        <div className={`${styles.sidebarPanel} ${styles.right}`} data-insights-editor-sidebar="true">
          <h3 className={styles.sidebarTitle}>Widget Settings</h3>

          {!activeElement && !isCoverSelected ? (
            <div className={styles.emptyState}>Select an element on the report to edit it.</div>
          ) : isCoverSelected ? (
            <div>
              <div className={styles.sidebarSection}>
                <h4 className={styles.sidebarSectionTitle}>Cover Page</h4>
                <label className={styles.inputLabel}>Cover Style</label>
                <select className={styles.inputField} value={reportSettings.coverLayout} onChange={(e) => updateReportSettings({ coverLayout: e.target.value })}>
                  <option value="classic">Classic</option>
                  <option value="minimal">Minimal</option>
                  <option value="banded">Banded</option>
                  <option value="editorial">Editorial</option>
                  <option value="executive">Executive</option>
                  <option value="benchmark">Benchmark</option>
                </select>

                <div className={styles.twoColumnFields}>
                  <div>
                    <label className={styles.inputLabel}>Accent</label>
                    <input type="color" value={getColorInputValue(reportSettings.coverAccentColor, '#2f716f')} onChange={(e) => updateReportSettings({ coverAccentColor: e.target.value })} className={styles.colorPicker} />
                  </div>
                  <div>
                    <label className={styles.inputLabel}>Background</label>
                    <input type="color" value={getColorInputValue(reportSettings.coverBackground, '#f7fbfa')} onChange={(e) => updateReportSettings({ coverBackground: e.target.value })} className={styles.colorPicker} />
                  </div>
                </div>
                <div className={styles.twoColumnFields}>
                  <div>
                    <FontSizeControl label="Title Size" value={reportSettings.coverTitleFontSize} fallback={62} onChange={(value) => updateReportSettings({ coverTitleFontSize: value })} />
                  </div>
                  <div>
                    <FontSizeControl label="Subtitle Size" value={reportSettings.coverSubtitleFontSize} fallback={18} onChange={(value) => updateReportSettings({ coverSubtitleFontSize: value })} />
                  </div>
                </div>
                <div className={styles.twoColumnFields}>
                  <div>
                    <FontSizeControl label="Eyebrow Size" value={reportSettings.coverEyebrowFontSize} fallback={13} onChange={(value) => updateReportSettings({ coverEyebrowFontSize: value })} />
                  </div>
                  <div>
                    <FontSizeControl label="Meta Size" value={reportSettings.coverMetaFontSize} fallback={13} onChange={(value) => updateReportSettings({ coverMetaFontSize: value })} />
                  </div>
                </div>
                <FontFamilyControl value={reportSettings.coverFontFamily} onChange={(value) => updateReportSettings({ coverFontFamily: value })} />
              </div>
            </div>
          ) : (
            <div>
              <div className={styles.sidebarSection}>
                <h4 className={styles.sidebarSectionTitle}>Layout Tools</h4>
                <div className={styles.layoutToolGrid}>
                  <button type="button" onClick={() => alignSelectedHorizontal('left')} className={styles.iconToolBtn} title="Align left" aria-label="Align left"><AlignLeft size={16} /></button>
                  <button type="button" onClick={() => alignSelectedHorizontal('center')} className={styles.iconToolBtn} title="Align center" aria-label="Align center"><AlignCenter size={16} /></button>
                  <button type="button" onClick={() => alignSelectedHorizontal('right')} className={styles.iconToolBtn} title="Align right" aria-label="Align right"><AlignRight size={16} /></button>
                  <button type="button" onClick={() => alignSelectedVertical('top')} className={styles.iconToolBtn} title="Align top" aria-label="Align top"><AlignStartVertical size={16} /></button>
                  <button type="button" onClick={() => alignSelectedVertical('middle')} className={styles.iconToolBtn} title="Align middle" aria-label="Align middle"><AlignCenterVertical size={16} /></button>
                  <button type="button" onClick={() => alignSelectedVertical('bottom')} className={styles.iconToolBtn} title="Align bottom" aria-label="Align bottom"><AlignEndVertical size={16} /></button>
                </div>
              </div>

              {activeElement.type === 'text' && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div>
                          <FontSizeControl value={activeElement.style.fontSize || '16px'} fallback={16} onChange={(value) => updateElementStyle(activeElement.id, 'fontSize', value)} />
                      </div>
                      <div>
                          <label className={styles.inputLabel}>Weight</label>
                          <select value={activeElement.style.fontWeight || 'normal'} onChange={(e) => updateElementStyle(activeElement.id, 'fontWeight', e.target.value)} className={styles.inputField}>
                              <option value="normal">Normal</option>
                              <option value="bold">Bold</option>
                          </select>
                      </div>
                  </div>
                  <FontFamilyControl value={activeElement.style.fontFamily || FONT_FAMILY_OPTIONS[0].value} onChange={(value) => updateElementStyle(activeElement.id, 'fontFamily', value)} />

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div>
                          <label className={styles.inputLabel}>Align</label>
                          <select value={activeElement.style.textAlign || 'left'} onChange={(e) => updateElementStyle(activeElement.id, 'textAlign', e.target.value)} className={styles.inputField}>
                              <option value="left">Left</option>
                              <option value="center">Center</option>
                              <option value="right">Right</option>
                          </select>
                      </div>
                      <div>
                          <label className={styles.inputLabel}>Text Color</label>
                          <input type="color" value={getColorInputValue(activeElement.style.color, DEFAULT_TEXT_COLOR)} onChange={(e) => updateElementStyle(activeElement.id, 'color', e.target.value)} className={styles.colorPicker} />
                      </div>
                  </div>

                  <label className={styles.inputLabel}>Text Background</label>
                  <input type="color" value={getColorInputValue(activeElement.style.background, DEFAULT_CARD_BACKGROUND)} onChange={(e) => updateElementStyle(activeElement.id, 'background', e.target.value)} className={styles.colorPicker} />
                </>
              )}

              {activeElement.type === 'link' && (
                <>
                  <label className={styles.inputLabel}>Link Label</label>
                  <input type="text" value={activeElement.label || ''} onChange={(e) => updateElement(activeElement.id, { label: e.target.value })} className={styles.inputField} />
                  <label className={styles.inputLabel}>URL</label>
                  <input type="url" value={activeElement.href || ''} onChange={(e) => updateElement(activeElement.id, { href: e.target.value })} className={styles.inputField} />
                </>
              )}

              {activeElement.type === 'attachment' && (
                <>
                  <label className={styles.inputLabel}>Attachment Label</label>
                  <input type="text" value={activeElement.label || activeElement.fileName || ''} onChange={(e) => updateElement(activeElement.id, { label: e.target.value })} className={styles.inputField} />
                </>
              )}

              {activeElement.type === 'image' && (
                <>
                  <label className={styles.inputLabel}>Image Alt Text</label>
                  <input type="text" value={activeElement.label || ''} onChange={(e) => updateElement(activeElement.id, { label: e.target.value })} className={styles.inputField} />
                </>
              )}

              {activeElement.type === 'divider' && (
                  <>
                    <label className={styles.inputLabel}>Orientation</label>
                    <select
                      value={activeElement.orientation || 'horizontal'}
                      onChange={(e) => updateElement(activeElement.id, {
                        orientation: e.target.value,
                        width: e.target.value === 'vertical' ? 24 : DEFAULT_REPORT_WIDTH,
                        height: e.target.value === 'vertical' ? 360 : 24,
                      })}
                      className={styles.inputField}
                    >
                      <option value="horizontal">Horizontal</option>
                      <option value="vertical">Vertical</option>
                    </select>
                    <button
                      type="button"
                      className={styles.secondaryBtnFull}
                      onClick={() => {
                        const nextOrientation = (activeElement.orientation || 'horizontal') === 'horizontal' ? 'vertical' : 'horizontal';
                        updateElement(activeElement.id, {
                          orientation: nextOrientation,
                          width: nextOrientation === 'vertical' ? 24 : DEFAULT_REPORT_WIDTH,
                          height: nextOrientation === 'vertical' ? Math.max(activeElement.height, 240) : 24,
                        });
                      }}
                    >
                      Flip divider
                    </button>
                    <label className={styles.inputLabel}>Line Style</label>
                    <input type="text" value={activeElement.style.line || activeElement.style.borderBottom || activeElement.style.borderLeft || '2px solid #e2e8f0'} onChange={(e) => updateElementStyle(activeElement.id, 'line', e.target.value)} className={styles.inputField} placeholder="e.g. 2px dashed #999" />
                  </>
              )}

              {activeElement.type === 'chart' && (
                <>
                  <label className={styles.inputLabel}>Chart Name</label>
                  <input
                    type="text"
                    value={activeElement.label || ''}
                    onChange={(e) => updateElement(activeElement.id, { label: e.target.value })}
                    className={styles.inputField}
                    placeholder="e.g. Monthly corridor comparison"
                  />

                  {renderModuleTargetControls(activeElement)}

                  <label className={styles.inputLabel}>Plot Type</label>
                  <select value={activeElement.chartType || (isComparison ? 'line' : 'combo')} onChange={(e) => updateElement(activeElement.id, { chartType: e.target.value })} className={styles.inputField}>
                    {(isComparison ? COMPARISON_CHART_TYPES : AGGREGATE_CHART_TYPES).map((chartType) => (
                      <option key={chartType.value} value={chartType.value}>{chartType.label}</option>
                    ))}
                  </select>

                  {(activeElement.chartType || (isComparison ? 'line' : 'combo')) === 'custom' && (
                    <div className={styles.controlCard}>
                      <div className={styles.controlCardHeader}>
                        <h5 className={styles.controlCardTitle}>Custom Metrics</h5>
                      </div>
                      <div className={styles.checkboxGroup}>
                        {[
                          { key: 'volume', label: 'Traffic volume', defaultChecked: true },
                          { key: 'avgSpeed', label: 'Average speed', defaultChecked: true },
                          ...(!isComparison ? [
                            { key: 'v85Speed', label: '85th speed', defaultChecked: false },
                            { key: 'maxSpeed', label: 'Max speed', defaultChecked: false },
                            { key: 'approach', label: 'Approach traffic', defaultChecked: false },
                            { key: 'away', label: 'Away traffic', defaultChecked: false },
                          ] : []),
                        ].map((metric) => (
                          <label key={metric.key} className={styles.checkboxRow}>
                            <input
                              type="checkbox"
                              checked={activeElement.customMetrics?.[metric.key] ?? metric.defaultChecked}
                              onChange={(e) => updateElementObjectValue(activeElement.id, 'customMetrics', metric.key, e.target.checked)}
                            />
                            {metric.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className={styles.sidebarSection}>
                    <h4 className={styles.sidebarSectionTitle}>Visualization Style</h4>
                    {!isComparison ? (
                      <>
                        <div className={styles.twoColumnFields}>
                          <div>
                            <label className={styles.inputLabel}>Line / Bar</label>
                            <input type="color" value={getColorInputValue(activeElement.occupancyColor, '#7cb49c')} onChange={(e) => updateElement(activeElement.id, { occupancyColor: e.target.value })} className={styles.colorPicker} />
                          </div>
                          <div>
                            <label className={styles.inputLabel}>Traffic Bars</label>
                            <input type="color" value={getColorInputValue(activeElement.peopleColor, '#6b7280')} onChange={(e) => updateElement(activeElement.id, { peopleColor: e.target.value })} className={styles.colorPicker} />
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        {getElementComparisonSelectionList(activeElement).map((_, index) => (
                          <div key={`${activeElement.id}-series-color-${index}`} className={styles.twoColumnFields}>
                            <div>
                              <label className={styles.inputLabel}>Series {index + 1}</label>
                              <input
                                type="color"
                                value={getColorInputValue(activeElement.seriesColors?.[index], ['#2f716f', '#8b5cf6', '#0ea5e9', '#f59e0b'][index] || '#2f716f')}
                                onChange={(e) => updateElementArrayValue(activeElement.id, 'seriesColors', index, e.target.value)}
                                className={styles.colorPicker}
                              />
                            </div>
                            <div>
                              <label className={styles.inputLabel}>Traffic {index + 1}</label>
                              <input
                                type="color"
                                value={getColorInputValue(activeElement.peopleSeriesColors?.[index], ['#64748b', '#b8a2f3', '#94a3b8', '#d97706'][index] || '#64748b')}
                                onChange={(e) => updateElementArrayValue(activeElement.id, 'peopleSeriesColors', index, e.target.value)}
                                className={styles.colorPicker}
                              />
                            </div>
                          </div>
                        ))}
                      </>
                    )}

                    <div className={styles.controlCard}>
                      <div className={styles.controlCardHeader}>
                        <div>
                          <h5 className={styles.controlCardTitle}>Legend</h5>
                        </div>
                        <label className={`${styles.checkboxRow} ${styles.inlineToggle}`}>
                          <input
                            type="checkbox"
                            checked={activeElement.showLegend ?? (isComparison || (activeElement.chartType || 'combo') === 'combo')}
                            onChange={(e) => updateElement(activeElement.id, { showLegend: e.target.checked })}
                          />
                          Show
                        </label>
                      </div>

                      {(activeElement.showLegend ?? (isComparison || (activeElement.chartType || 'combo') === 'combo')) && (
                        <div className={styles.checkboxGroup}>
                          <label className={styles.checkboxRow}>
                            <input
                              type="checkbox"
                              checked={activeElement.legendItems?.occupancy ?? true}
                              onChange={(e) => updateElementObjectValue(activeElement.id, 'legendItems', 'occupancy', e.target.checked)}
                            />
                            Avg speed
                          </label>
                          <label className={styles.checkboxRow}>
                            <input
                              type="checkbox"
                              checked={activeElement.legendItems?.people ?? true}
                              onChange={(e) => updateElementObjectValue(activeElement.id, 'legendItems', 'people', e.target.checked)}
                            />
                            Traffic volume
                          </label>
                          {activeElement.thresholdEnabled && (
                            <label className={styles.checkboxRow}>
                              <input
                                type="checkbox"
                                checked={activeElement.legendItems?.threshold ?? true}
                                onChange={(e) => updateElementObjectValue(activeElement.id, 'legendItems', 'threshold', e.target.checked)}
                              />
                              Threshold entry
                            </label>
                          )}
                        </div>
                      )}
                    </div>

                    <div className={styles.controlCard}>
                      <div className={styles.controlCardHeader}>
                        <div>
                          <h5 className={styles.controlCardTitle}>Threshold Line</h5>
                        </div>
                        <label className={`${styles.checkboxRow} ${styles.inlineToggle}`}>
                          <input
                            type="checkbox"
                            checked={Boolean(activeElement.thresholdEnabled)}
                            onChange={(e) => updateElement(activeElement.id, { thresholdEnabled: e.target.checked })}
                          />
                          Show
                        </label>
                      </div>

                      {activeElement.thresholdEnabled && (
                        <div className={styles.controlCardBody}>
                          <label className={styles.inputLabel}>Value</label>
                          <input
                            type="number"
                            value={activeElement.thresholdValue || ''}
                            onChange={(e) => updateElement(activeElement.id, { thresholdValue: e.target.value })}
                            className={styles.inputField}
                            placeholder="e.g. 75"
                          />
                          <div className={styles.twoColumnFields}>
                            <div>
                              <label className={styles.inputLabel}>Label</label>
                              <input type="text" value={activeElement.thresholdLabel || 'Threshold'} onChange={(e) => updateElement(activeElement.id, { thresholdLabel: e.target.value })} className={styles.inputField} />
                            </div>
                            <div>
                              <label className={styles.inputLabel}>Color</label>
                              <input type="color" value={getColorInputValue(activeElement.thresholdColor, '#ef4444')} onChange={(e) => updateElement(activeElement.id, { thresholdColor: e.target.value })} className={styles.colorPicker} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {!isComparison && (
                    <>
                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={Boolean(activeElement.highlightPeak || activeElement.highlightMode === 'peak')}
                          onChange={(e) => updateElement(activeElement.id, { highlightPeak: e.target.checked, highlightMode: e.target.checked ? 'peak' : 'none' })}
                        />
                        Highlight peak value
                      </label>

                      {(activeElement.highlightPeak || activeElement.highlightMode === 'peak') && (
                        <>
                          <label className={styles.inputLabel}>Highlight Label</label>
                          <input type="text" value={activeElement.highlightLabel || 'Peak'} onChange={(e) => updateElement(activeElement.id, { highlightLabel: e.target.value })} className={styles.inputField} />
                          <label className={styles.inputLabel}>Highlight Color</label>
                          <input type="color" value={getColorInputValue(activeElement.highlightColor, '#f59e0b')} onChange={(e) => updateElement(activeElement.id, { highlightColor: e.target.value })} className={styles.colorPicker} />
                        </>
                      )}
                    </>
                  )}
                  <button type="button" className={styles.secondaryBtnFull} onClick={() => addNewElement('summary')}>
                    <Layers size={14} /> Add linked summary
                  </button>
                  <button type="button" className={styles.secondaryBtnFull} onClick={() => refreshElementSnapshot(activeElement.id)}>
                    <RefreshCw size={14} /> Refresh snapshot
                  </button>
                </>
              )}

              {activeElement.type === 'summary' && !isComparison && (
                <div className={styles.summaryControlSection}>
                  <label className={styles.inputLabel}>Summary Source</label>
                  <select
                    className={`${styles.inputField} ${styles.truncatedSelect}`}
                    value={activeElement.attachedChartId || ''}
                    onChange={(e) => updateElement(activeElement.id, { attachedChartId: e.target.value || undefined })}
                  >
                    <option value="">Custom data source</option>
                    {elements.filter((element) => element.type === 'chart').map((chartElement, index) => (
                      <option key={chartElement.id} value={chartElement.id}>
                        {getChartDisplayName(chartElement, index)}
                      </option>
                    ))}
                  </select>
                  {activeElement.attachedChartId ? (
                    null
                  ) : (
                    <>
                      {renderModuleTargetControls(activeElement)}
                    </>
                  )}

                  <label className={styles.inputLabel}>Cards to Show</label>
                  <div className={`${styles.checkboxGroup} ${styles.compactCheckboxGroup}`}>
                    {SUMMARY_METRIC_OPTIONS.map((metric) => {
                      const selectedMetrics = Array.isArray(activeElement.summaryMetrics) && activeElement.summaryMetrics.length > 0
                        ? activeElement.summaryMetrics
                        : DEFAULT_SUMMARY_METRICS;
                      return (
                        <label key={metric.value} className={`${styles.checkboxRow} ${styles.compactCheckboxRow}`}>
                          <input
                            type="checkbox"
                            checked={selectedMetrics.includes(metric.value)}
                            onChange={(e) => {
                              const nextMetrics = e.target.checked
                                ? [...selectedMetrics, metric.value]
                                : selectedMetrics.filter((value) => value !== metric.value);
                              updateElement(activeElement.id, { summaryMetrics: nextMetrics.length ? nextMetrics : [metric.value] });
                            }}
                          />
                          <span>{metric.label}</span>
                        </label>
                      );
                    })}
                  </div>
                  <button type="button" className={styles.secondaryBtnFull} onClick={() => refreshElementSnapshot(activeElement.id)}>
                    <RefreshCw size={14} /> Refresh snapshot
                  </button>
                </div>
              )}

              {activeElement.type === 'summary' && isComparison && (
                <div className={styles.summaryControlSection}>
                  <label className={styles.inputLabel}>Summary Source</label>
                  <select
                    className={`${styles.inputField} ${styles.truncatedSelect}`}
                    value={activeElement.attachedChartId || ''}
                    onChange={(e) => updateElement(activeElement.id, { attachedChartId: e.target.value || undefined })}
                  >
                    <option value="">Custom data source</option>
                    {elements.filter((element) => element.type === 'chart').map((chartElement, index) => (
                      <option key={chartElement.id} value={chartElement.id}>
                        {getChartDisplayName(chartElement, index)}
                      </option>
                    ))}
                  </select>
                  {activeElement.attachedChartId ? (
                    null
                  ) : (
                    <>
                      {renderModuleTargetControls(activeElement)}
                    </>
                  )}

                  <label className={styles.inputLabel}>Cards to Show</label>
                  <div className={`${styles.checkboxGroup} ${styles.compactCheckboxGroup}`}>
                    {COMPARISON_SUMMARY_MODES.map((mode) => {
                      const selectedMetrics = Array.isArray(activeElement.summaryMetrics) && activeElement.summaryMetrics.length > 0
                        ? activeElement.summaryMetrics
                        : DEFAULT_COMPARISON_SUMMARY_METRICS;
                      return (
                        <label key={mode.value} className={`${styles.checkboxRow} ${styles.compactCheckboxRow}`}>
                          <input
                            type="checkbox"
                            checked={selectedMetrics.includes(mode.value)}
                            onChange={(e) => {
                              const nextMetrics = e.target.checked
                                ? [...selectedMetrics, mode.value]
                                : selectedMetrics.filter((value) => value !== mode.value);
                              updateElement(activeElement.id, {
                                summaryMetrics: nextMetrics.length ? nextMetrics : [mode.value],
                                summaryMetric: nextMetrics[0] || mode.value,
                              });
                            }}
                          />
                          <span>{mode.label}</span>
                        </label>
                      );
                    })}
                  </div>
                  <button type="button" className={styles.secondaryBtnFull} onClick={() => refreshElementSnapshot(activeElement.id)}>
                    <RefreshCw size={14} /> Refresh snapshot
                  </button>
                </div>
              )}

              {!['text', 'divider', 'chart', 'summary'].includes(activeElement.type) && (
                <>
                    <label className={styles.inputLabel}>Card Background</label>
                    <input type="color" value={getColorInputValue(activeElement.style.background, DEFAULT_CARD_BACKGROUND)} onChange={(e) => updateElementStyle(activeElement.id, 'background', e.target.value)} className={styles.colorPicker} />
                    <button type="button" className={styles.secondaryBtnFull} onClick={() => updateElementStyle(activeElement.id, 'background', DEFAULT_CARD_BACKGROUND)}>Reset to white</button>
                </>
              )}

              <hr style={{ borderColor: 'var(--border-color)', margin: '10px 0 20px 0' }} />
              <button onClick={deleteSelected} className={styles.dangerBtn}>Delete Widget</button>
            </div>
          )}
        </div>

      </div>
      <ConfirmDialog dialog={confirmDialog} onClose={resolveConfirmation} />
      <ExportPreviewModal
        isOpen={Boolean(exportPreviewImage)}
        pageCount={exportPreviewPages.length || totalVisiblePageCount}
        renderPage={renderStandardPreviewPage}
        onClose={() => {
          setExportPreviewImage('');
          setExportPreviewPages([]);
          exportPageCountRef.current = DEFAULT_PAGE_COUNT;
        }}
        onDownload={handleDownloadPDF}
        isDownloading={isDownloading}
      />
    </main>
  );
};

const InsightsStudio = () => {
  const [reports, setReports] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savedReportsError, setSavedReportsError] = useState('');
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [templatePickerMode, setTemplatePickerMode] = useState(null);
  const confirmResolveRef = useRef(null);
  

  const soloBars = [
    { label: 'Mon', value: 24 }, { label: 'Tue', value: 58 }, { label: 'Wed', value: 86 }, { label: 'Thur', value: 72 }, { label: 'Fri', value: 44 }
  ];
  const comparisonBars = [
    { label: 'Area A', value: 71 }, { label: 'Area B', value: 52 }, { label: 'Area C', value: 31 }
  ];

  const requestConfirmation = (dialog) => new Promise((resolve) => {
    confirmResolveRef.current = resolve;
    setConfirmDialog(dialog);
  });

  const resolveConfirmation = (result) => {
    confirmResolveRef.current?.(result);
    confirmResolveRef.current = null;
    setConfirmDialog(null);
  };

  const handleDeleteReport = async (reportId) => {
    const confirmDelete = await requestConfirmation({
      title: 'Delete saved report?',
      message: 'This report will be removed from Insights Studio. This cannot be undone.',
      actions: [
        { value: false, label: 'Cancel', variant: 'secondary' },
        { value: true, label: 'Delete report', variant: 'danger' },
      ],
    });
    if (!confirmDelete) return;

    try {
      const { error } = await supabase
        .from('saved_reports')
        .delete()
        .eq('id', reportId);

      if (error) throw error;
      setReports(reports.filter(report => report.id !== reportId));
    } catch (err) {
      console.error('Failed to delete report:', err.message);
      alert('Failed to delete report. Please try again.');
    }
  };

  useEffect(() => {
    const fetchSavedReports = async () => {
      try {
        if (!supabase) {
          setSavedReportsError('Supabase is not configured for this environment.');
          setReports([]);
          return;
        }

        const { data, error } = await supabase
          .from('saved_reports') 
          .select('*')
          .order('created_at', { ascending: false });

        if (error) {
          console.warn('Supabase cache warning:', error.message);
          setSavedReportsError(error.message);
          setReports([]); 
          return;
        }
        
        setSavedReportsError('');
        setReports(sortReportsByLastSaved(data || []));
      } catch (err) {
        console.error('Failed to retrieve archived reports:', err.message);
        setSavedReportsError(err.message);
        setReports([]); 
      } finally {
        setIsLoading(false);
      }
    };

    fetchSavedReports();
  }, []);

  return (
    <main className={styles.page}>
      <section className={styles.content}>
        
        {/* HERO SECTION */}
        <header className={styles.hero}>
          <h1>Insights Studio</h1>
          <p>Turn activity data into clear, presentation-ready insights.</p>
          <p>Choose an insight type to begin.</p>
        </header>

        {/* INSIGHT CREATION CARDS */}
        <section className={styles.cardGrid}>
          <article className={styles.insightCard}>
            <div className={styles.cardCopy}>
              <h2>Solo Insight</h2>
              <p>Analyze one area over time.</p>
              <p>Track activity by hour, day, or week.</p>
            </div>
            <div className={styles.chartBlock} aria-hidden="true">
              <h3>Weekly activity trend</h3>
              <div className={styles.soloChart}>
                {soloBars.map((bar) => (
                  <div className={styles.soloBarGroup} key={bar.label}>
                    <span className={styles.soloBarSlot}>
                      <span className={styles.soloBar} style={{ height: `${bar.value}%` }} />
                    </span>
                    <span className={styles.chartLabel}>{bar.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <button type="button" className={styles.cardButton} onClick={() => setTemplatePickerMode('solo')}>
              Create Solo Insight
            </button>
          </article>

          <article className={styles.insightCard}>
            <div className={styles.cardCopy}>
              <h2>Comparison Insight</h2>
              <p>Compare multiple areas side by side.</p>
              <p>Spot differences by hour, day, or week.</p>
            </div>
            <div className={styles.chartBlock} aria-hidden="true">
              <h3>Activity comparison</h3>
              <div className={styles.comparisonChart}>
                {comparisonBars.map((bar) => (
                  <div className={styles.comparisonRow} key={bar.label}>
                    <span className={styles.comparisonLabel}>{bar.label}</span>
                    <span className={styles.comparisonTrack}>
                      <span className={styles.comparisonFill} style={{ width: `${bar.value}%` }} />
                    </span>
                    <span className={styles.comparisonValue}>{bar.value}%</span>
                  </div>
                ))}
              </div>
            </div>
            <button type="button" className={styles.cardButton} onClick={() => setTemplatePickerMode('comparison')}>
              Create Comparison Insight
            </button>
          </article>
        </section>

        {templatePickerMode && (
          <div className={styles.modalOverlay} role="presentation" onMouseDown={() => setTemplatePickerMode(null)}>
            <div className={styles.templateChoiceDialog} role="dialog" aria-modal="true" aria-labelledby="template-choice-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className={styles.templateChoiceHeader}>
                <div>
                  <h2 id="template-choice-title">Choose a starting point</h2>
                  <p>{templatePickerMode === 'solo' ? 'Solo Insight' : 'Comparison Insight'}</p>
                </div>
                <button type="button" className={styles.secondaryBtn} onClick={() => setTemplatePickerMode(null)}>Close</button>
              </div>

              <div className={styles.templateChoiceGrid}>
                {getTemplateOptions(templatePickerMode).map((option) => (
                  <Link key={option.id} className={styles.templateChoiceCard} to={`/insights-studio/${templatePickerMode}?template=${option.id}`}>
                    <div className={`${styles.templatePreviewPage} ${styles[`templatePreview${option.previewClass.charAt(0).toUpperCase()}${option.previewClass.slice(1)}`] || ''}`}>
                      {option.previewClass === 'blank' ? (
                        <span />
                      ) : (
                        <>
                          <span className={styles.templatePreviewHeader} />
                          <span className={styles.templatePreviewSummary} />
                          <span className={styles.templatePreviewChart} />
                          <span className={styles.templatePreviewNote} />
                        </>
                      )}
                    </div>
                    <h3>{option.name}</h3>
                    <p>{option.description}</p>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* --- RECENT REPORTS ARCHIVE VAULT --- */}
        <section className={styles.templates}>
          <h2>Previously Generated Reports</h2>
          
          {isLoading ? (
            <div style={{ minHeight: '96px' }} aria-hidden="true" />
          ) : savedReportsError ? (
            <div style={{ marginTop: '24px', padding: '32px', background: '#fff7ed', borderRadius: '12px', border: '1px solid #fed7aa', color: '#9a3412', textAlign: 'center' }}>
              <FileText size={32} style={{ color: '#fb923c', marginBottom: '12px' }} />
              <p style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Saved reports could not connect.</p>
              <p style={{ margin: '6px 0 0', fontSize: '13px', opacity: 0.9 }}>{savedReportsError}</p>
            </div>
          ) : reports.length === 0 ? (
            <div style={{ marginTop: '24px', padding: '48px', background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', color: '#64748b', textAlign: 'center' }}>
              <FileText size={32} style={{ color: '#bcb4b7', marginBottom: '12px' }} />
              <p style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>No saved documents found.</p>
              <p style={{ margin: '4px 0 0', fontSize: '13px', opacity: 0.8 }}>Reports generated in the Custom Layout Builder will appear here.</p>
            </div>
          ) : (
            <div className={styles.savedReportsTable}>
              <div className={`${styles.savedReportsGrid} ${styles.savedReportsHeader}`}>
                <div>Document Name</div>
                <div>Last Saved</div>
                <div>Generated Date</div>
                <div>Action</div>
              </div>
              
              {reports.map((report) => (
                <div key={report.id} className={`${styles.savedReportsGrid} ${styles.savedReportsRow}`}>
                  <div className={styles.savedReportNameCell}>
                    <div className={styles.savedReportIcon}>
                      <FileText size={18} />
                    </div>
                    <div className={styles.savedReportTitleBlock}>
                      <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '15px' }}>{report.title || 'Untitled Snapshot'}</div>
                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>By {report.author || 'System Agent'}</div>
                    </div>
                  </div>
                  
                  <div className={styles.savedReportPeriodCell}>{formatReportDate(getReportLastSavedDate(report))}</div>
                  
                  <div className={styles.savedReportDateCell}>
                    <Calendar size={14} />
                    {formatReportDate(report.created_at || report.date)}
                  </div>
                  
                  <div className={styles.savedReportActions}>
                    
                    <Link to={`/insights-studio/${getReportMode(report)}?id=${report.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '999px', background: '#2f716f', color: '#ffffff', fontSize: '13px', fontWeight: 700, textDecoration: 'none', transition: 'background-color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#275f5e'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#2f716f'}>
                      Open Workspace <ArrowRight size={14} />
                    </Link>

                    <button 
                      onClick={() => handleDeleteReport(report.id)}
                      style={{ 
                        display: 'flex', alignItems: 'center', justifyContent: 'center', 
                        width: '34px', height: '34px', borderRadius: '50%', 
                        background: '#fef2f2', border: '1px solid #fee2e2', 
                        color: '#ef4444', cursor: 'pointer', transition: 'all 0.2s' 
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#fee2e2'; e.currentTarget.style.transform = 'scale(1.05)'; }} 
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fef2f2'; e.currentTarget.style.transform = 'scale(1)'; }}
                      title="Delete Report"
                    >
                      <Trash2 size={16} />
                    </button>

                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </section>
      <ConfirmDialog dialog={confirmDialog} onClose={resolveConfirmation} />
    </main>
  );
};

export default InsightsStudio;
