import { CHART_COLORS, CHART_SERIES_COLORS, CHART_PEOPLE_COLORS } from '../visualizations/ChartTheme.js';
import ReportWorkspace from './ReportWorkspace.jsx';
import { REPORT_METRICS, getDecisionQuestion, loadReportVersion, runReportCommand } from './ReportEnterprise.js';
import {
  applyTextDraftsToLayout, createSingleFlightTask, decodeReportLayout,
  getCheckpointDocMeta, getComparableReportState, hasSelectionValue,
  inferReportModeFromLayout, normalizeReportPageCount, normalizeStudioRole,
  requireReportReady, saveReportRecord, removeReportDataNotes,
} from './ReportSafety.js';
import { sanitizeReportHtml } from './ReportHtml.js';
import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useNavigate, Link, useSearchParams, useBlocker } from 'react-router-dom';
import {
  Download,
  Type,
  BarChart2,
  Layers,
  MinusSquare,
  ImagePlus,
  Link2,
  FileText,
  Plus,
  User,
  Users,
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
  Maximize2,
  Share2,
  X,
  ArrowLeft,
  PanelRightOpen,
  MessageSquare,
  Save,
  Check,
  LoaderCircle,
  Undo2,
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
import { fetchInstitutionTeamMembers } from '../team/TeamData';


const DEFAULT_CARD_BACKGROUND = '#ffffff';
const DEFAULT_TEXT_COLOR = '#0f172a';
const DEFAULT_PAGE_COUNT = 1;
const GRID_SIZE = 24;
const PAGE_HEIGHT = 1200;
const PAGE_WIDTH = 820;
const DEFAULT_REPORT_WIDTH = 720;
const DEFAULT_SUMMARY_HEIGHT = 240;
const DEFAULT_CHART_HEIGHT = 480;
const SINGLE_SUMMARY_CARD_WIDTH = 216;
const SUMMARY_CARD_ROW_HEIGHT = 108;
const SUMMARY_CARD_GAP = 12;
const SUMMARY_CARD_MIN_HEIGHT = 132;
const SUMMARY_CARD_MAX_COLUMNS = 4;
const SNAP_THRESHOLD = 12;
const STUDIO_PRODUCT = 'transportation';
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
  coverAccentColor: '#34524D',
  coverBackground: '#fbfcfb',
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
  sharedAccess: {},
};
const FONT_SIZE_OPTIONS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];
const FONT_FAMILY_OPTIONS = [
  { value: 'Inter, system-ui, sans-serif', label: 'Default' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Times New Roman", Times, serif', label: 'Times New Roman' },
  { value: '"Courier New", Courier, monospace', label: 'Courier New' },
];

const DEFAULT_SUMMARY_METRICS = ['total', 'current', 'peak', 'busiestDay'];
const DAILY_SUMMARY_METRICS = ['total', 'current', 'peak', 'busiestTime'];
const SUMMARY_METRIC_OPTIONS = [
  { value: 'total', label: 'Total Traffic Volume' },
  { value: 'current', label: 'Latest Period' },
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

const getSummaryMetricsForTimeframe = (metrics, timeframe) => {
  const fallbackMetrics = timeframe === 'daily' ? DAILY_SUMMARY_METRICS : DEFAULT_SUMMARY_METRICS;
  const sourceMetrics = Array.isArray(metrics) && metrics.length > 0 ? metrics : fallbackMetrics;
  const nextMetrics = sourceMetrics.filter((metric) => (
    timeframe === 'daily'
      ? metric !== 'busiestDay'
      : metric !== 'busiestTime'
  ));
  return nextMetrics.length > 0 ? nextMetrics : fallbackMetrics;
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
      name: 'Weekly Corridor Report',
      description: 'Find busy periods and decide where corridor operations should focus.',
      previewClass: 'default',
    },
    {
      id: 'operations',
      name: 'Traffic Volume Review',
      description: 'Choose hours for staffing, access, or traffic-management changes.',
      previewClass: 'operations',
    },
    {
      id: 'trend-review',
      name: 'Speed Profile Review',
      description: 'Review recorded speed patterns and identify periods that need attention.',
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
      name: 'Before / After Comparison',
      description: 'Cover, header, and one comparison visualization for two periods or corridors.',
      previewClass: 'default',
    },
    {
      id: 'executive-compare',
      name: 'Peak Traffic Review',
      description: 'Compare peak activity and prioritize corridors for operational attention.',
      previewClass: 'executive',
    },
    {
      id: 'corridor-benchmark',
      name: 'Corridor Benchmark',
      description: 'Compare similar corridors, record a finding, and assign a follow-up.',
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
    coverAccentColor: '#34524D',
    coverBackground: '#fbfcfb',
  },
  operations: {
    coverEyebrow: 'Operations Snapshot',
    coverSubtitle: 'Daily activity, sensor notes, and corridor-use indicators.',
    coverAccentColor: '#34524D',
    coverBackground: '#eef3f1',
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

const getTemplateReportSettings = (templateId, mode = 'solo') => ({
  ...DEFAULT_REPORT_SETTINGS,
  ...(TEMPLATE_COVER_SETTINGS[templateId] || {}),
  timeframe: templateId === 'operations' ? 'daily' : DEFAULT_REPORT_SETTINGS.timeframe,
  decisionQuestion: getDecisionQuestion(STUDIO_PRODUCT, templateId, mode),
  metricDefinitions: REPORT_METRICS[STUDIO_PRODUCT],
  metricDefinitionVersion: 1,
});

const TEMPLATE_DOC_META = {
  operations: {
    title: 'Operations Snapshot',
    period: 'Daily Review Window',
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

const getCoverExportBackground = (settings) => {
  const accent = getColorInputValue(settings.coverAccentColor, '#34524D');
  const bg = getColorInputValue(settings.coverBackground, '#fbfcfb');
  const layout = settings.coverLayout || 'classic';

  if (layout === 'minimal') return bg;
  if (layout === 'banded') return `linear-gradient(180deg, ${accent} 0 255px, transparent 255px), linear-gradient(180deg, #ffffff 0%, ${bg} 100%)`;
  if (layout === 'editorial') return `linear-gradient(90deg, transparent 0 620px, rgba(52, 82, 77, 0.18) 620px 100%), linear-gradient(180deg, #ffffff 0%, ${bg} 100%)`;
  if (layout === 'executive') return `linear-gradient(135deg, rgba(71, 85, 105, 0.14) 0 34%, transparent 34%), linear-gradient(180deg, ${bg} 0%, #ffffff 100%)`;
  if (layout === 'benchmark') return `linear-gradient(90deg, rgba(139, 92, 246, 0.16) 0 50%, #ffffff 50% 100%), linear-gradient(180deg, ${bg} 0%, #ffffff 100%)`;
  return `linear-gradient(90deg, ${accent} 0 14px, transparent 14px), linear-gradient(180deg, #ffffff 0%, ${bg} 100%)`;
};

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

const getTextHtml = (element) => sanitizeReportHtml(element.html ?? element.content ?? '');

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
  if (typeof document === 'undefined') return null;
  const actions = dialog.actions || [
    { value: false, label: dialog.cancelLabel || 'Cancel', variant: 'secondary' },
    { value: true, label: dialog.confirmLabel || 'Save', variant: 'primary' },
  ];
  const dismissValue = actions[0]?.value ?? false;

  return createPortal((
    <div className={`${styles.modalOverlay} ${styles.confirmOverlay}`} role="presentation" onMouseDown={() => onClose(dismissValue)}>
      <div className={styles.confirmDialog} role="dialog" aria-modal="true" aria-labelledby="insights-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
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
  ), document.body);
};

const SavingReportOverlay = ({ isOpen }) => {
  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal((
    <div className={`${styles.modalOverlay} ${styles.savingReportOverlay}`} role="presentation">
      <div className={styles.savingReportCard} role="status" aria-live="polite">
        <span className={styles.builderAccessSpinner} aria-hidden="true" />
        <h2>Saving report...</h2>
        <p>Please wait while Insights Studio saves your changes.</p>
      </div>
    </div>
  ), document.body);
};

const ExportPreviewModal = ({ isOpen, pageCount = 1, renderPage, onClose, onDownload, isDownloading }) => {
  const [activePageIndex, setActivePageIndex] = useState(0);

  if (!isOpen) return null;
  const previewPages = Array.from({ length: Math.max(1, pageCount) }, (_, index) => ({ label: `Page ${index + 1}` }));
  const safeActivePageIndex = Math.min(activePageIndex, previewPages.length - 1);

  if (typeof document === 'undefined') return null;

  return createPortal((
    <div className={styles.modalOverlay} role="presentation" onMouseDown={onClose}>
      <div className={styles.exportPreviewDialog} role="dialog" aria-modal="true" aria-labelledby="export-preview-title" onMouseDown={(event) => event.stopPropagation()}>
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

const ShareReportModal = ({
  isOpen,
  email,
  error,
  notice,
  isSharing,
  sharedWith = [],
  sharedAccess = {},
  suggestions = [],
  isLoadingSuggestions = false,
  selectedRecipients = [],
  onEmailChange,
  onSuggestionSelect,
  onRecipientRemove,
  onClose,
  onShare,
  onAccessChange,
  onRemoveAccess,
}) => {
  if (!isOpen || typeof document === 'undefined') return null;

  const normalizedAccess = normalizeSharedAccess(sharedAccess, sharedWith);

  return createPortal((
    <div className={styles.modalOverlay} role="presentation" onMouseDown={onClose}>
      <div className={styles.shareDialog} role="dialog" aria-modal="true" aria-labelledby="share-report-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className={styles.shareDialogHeader}>
          <div>
            <h2 id="share-report-title">Share report</h2>
            <p>Invite a platform user from your institute.</p>
          </div>
        </div>

        <div className={styles.sharedUsersList}>
          <div className={styles.sharedUsersHeader}>
            <Users size={16} />
            <span>People with access</span>
          </div>
          {sharedWith.length || selectedRecipients.length ? (
            <div className={styles.sharedUsers}>
              {sharedWith.map((sharedEmail) => (
                <div className={styles.sharedUserRow} key={sharedEmail}>
                  <span className={styles.sharedUserAvatar}>
                    <User size={14} />
                  </span>
                  <span className={styles.sharedUserEmail}>{sharedEmail}</span>
                  <select
                    className={styles.sharedUserRoleSelect}
                    value={normalizedAccess[String(sharedEmail).toLowerCase()] || 'editor'}
                    onChange={(event) => onAccessChange(sharedEmail, event.target.value)}
                    disabled={isSharing}
                    aria-label={`Access for ${sharedEmail}`}
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    type="button"
                    className={styles.sharedUserRemoveBtn}
                    onClick={() => onRemoveAccess(sharedEmail)}
                    disabled={isSharing}
                    aria-label={`Remove ${sharedEmail}`}
                    title="Remove access"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {selectedRecipients.map((recipient) => (
                <div className={`${styles.sharedUserRow} ${styles.sharedUserPendingRow}`} key={`pending-${recipient.email}`}>
                  <span className={styles.sharedUserAvatar}>
                    <User size={14} />
                  </span>
                  <span className={styles.sharedUserEmail}>
                    {recipient.fullName || recipient.email}
                    {recipient.fullName ? <small>{recipient.email}</small> : null}
                  </span>
                  <span className={styles.sharedUserPendingBadge}>Pending</span>
                  <button
                    type="button"
                    className={styles.sharedUserRemoveBtn}
                    onClick={() => onRecipientRemove(recipient.email)}
                    disabled={isSharing}
                    aria-label={`Remove ${recipient.email}`}
                    title="Remove pending access"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.sharedUsersEmpty}>Only you have access right now.</p>
          )}
        </div>

        <label className={styles.inputLabel} htmlFor="share-report-email">Add people</label>
        <div className={styles.shareInviteControl}>
          <div className={styles.shareInviteRow}>
            <div className={styles.shareRecipientInputWrap}>
              {selectedRecipients.map((recipient) => (
                <span className={styles.shareRecipientChip} key={recipient.email}>
                  <span>{recipient.fullName || recipient.email}</span>
                  <button
                    type="button"
                    onClick={() => onRecipientRemove(recipient.email)}
                    disabled={isSharing}
                    aria-label={`Remove ${recipient.email}`}
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
              <input
                id="share-report-email"
                className={styles.shareEmailInput}
                type="text"
                value={email}
                placeholder={selectedRecipients.length ? 'Add another person' : 'Name or email'}
                onChange={(event) => onEmailChange(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') onShare(false);
                }}
                autoComplete="off"
                aria-autocomplete="list"
                aria-controls="share-email-suggestions"
                autoFocus
              />
            </div>
            <button
              type="button"
              className={styles.shareAddBtn}
              onClick={() => onShare(true)}
              disabled={isSharing || (!email.trim() && selectedRecipients.length === 0)}
              aria-label="Add people"
              title="Add people"
            >
              <Plus size={18} />
            </button>
          </div>
          <div className={styles.shareSuggestions} id="share-email-suggestions" role="listbox">
            {isLoadingSuggestions ? (
              <p className={styles.shareSuggestionState}>Loading people...</p>
            ) : suggestions.length ? (
              suggestions.map((suggestion) => (
                <button
                  type="button"
                  className={styles.shareSuggestionOption}
                  key={suggestion.email}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSuggestionSelect(suggestion);
                  }}
                  role="option"
                >
                  <span className={styles.sharedUserAvatar}>
                    <User size={14} />
                  </span>
                  <span>
                    <strong>{suggestion.fullName || suggestion.email}</strong>
                    {suggestion.fullName ? <em>{suggestion.email}</em> : null}
                  </span>
                </button>
              ))
            ) : (
              <p className={styles.shareSuggestionState}>No matching platform users.</p>
            )}
          </div>
        </div>

        {error && <p className={styles.shareError}>{error}</p>}
        {!error && notice && <p className={styles.shareNotice}>{notice}</p>}
        <p className={styles.fieldHint}>Select people from the list, or enter emails separated by commas.</p>

        <div className={styles.confirmActions}>
          <button type="button" className={styles.secondaryBtn} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.primaryBtn} onClick={() => onShare(false)} disabled={isSharing || (!email.trim() && selectedRecipients.length === 0)}>
            {isSharing ? 'Checking...' : 'Share'}
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

const getTimeframeDisplayLabel = (timeframe) => (
  timeframe === 'daily' ? '24hr'
    : timeframe === 'weekly' ? 'Weekly'
    : timeframe === 'monthly' ? 'Monthly'
    : 'Custom'
);

const TimeframeOverrideControls = ({ element, reportTimeframe, onToggle, onTimeframeChange, onFieldChange, onReset }) => (
  <div className={styles.sidebarSection}>
    <h4 className={styles.sidebarSectionTitle}>Timeframe</h4>
    <label className={styles.checkboxRow}>
      <input type="checkbox" checked={element.useReportTimeframe ?? true} onChange={(e) => onToggle(e.target.checked)} />
      Use report timeframe ({getTimeframeDisplayLabel(reportTimeframe)})
    </label>

    {element.useReportTimeframe === false && (
      <>
        <label className={styles.inputLabel}>This Widget's Timeframe</label>
        <select className={styles.inputField} value={element.timeType || 'weekly'} onChange={(e) => onTimeframeChange(e.target.value)}>
          <option value="daily">24hr</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="custom">Custom</option>
        </select>

        {element.timeType === 'custom' && (
          <>
            <button type="button" onClick={onReset} className={styles.timeframeResetBtn}>
              <RefreshCw size={14} /> Reset custom range
            </button>
            <div className={styles.twoColumnFields}>
              <div>
                <label className={styles.inputLabel}>Start Date</label>
                <input type="date" value={element.startDate || ''} onChange={(e) => onFieldChange('startDate', e.target.value)} className={styles.inputField} />
              </div>
              <div>
                <label className={styles.inputLabel}>End Date</label>
                <input type="date" value={element.endDate || ''} onChange={(e) => onFieldChange('endDate', e.target.value)} className={styles.inputField} />
              </div>
            </div>
            <div className={styles.twoColumnFields}>
              <div>
                <label className={styles.inputLabel}>Start Time</label>
                <input type="time" value={element.startTime || ''} onChange={(e) => onFieldChange('startTime', e.target.value)} className={styles.inputField} />
              </div>
              <div>
                <label className={styles.inputLabel}>End Time</label>
                <input type="time" value={element.endTime || ''} onChange={(e) => onFieldChange('endTime', e.target.value)} className={styles.inputField} />
              </div>
            </div>
          </>
        )}

        <label className={styles.inputLabel}>Days</label>
        <select className={styles.inputField} value={element.dayPreset || 'all'} onChange={(e) => onFieldChange('dayPreset', e.target.value)}>
          <option value="all">All days</option>
          <option value="weekdays">Weekdays only</option>
          <option value="weekends">Weekends only</option>
        </select>
      </>
    )}
  </div>
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
}) => {
  const cleaned = removeReportDataNotes(elements, pageCount, PAGE_HEIGHT);
  return {
    version: 2,
    mode,
    elements: cleaned.elements.map((element) => element.type === 'text' ? { ...element, html: getTextHtml(element) } : element),
    pageCount: cleaned.pageCount,
    selections,
    comparisonSelections,
    reportSettings,
  };
};





const parseSavedLayoutData = (layoutData) => {
  layoutData = decodeReportLayout(layoutData);
  if (!layoutData) return null;
  if (Array.isArray(layoutData)) {
    const cleaned = removeReportDataNotes(normalizeReportElements(layoutData), 1, PAGE_HEIGHT);
    const elements = cleaned.elements;

    return {
      elements,
      pageCount: normalizeReportPageCount(cleaned.pageCount, getRequiredPageCount(elements)),
      selections: EMPTY_TARGET_SELECTION,
      comparisonSelections: EMPTY_TARGET_SELECTION,
      reportSettings: DEFAULT_REPORT_SETTINGS,
      mode: undefined,
    };
  }

  if (layoutData && typeof layoutData === 'object') {
    const normalized = normalizeReportElements(layoutData.elements);
    const cleaned = removeReportDataNotes(normalized, normalizeReportPageCount(layoutData.pageCount, getRequiredPageCount(normalized)), PAGE_HEIGHT);
    const savedElements = cleaned.elements;
    return {
      elements: savedElements,
      pageCount: normalizeReportPageCount(cleaned.pageCount, getRequiredPageCount(savedElements)),
      selections: { ...EMPTY_TARGET_SELECTION, ...(layoutData.selections || {}) },
      comparisonSelections: { ...EMPTY_TARGET_SELECTION, ...(layoutData.comparisonSelections || {}) },
      reportSettings: { ...DEFAULT_REPORT_SETTINGS, ...(layoutData.reportSettings || {}) },
      mode: layoutData.mode,
    };
  }

  return null;
};





const getReportMode = (report) => inferReportModeFromLayout(parseSavedLayoutData(report?.layout_data));

const getReportSettings = (report) => parseSavedLayoutData(report?.layout_data)?.reportSettings || {};

const getReportSharedEmails = (report) => {
  if (Array.isArray(report?.shared_with_emails)) return report.shared_with_emails.filter(Boolean);
  const sharedWith = getReportSettings(report).sharedWith;
  return Array.isArray(sharedWith) ? sharedWith.filter(Boolean) : [];
};

const normalizeSharedAccess = (access = {}, sharedEmails = []) => {
  const entries = access && typeof access === 'object' && !Array.isArray(access) ? access : {};
  return Object.fromEntries(sharedEmails.map((email) => {
    const normalizedEmail = String(email).trim().toLowerCase();
    const role = String(entries[normalizedEmail] || entries[email] || 'editor').toLowerCase();
    return [normalizedEmail, role === 'viewer' ? 'viewer' : 'editor'];
  }).filter(([email]) => email));
};

const parseShareEmails = (value = '') => Array.from(new Set(
  String(value)
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
));

const getActiveShareEmailToken = (value = '') => {
  const parts = String(value || '').split(',');
  return String(parts[parts.length - 1] || '').trim().toLowerCase();
};

const removeActiveShareEmailToken = (value = '') => (
  String(value || '')
    .split(',')
    .slice(0, -1)
    .map((item) => item.trim())
    .filter(Boolean)
    .join(', ')
);

const getShareSuggestionMatchRank = (profile, token) => {
  if (!token) return 4;
  const email = String(profile.email || '').trim().toLowerCase();
  const firstName = String(profile.firstName || '').trim().toLowerCase();
  const lastName = String(profile.lastName || '').trim().toLowerCase();
  const fullName = String(profile.fullName || '').trim().toLowerCase();
  const nameParts = fullName.split(/\s+/).filter(Boolean);

  if (email.startsWith(token)) return 0;
  if (firstName.startsWith(token) || lastName.startsWith(token) || fullName.startsWith(token)) return 1;
  if (nameParts.some((part) => part.startsWith(token))) return 2;
  if (email.includes(token) || fullName.includes(token)) return 3;
  return null;
};

const getReportSharedAccess = (report) => {
  const sharedEmails = getReportSharedEmails(report);
  return normalizeSharedAccess(report?.shared_access || getReportSettings(report).sharedAccess, sharedEmails);
};

const getReportLastSavedDate = (report) => (
  getReportSettings(report).lastSavedAt || report.created_at || report.date || null
);

const getReportLastSavedBy = (report) => getReportSettings(report).lastSavedBy || '';

const formatReportDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
};

const formatReportDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

// Lays out one single-metric card per previously-bundled metric, in place of
// where a multi-metric banner used to sit — wraps to another row if the cards
// (each fixed at SINGLE_SUMMARY_CARD_WIDTH) don't fit side by side within the
// banner's original width. Returns the block's total height too, since every
// template below positions its dividers/charts/text relative to wherever the
// summary block ends — replacing a banner with a taller or shorter card block
// means shifting all of that by the same difference.
const createSummaryCardRow = (metrics, { idPrefix, x, y, attachedChartId, isComparison = false, maxWidth = DEFAULT_REPORT_WIDTH }) => {
  const columns = Math.max(1, Math.floor((maxWidth + SUMMARY_CARD_GAP) / (SINGLE_SUMMARY_CARD_WIDTH + SUMMARY_CARD_GAP)));
  const cardHeight = getAutoSummaryHeight({ summaryMetrics: [metrics[0]] }, isComparison, SINGLE_SUMMARY_CARD_WIDTH);
  const rows = Math.ceil(metrics.length / columns);
  const elements = metrics.map((metric, index) => ({
    id: `${idPrefix}-${index + 1}`,
    type: 'summary',
    x: x + (index % columns) * (SINGLE_SUMMARY_CARD_WIDTH + SUMMARY_CARD_GAP),
    y: y + Math.floor(index / columns) * (cardHeight + SUMMARY_CARD_GAP),
    width: SINGLE_SUMMARY_CARD_WIDTH,
    height: cardHeight,
    useReportTimeframe: true,
    summaryMetrics: [metric],
    summaryMetric: isComparison ? metric : undefined,
    isIndividualMetricCard: true,
    attachedChartId,
    style: { background: 'transparent', borderRadius: '12px' },
  }));
  return { elements, height: rows * cardHeight + Math.max(0, rows - 1) * SUMMARY_CARD_GAP };
};

const createDefaultTemplateElements = (isComparison) => {
  if (isComparison) {
    return [
      createDividerElement('divider-1', 48, 168),
      { id: 'chart-1', type: 'chart', x: 48, y: 192, width: DEFAULT_REPORT_WIDTH, height: DEFAULT_CHART_HEIGHT, timeType: 'weekly', chartType: 'line', style: { background: 'transparent', borderRadius: '12px' } },
    ];
  }

  const summaryRow = createSummaryCardRow(DEFAULT_SUMMARY_METRICS, { idPrefix: 'summary', x: 48, y: 192, attachedChartId: 'chart-1' });
  const dividerY = 192 + summaryRow.height + (432 - 192 - DEFAULT_SUMMARY_HEIGHT);
  return [
    ...summaryRow.elements,
    createDividerElement('divider-1', 48, dividerY),
    { id: 'chart-1', type: 'chart', x: 48, y: dividerY + 24, width: DEFAULT_REPORT_WIDTH, height: DEFAULT_CHART_HEIGHT, timeType: 'weekly', chartType: 'combo', style: { background: 'transparent', borderRadius: '12px' } },
  ];
};

const createTemplateLayoutElements = (templateId, isComparison) => {
  if (templateId === 'blank') return [];

  if (!isComparison && templateId === 'operations') {
    const summaryRow = createSummaryCardRow(['total', 'peak', 'busiestTime'], { idPrefix: 'summary', x: 48, y: 192, attachedChartId: 'chart-1' });
    const dividerY = 192 + summaryRow.height + 12;
    const rowY = dividerY + 24;
    return [
      ...summaryRow.elements,
      createDividerElement('divider-1', 48, dividerY),
      { id: 'chart-1', type: 'chart', x: 48, y: rowY, width: 432, height: 360, timeType: 'daily', chartType: 'bar', useReportTimeframe: true, style: { background: 'transparent', borderRadius: '12px' } },
      createDividerElement('divider-2', 488, rowY, 24, 360, 'vertical'),
      { id: 'text-1', type: 'text', x: 512, y: rowY, width: 256, height: 168, content: 'Operational notes', style: { fontSize: '22px', fontFamily: FONT_FAMILY_OPTIONS[0].value, color: DEFAULT_TEXT_COLOR, background: DEFAULT_CARD_BACKGROUND, fontWeight: '700', textAlign: 'left' } },
      { id: 'text-2', type: 'text', x: 512, y: rowY + 192, width: 256, height: 168, content: 'Add sensor maintenance, signal timing, or corridor-use observations here.', style: { fontSize: '15px', fontFamily: FONT_FAMILY_OPTIONS[0].value, color: '#475569', background: DEFAULT_CARD_BACKGROUND, fontWeight: 'normal', textAlign: 'left' } },
    ];
  }

  if (!isComparison && templateId === 'trend-review') {
    const summaryRow = createSummaryCardRow(['averageSpeed', 'v85Speed', 'maxSpeed'], { idPrefix: 'summary', x: 48, y: 756, attachedChartId: 'chart-1', maxWidth: 336 });
    return [
      { id: 'chart-1', type: 'chart', x: 48, y: 192, width: DEFAULT_REPORT_WIDTH, height: 528, timeType: 'weekly', chartType: 'speed_profile', useReportTimeframe: true, style: { background: 'transparent', borderRadius: '12px' } },
      createDividerElement('divider-1', 48, 732),
      ...summaryRow.elements,
      createDividerElement('divider-2', 396, 756, 24, 216, 'vertical'),
      { id: 'text-1', type: 'text', x: 420, y: 756, width: 348, height: 216, content: 'Key takeaways', style: { fontSize: '24px', fontFamily: FONT_FAMILY_OPTIONS[0].value, color: DEFAULT_TEXT_COLOR, background: DEFAULT_CARD_BACKGROUND, fontWeight: '700', textAlign: 'left' } },
    ];
  }

  if (isComparison && templateId === 'executive-compare') {
    const summaryRow = createSummaryCardRow(['average'], { idPrefix: 'summary', x: 48, y: 192, attachedChartId: 'chart-1', isComparison: true });
    const dividerY = 192 + summaryRow.height + 12;
    const chartY = dividerY + 24;
    const divider2Y = chartY + 432 + 12;
    return [
      ...summaryRow.elements,
      createDividerElement('divider-1', 48, dividerY),
      { id: 'chart-1', type: 'chart', x: 48, y: chartY, width: DEFAULT_REPORT_WIDTH, height: 432, timeType: 'weekly', chartType: 'combo', useReportTimeframe: true, style: { background: 'transparent', borderRadius: '12px' } },
      createDividerElement('divider-2', 48, divider2Y),
      { id: 'text-1', type: 'text', x: 48, y: divider2Y + 24, width: DEFAULT_REPORT_WIDTH, height: 120, content: 'Executive interpretation', style: { fontSize: '24px', fontFamily: FONT_FAMILY_OPTIONS[0].value, color: DEFAULT_TEXT_COLOR, background: DEFAULT_CARD_BACKGROUND, fontWeight: '700', textAlign: 'left' } },
    ];
  }

  if (isComparison && templateId === 'corridor-benchmark') {
    const summaryRow = createSummaryCardRow(['peak'], { idPrefix: 'summary', x: 48, y: 588, attachedChartId: 'chart-1', isComparison: true });
    const textY = 588 + summaryRow.height + 36;
    return [
      { id: 'chart-1', type: 'chart', x: 48, y: 192, width: 336, height: 360, timeType: 'daily', chartType: 'bar', useReportTimeframe: true, style: { background: 'transparent', borderRadius: '12px' } },
      createDividerElement('divider-1', 396, 192, 24, 360, 'vertical'),
      { id: 'chart-2', type: 'chart', x: 432, y: 192, width: 336, height: 360, timeType: 'weekly', chartType: 'line', useReportTimeframe: true, style: { background: 'transparent', borderRadius: '12px' } },
      createDividerElement('divider-2', 48, 564),
      ...summaryRow.elements,
      { id: 'text-1', type: 'text', x: 48, y: textY, width: DEFAULT_REPORT_WIDTH, height: 120, content: 'Benchmark notes', style: { fontSize: '22px', fontFamily: FONT_FAMILY_OPTIONS[0].value, color: DEFAULT_TEXT_COLOR, background: DEFAULT_CARD_BACKGROUND, fontWeight: '700', textAlign: 'left' } },
    ];
  }

  return createDefaultTemplateElements(isComparison);
};

const createTemplateElements = (templateId, isComparison) => {
  const layout = createTemplateLayoutElements(templateId, isComparison);
  if (templateId === 'blank') return layout;
  const question = getDecisionQuestion(STUDIO_PRODUCT, templateId, isComparison ? 'comparison' : 'solo');
  const note = layout.find(element => element.type === 'text');
  if (note) { note.content = `${question}\n\nFinding:\nRecommended action:\nEvidence and limitations:`; note.style = { ...note.style, fontSize: '15px', fontWeight: 'normal' }; }
  return layout;
};

const ToolbarIconButton = ({ label, tooltip = label, tooltipAlign = 'center', primary = false, children, ...props }) => (
  <span className={styles.iconAction} data-tooltip={tooltip} data-tooltip-align={tooltipAlign} data-popup-open={props['aria-expanded'] || undefined}>
    <button type="button" aria-label={label}
      className={`${primary ? styles.primaryBtn : styles.toolbarBtn} ${styles.toolbarIconButton}`} {...props}>
      {children}
    </button>
  </span>
);

export const InsightBuilderPage = ({ type = 'solo', title = 'Solo Insight' }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams(); 
  const isComparison = type === 'comparison';
  const viewingVersionId = searchParams.get('version');
  const isViewingVersion = Boolean(viewingVersionId);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [workspaceInitialTab, setWorkspaceInitialTab] = useState('overview');
  const latestElementsRef = useRef([]);
  const template = searchParams.get('template') || 'default';
  const templateConfig = getTemplateConfig(type, template);

  const reportRef = useRef(null);
  const canvasRef = useRef(null);
  const uploadInputRef = useRef(null);
  const summaryCardsMenuRef = useRef(null);
  const hasLoadedReportRef = useRef(false);
  const createdReportIdRef = useRef(null);
  const pendingSavedUrlRef = useRef(null);
  const navigationBlockerRef = useRef(null);
  const lastSavedRevisionRef = useRef(null);
  const mountedRef = useRef(true);
  const urlDocumentKey = `${searchParams.get('id') || ''}|${templateConfig.id}`;
  const lastUrlDocumentRef = useRef(urlDocumentKey);
  const editRevisionRef = useRef(0);
  const savedIndicatorTimerRef = useRef(null);
  const lastCleanSnapshotRef = useRef(null);
  const confirmResolveRef = useRef(null);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const exportPageCountRef = useRef(DEFAULT_PAGE_COUNT);
  const copiedElementRef = useRef(null);
  const textDraftsRef = useRef({});
  const textSelectionRef = useRef(null);
  const collaborationChannelRef = useRef(null);
  
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [runSaveTask] = useState(createSingleFlightTask);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(savedIndicatorTimerRef.current);
    };
  }, []);
  const [reportLoadError, setReportLoadError] = useState('');
  const [reportReloadVersion, setReportReloadVersion] = useState(0);
  const [isSavingAndLeaving, setIsSavingAndLeaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [exportPreviewImage, setExportPreviewImage] = useState('');
  const [exportPreviewPages, setExportPreviewPages] = useState([]);
  const [reportId, setReportId] = useState(searchParams.get('id'));
  const [isReportLoading, setIsReportLoading] = useState(Boolean(searchParams.get('id')));
  const [reportSettings, setReportSettings] = useState(() => getTemplateReportSettings(templateConfig.id, type));
  const [editingTextId, setEditingTextId] = useState(null);
  const [snapGuides, setSnapGuides] = useState({ vertical: [], horizontal: [] });
  const [collaborationUser, setCollaborationUser] = useState(null);
  const [collaborators, setCollaborators] = useState([]);
  const [remoteLocks, setRemoteLocks] = useState({});
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [selectedShareRecipients, setSelectedShareRecipients] = useState([]);
  const [shareError, setShareError] = useState('');
  const [shareNotice, setShareNotice] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [shareEmailDirectory, setShareEmailDirectory] = useState([]);
  const [isShareDirectoryLoading, setIsShareDirectoryLoading] = useState(false);
  const [reportAccessRole, setReportAccessRole] = useState(() => (searchParams.get('id') ? 'loading' : 'owner'));
  const [currentProfileRole, setCurrentProfileRole] = useState('viewer');
  const [isProfileRoleLoading, setIsProfileRoleLoading] = useState(true);
  const [profileRoleError, setProfileRoleError] = useState('');
  const isViewerProfile = currentProfileRole === 'viewer';
  const isReportAccessPending = reportAccessRole === 'loading' || isProfileRoleLoading;
  const isReadOnlyReport = isViewingVersion || reportAccessRole === 'viewer' || isReportAccessPending || isViewerProfile;
  const canUseBuilderTools = !isReadOnlyReport;
  const returnReportTab = searchParams.get('fromTab') === 'shared' ? 'shared' : 'owned';
  const insightsLandingPath = returnReportTab === 'shared' ? '/insights-studio?tab=shared' : '/insights-studio';
  const filteredShareSuggestions = useMemo(() => {
    const activeToken = getActiveShareEmailToken(shareEmail);
    if (!shareDialogOpen) return [];

    const sharedEmails = new Set((Array.isArray(reportSettings.sharedWith) ? reportSettings.sharedWith : [])
      .map((value) => String(value).trim().toLowerCase())
      .filter(Boolean));
    const selectedEmails = new Set(selectedShareRecipients
      .map((recipient) => String(recipient.email).trim().toLowerCase())
      .filter(Boolean));
    const enteredEmails = new Set(parseShareEmails(shareEmail).filter((value) => value !== activeToken));

    return shareEmailDirectory
      .map((profile) => {
        const email = String(profile.email || '').trim().toLowerCase();
        if (!email || sharedEmails.has(email) || selectedEmails.has(email) || enteredEmails.has(email)) return null;
        const matchRank = getShareSuggestionMatchRank(profile, activeToken);
        return matchRank === null ? null : { ...profile, matchRank };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (left.matchRank !== right.matchRank) return left.matchRank - right.matchRank;
        const leftLabel = left.fullName || left.email;
        const rightLabel = right.fullName || right.email;
        return leftLabel.localeCompare(rightLabel);
      });
  }, [reportSettings.sharedWith, selectedShareRecipients, shareDialogOpen, shareEmail, shareEmailDirectory]);
  
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
    let isMounted = true;

    const fetchCurrentRole = async () => {
      setIsProfileRoleLoading(true);
      setProfileRoleError('');
      try {
        const { data: userResult, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        const userId = userResult?.user?.id;
        if (!userId) throw new Error('No signed-in account.');

        const { data: profile, error: roleError } = await supabase
          .from('profile')
          .select('role')
          .eq('id', userId)
          .maybeSingle();
        if (roleError) throw roleError;

        if (isMounted) setCurrentProfileRole(normalizeStudioRole(profile?.role));
      } catch {
        if (isMounted) {
          setCurrentProfileRole('viewer');
          setProfileRoleError('Your report access could not be verified. Please try again.');
        }
      } finally {
        if (isMounted) setIsProfileRoleLoading(false);
      }
    };

    fetchCurrentRole();

    return () => {
      isMounted = false;
    };
  }, [reportReloadVersion]);

  useEffect(() => {
    if (!isProfileRoleLoading && !profileRoleError && isViewerProfile && (!reportId || reportAccessRole === 'owner')) {
      navigate('/insights-studio?tab=shared', { replace: true });
    }
  }, [isProfileRoleLoading, isViewerProfile, navigate, profileRoleError, reportAccessRole, reportId]);

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
    let active = true;
    hasLoadedReportRef.current = false;
    const fetchExistingLayout = async () => {
      if (!reportId || createdReportIdRef.current === reportId) {
        createdReportIdRef.current = null;
        hasLoadedReportRef.current = true;
        setReportAccessRole('owner');
        setReportLoadError('');
        setIsReportLoading(false);
        return;
      }
      setIsReportLoading(true);
      setReportAccessRole('loading');
      setReportLoadError('');
      try {
        const [result, auth] = await Promise.all([
          supabase.from('saved_reports').select('*').eq('id', reportId).single(),
          supabase.auth.getUser(),
        ]);
        if (!active) return;
        if (result.error) throw result.error;
        if (auth.error) throw auth.error;
        let data = result.data;
        if (viewingVersionId && data) {
          const version = await loadReportVersion(supabase, reportId, viewingVersionId);
          if (!active) return;
          data = { ...data, ...version.snapshot };
        }
        const user = auth.data?.user;
        if (!data || !user?.id) throw new Error('Report access is unavailable.');
        const savedLayout = parseSavedLayoutData(data.layout_data);
        if (!savedLayout) throw new Error('The saved report layout could not be read.');
        const savedMode = inferReportModeFromLayout(savedLayout);
        if (savedMode !== type) {
          const params = new URLSearchParams({ id: reportId });
          if (viewingVersionId) params.set('version', viewingVersionId);
          if (returnReportTab === 'shared') params.set('fromTab', 'shared');
          navigate('/insights-studio/' + savedMode + '?' + params, { replace: true });
          return;
        }
        const loadedDocMeta = {
          title: data.title || 'Activity & Operations Report',
          author: data.author || 'Transportation Analytics Team',
          date: data.date || new Date().toLocaleDateString(),
          period: data.period || 'Last 7 Days',
        };
        const sharedWith = getReportSharedEmails(data);
        const sharedAccess = getReportSharedAccess(data);
        const settings = { ...savedLayout.reportSettings, sharedWith, sharedAccess };
        textDraftsRef.current = {};
        textSelectionRef.current = null;
        undoStackRef.current = [];
        redoStackRef.current = [];
        setDocMeta(loadedDocMeta);
        setElements(savedLayout.elements);
        setPageCount(savedLayout.pageCount);
        setSelections(savedLayout.selections);
        setComparisonSelections(savedLayout.comparisonSelections);
        setReportSettings(settings);
        setSelectedElementId(null);
        setEditingTextId(null);
        setReportAccessRole(data.owner_id === user.id ? 'owner' : (sharedAccess[String(user.email || '').toLowerCase()] || 'viewer'));
        lastCleanSnapshotRef.current = JSON.stringify(getComparableReportState(getSavedReportState({
          mode: type, elements: savedLayout.elements, pageCount: savedLayout.pageCount,
          selections: savedLayout.selections, comparisonSelections: savedLayout.comparisonSelections,
          reportSettings: settings,
        }), loadedDocMeta));
        hasLoadedReportRef.current = true;
        setIsDirty(false);
      } catch (error) {
        if (active) {
          console.error('Failed to open report:', error.message);
          setReportLoadError('This report could not be opened. Please try again.');
        }
      } finally {
        if (active) setIsReportLoading(false);
      }
    };
    void fetchExistingLayout();
    return () => { active = false; };
  }, [navigate, reportId, reportReloadVersion, returnReportTab, type, viewingVersionId]);

  useEffect(() => {
    if (!reportId) {
      setCollaborators([]);
      setRemoteLocks({});
      setCollaborationUser(null);
      return undefined;
    }

    let isMounted = true;
    let channel;

    const setupCollaboration = async () => {
      const { data: userResult } = await supabase.auth.getUser();
      if (!isMounted) return;

      const userEmail = userResult?.user?.email || 'Anonymous editor';
      const userId = userResult?.user?.id || `${userEmail}-${Date.now()}`;
      const userInfo = {
        id: userId,
        email: userEmail,
        name: userEmail.split('@')[0] || userEmail,
        joinedAt: new Date().toISOString(),
      };

      setCollaborationUser(userInfo);

      channel = supabase.channel(`insights-studio-report-${reportId}`, {
        config: { presence: { key: userId } },
      });
      collaborationChannelRef.current = channel;

      channel
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState();
          const activeUserIds = new Set(Object.values(state).flat().map((presence) => presence.id));
          const nextCollaborators = Object.values(state)
            .flat()
            .filter((presence) => presence.id !== userId);
          setCollaborators(nextCollaborators);
          setRemoteLocks((current) => Object.fromEntries(
            Object.entries(current).filter(([, lock]) => activeUserIds.has(lock.userId)),
          ));
        })
        .on('broadcast', { event: 'widget-lock' }, ({ payload }) => {
          if (!payload?.elementId || payload.userId === userId) return;
          setRemoteLocks((current) => ({
            ...current,
            [payload.elementId]: payload,
          }));
        })
        .on('broadcast', { event: 'widget-unlock' }, ({ payload }) => {
          if (!payload?.elementId || payload.userId === userId) return;
          setRemoteLocks((current) => {
            const nextLocks = { ...current };
            delete nextLocks[payload.elementId];
            return nextLocks;
          });
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await channel.track(userInfo);
          }
        });
    };

    setupCollaboration();

    return () => {
      isMounted = false;
      if (channel) {
        channel.untrack();
        supabase.removeChannel(channel);
      }
      if (collaborationChannelRef.current === channel) {
        collaborationChannelRef.current = null;
      }
    };
  }, [reportId]);

  // Initial Elements - Resized to fit nicely
  const [elements, setElements] = useState(() => (reportId ? [] : createTemplateElements(templateConfig.id, isComparison)));
  const [pageCount, setPageCount] = useState(DEFAULT_PAGE_COUNT);
  useEffect(() => { latestElementsRef.current = elements; }, [elements]);

  // Only gate entry behind a scope prompt for a genuinely new, non-blank report —
  // loading a saved report or starting from the blank template should never show this.
  const [showTargetPrompt, setShowTargetPrompt] = useState(() => !reportId && templateConfig.id !== 'blank');

  const [isSummaryCardsMenuOpen, setIsSummaryCardsMenuOpen] = useState(false);

  // A query-string navigation can switch reports without remounting this route.
  useEffect(() => {
    if (lastUrlDocumentRef.current === urlDocumentKey) return;
    lastUrlDocumentRef.current = urlDocumentKey;
    const urlReportId = searchParams.get('id');
    if (urlReportId && urlReportId === reportId) return;
    hasLoadedReportRef.current = false;
    lastCleanSnapshotRef.current = null;
    createdReportIdRef.current = null;
    pendingSavedUrlRef.current = null;
    textDraftsRef.current = {};
    undoStackRef.current = [];
    redoStackRef.current = [];
    setEditingTextId(null);
    setSelectedElementId(null);
    setIsDirty(false);
    setIsSaved(false);
    setReportId(urlReportId);
    setIsReportLoading(Boolean(urlReportId));
    setReportLoadError('');
    setReportAccessRole(urlReportId ? 'loading' : 'owner');
    setShowTargetPrompt(!urlReportId && templateConfig.id !== 'blank');
    if (!urlReportId) {
      setElements(createTemplateElements(templateConfig.id, isComparison));
      setPageCount(DEFAULT_PAGE_COUNT);
      setReportSettings(getTemplateReportSettings(templateConfig.id, type));
      setSelections(EMPTY_TARGET_SELECTION);
      setComparisonSelections(EMPTY_TARGET_SELECTION);
      setDocMeta({
        title: TEMPLATE_DOC_META[templateConfig.id]?.title || (isComparison ? 'Comparison Report' : 'Activity & Operations Report'),
        author: 'Transportation Analytics Team',
        date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        period: TEMPLATE_DOC_META[templateConfig.id]?.period || 'Last 7 Days',
      });
    }
  }, [isComparison, reportId, searchParams, templateConfig.id, type, urlDocumentKey]);

  useEffect(() => {
    if (!isSummaryCardsMenuOpen) return undefined;

    const closeOnOutsideClick = (event) => {
      if (!summaryCardsMenuRef.current?.contains(event.target)) setIsSummaryCardsMenuOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [isSummaryCardsMenuOpen]);

  const [selectedElementId, setSelectedElementId] = useState(null);
  const activeElement = elements.find(el => el.id === selectedElementId);
  const isCoverSelected = selectedElementId === 'cover';
  const hasCoverPage = reportSettings.showCoverPage;
  const hasDocumentHeader = reportSettings.showDocumentHeader;
  const reportContentOffset = hasCoverPage ? PAGE_HEIGHT : 0;
  const visiblePageCount = Math.max(pageCount, getRequiredPageCount(elements));
  const totalVisiblePageCount = visiblePageCount + (hasCoverPage ? 1 : 0);

  const getCurrentReportSnapshotString = useCallback((candidateElements = elements, candidateReportSettings = reportSettings) => JSON.stringify(getComparableReportState(getSavedReportState({
    mode: type,
    elements: applyTextDraftsToLayout(candidateElements, textDraftsRef.current),
    pageCount: visiblePageCount,
    selections,
    comparisonSelections,
    reportSettings: candidateReportSettings,
  }), docMeta)), [comparisonSelections, docMeta, elements, reportSettings, selections, type, visiblePageCount]);

  const hasActualUnsavedChanges = useCallback((candidateElements = elements) => (
    !lastCleanSnapshotRef.current || getCurrentReportSnapshotString(candidateElements) !== lastCleanSnapshotRef.current
  ), [elements, getCurrentReportSnapshotString]);

  useEffect(() => {
    if (reportId || !hasLoadedReportRef.current || lastCleanSnapshotRef.current) return;
    lastCleanSnapshotRef.current = getCurrentReportSnapshotString();
    setIsDirty(false);
  }, [getCurrentReportSnapshotString, reportId]);

  const navigationBlocker = useBlocker(({ currentLocation, nextLocation, historyAction }) => {
    const nextId = new URLSearchParams(nextLocation.search).get('id');
    const isSavedUrlUpdate = historyAction === 'REPLACE'
      && currentLocation.pathname === nextLocation.pathname
      && pendingSavedUrlRef.current === nextId && nextId === reportId;
    if (isSavedUrlUpdate) return false;
    return !isReadOnlyReport && hasLoadedReportRef.current
      && (isSaving || hasActualUnsavedChanges());
  });

  useEffect(() => { navigationBlockerRef.current = navigationBlocker; }, [navigationBlocker]);

  useEffect(() => {
    const savedId = pendingSavedUrlRef.current;
    if (!savedId || savedId !== reportId || navigationBlocker.state !== 'unblocked') return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('id', savedId);
      return next;
    }, { replace: true });
    pendingSavedUrlRef.current = null;
  }, [navigationBlocker.state, reportId, setSearchParams]);

  const broadcastWidgetLock = useCallback((elementId) => {
    if (!elementId || elementId === 'cover' || !collaborationChannelRef.current || !collaborationUser) return;
    collaborationChannelRef.current.send({
      type: 'broadcast',
      event: 'widget-lock',
      payload: {
        elementId,
        userId: collaborationUser.id,
        userName: collaborationUser.name,
        userEmail: collaborationUser.email,
        lockedAt: new Date().toISOString(),
      },
    });
  }, [collaborationUser]);

  const broadcastWidgetUnlock = useCallback((elementId) => {
    if (!elementId || elementId === 'cover' || !collaborationChannelRef.current || !collaborationUser) return;
    collaborationChannelRef.current.send({
      type: 'broadcast',
      event: 'widget-unlock',
      payload: {
        elementId,
        userId: collaborationUser.id,
      },
    });
  }, [collaborationUser]);

  const selectElement = useCallback((elementId) => {
    if (isReadOnlyReport) return false;
    if (elementId && remoteLocks[elementId]) return false;
    setSelectedElementId((currentId) => {
      if (currentId && currentId !== elementId) broadcastWidgetUnlock(currentId);
      if (elementId && elementId !== currentId) broadcastWidgetLock(elementId);
      return elementId;
    });
    return true;
  }, [broadcastWidgetLock, broadcastWidgetUnlock, isReadOnlyReport, remoteLocks]);

  const clearSelectedElement = useCallback(() => {
    setSelectedElementId((currentId) => {
      if (currentId) broadcastWidgetUnlock(currentId);
      return null;
    });
  }, [broadcastWidgetUnlock]);

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
    const selectedAreaSensorIds = getRoomsForSelections(targetSelections)
      .map((sensor) => sensor.sensor_id)
      .filter(Boolean);

    if (targetSelections.floorNumber) {
      const selectedSensor = allRooms.find((sensor) => sensor.sensor_id === targetSelections.floorNumber);
      return {
        level: 'floor',
        id: targetSelections.floorNumber,
        label: selectedSensor?.corridor_name || `Corridor ${targetSelections.floorNumber}`,
        sensorIds: [targetSelections.floorNumber],
      };
    }

    return {
      level: 'area',
      id: targetSelections.areaId,
      label: selectedArea?.name || fallbackLabel,
      sensorIds: selectedAreaSensorIds,
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
    if (isReadOnlyReport) return;
    editRevisionRef.current += 1;
    setIsSaved(false);
    if (hasLoadedReportRef.current) setIsDirty(true);
  }, [isReadOnlyReport]);

  const getReportSnapshot = useCallback(() => ({
    docMeta,
    elements,
    pageCount,
    selections,
    comparisonSelections,
    reportSettings,
  }), [comparisonSelections, docMeta, elements, pageCount, reportSettings, selections]);

  const pushUndoSnapshot = useCallback(() => {
    if (isReadOnlyReport) return;
    if (!hasLoadedReportRef.current) return;
    undoStackRef.current = [...undoStackRef.current.slice(-39), getReportSnapshot()];
    redoStackRef.current = [];
  }, [getReportSnapshot, isReadOnlyReport]);

  const restoreSnapshot = useCallback((snapshot) => {
    if (isReadOnlyReport) return;
    if (!snapshot) return;
    textDraftsRef.current = {};
    textSelectionRef.current = null;
    setEditingTextId(null);
    setDocMeta(snapshot.docMeta);
    setElements(snapshot.elements);
    setPageCount(snapshot.pageCount);
    setSelections(snapshot.selections);
    setComparisonSelections(snapshot.comparisonSelections);
    setReportSettings(snapshot.reportSettings);
    markDirty();
  }, [isReadOnlyReport, markDirty]);

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
    if (isReadOnlyReport) return;
    pushUndoSnapshot();
    setDocMeta((current) => ({ ...current, ...updates }));
    markDirty();
  };

  const updateReportSettings = (updates) => {
    if (isReadOnlyReport) return;
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

  const updateElementTimeframe = (id, timeType) => {
    updateElement(id,
      timeType === 'custom'
        ? { timeType }
        : { timeType, startDate: '', endDate: '', startTime: '00:00', endTime: '23:59' }
    );
  };

  const resetElementCustomTimeframe = (id) => {
    updateElement(id, {
      startDate: '',
      endDate: '',
      startTime: '00:00',
      endTime: '23:59',
    });
  };

  const updateElement = (id, updates) => {
    if (isReadOnlyReport) return;
    pushUndoSnapshot();
    const shouldRefreshSnapshot = ['chartType', 'summaryMetric', 'summaryMetrics', 'customMetrics', 'selections', 'comparisonSelections', 'comparisonSelectionList', 'attachedChartId', 'useReportTimeframe', 'timeType', 'startDate', 'endDate', 'startTime', 'endTime', 'dayPreset'].some((key) => key in updates);
    setElements(elements.map((el) => {
      if (el.id !== id) return el;
      return { ...el, ...(shouldRefreshSnapshot ? { snapshotData: undefined, snapshotKey: undefined } : {}), ...updates };
    }));
    markDirty();
  };
  const updateElementStyle = (id, property, value) => {
    if (isReadOnlyReport) return;
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
      const nextHtml = sanitizeReportHtml(selectedText.container.innerHTML);
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
      const rawHtml = textDraftsRef.current[element.id] ?? node?.innerHTML;
      const nextHtml = typeof rawHtml === 'string' ? sanitizeReportHtml(rawHtml) : rawHtml;
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

  const updateElementSnapshot = useCallback((id, snapshotKey, snapshotData, dataEvidence) => {
    if (isReadOnlyReport) return;
    setElements((currentElements) => currentElements.map((element) => {
      if (element.id !== id || element.snapshotKey === snapshotKey) return element;
      return { ...element, snapshotKey, snapshotData, ...(dataEvidence ? { dataEvidence } : {}) };
    }));
  }, [isReadOnlyReport]);

  const refreshElementSnapshot = (id) => {
    if (isReadOnlyReport) return;
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

  // A summary attached to a chart always mirrors that chart's timeframe (it's
  // describing that chart's data); otherwise an element with useReportTimeframe
  // === false runs on its own timeframe instead of the report's default.
  const getElementTimeframe = (element) => {
    const attachedChart = getAttachedChart(element);
    if (attachedChart) return getElementTimeframe(attachedChart);
    return element?.useReportTimeframe === false ? (element.timeType || 'weekly') : reportSettings.timeframe;
  };

  const getElementFilters = (element) => {
    const attachedChart = getAttachedChart(element);
    if (attachedChart) return getElementFilters(attachedChart);

    if (element?.useReportTimeframe === false) {
      return element.timeType === 'custom'
        ? {
          startDate: element.startDate || '',
          endDate: element.endDate || '',
          startTime: element.startTime || '',
          endTime: element.endTime || '',
          dayPreset: element.dayPreset || 'all',
        }
        : {
          startDate: '',
          endDate: '',
          startTime: '',
          endTime: '',
          dayPreset: element.dayPreset || 'all',
        };
    }

    return reportFilters;
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
      // Narrowing a MULTI-metric summary card's row can push its cards onto more
      // rows than fit in the widget's current height, which then get clipped by
      // the widget box's `overflow: hidden` — floor the height at whatever the
      // card grid actually needs for the new width, same as what's used when the
      // widget is first created. A single-metric card is always exactly one row
      // regardless of width, so it has no such floor and can be resized freely.
      const summaryMetricCount = Array.isArray(resizedElement?.summaryMetrics) ? resizedElement.summaryMetrics.length : 1;
      const finalHeight = resizedElement?.type === 'summary' && summaryMetricCount > 1
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

  // A single-metric summary card — `isIndividualMetricCard` tells the properties
  // panel to offer a one-metric picker instead of the multi-select checkboxes a
  // combined banner uses, since swapping the metric here should replace it, not
  // add to it.
  const createSummaryMetricElement = (metricValue, position, zIndex) => {
    const newEl = {
      id: `summary-${metricValue}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'summary',
      x: position.x,
      y: position.y,
      zIndex,
      style: { borderRadius: '12px', background: '#ffffff' },
      width: SINGLE_SUMMARY_CARD_WIDTH,
      useReportTimeframe: true,
      timeType: reportSettings.timeframe,
      summaryMetric: isComparison ? metricValue : undefined,
      summaryMetrics: [metricValue],
      isIndividualMetricCard: true,
      selections,
      comparisonSelections,
      comparisonSelectionList: [],
    };
    newEl.height = getAutoSummaryHeight(newEl, isComparison, newEl.width);
    return newEl;
  };

  const addSummaryMetricCard = (metricValue) => {
    const newEl = createSummaryMetricElement(metricValue, getNewElementPosition(), getNextZIndex());
    pushUndoSnapshot();
    setElements([...elements, newEl]);
    setSelectedElementId(newEl.id);
    markDirty();
  };

  const addAutoInsightForChart = () => {
    if (!activeElement || activeElement.type !== 'chart') return;

    const chartName = getChartDisplayName(activeElement);
    const targetLabel = isComparison
      ? 'the selected corridors'
      : (primaryTarget.label || 'the selected corridor');
    const timeframeLabel = reportSettings.timeframe === 'daily'
      ? '24-hour'
      : reportSettings.timeframe === 'monthly'
        ? 'monthly'
        : reportSettings.timeframe === 'custom'
          ? 'custom'
          : 'weekly';
    const content = `${chartName} highlights ${timeframeLabel} movement for ${targetLabel}. Review peak traffic periods, speed changes, and threshold crossings before sharing this report.`;
    const newId = `text-${Date.now()}`;
    const newEl = {
      id: newId,
      type: 'text',
      x: activeElement.x,
      y: activeElement.y + activeElement.height + GRID_SIZE,
      width: Math.min(activeElement.width, DEFAULT_REPORT_WIDTH),
      height: 120,
      content,
      zIndex: getNextZIndex(),
      style: {
        fontSize: '16px',
        fontFamily: FONT_FAMILY_OPTIONS[0].value,
        color: '#334155',
        background: '#f8fafc',
        fontWeight: 'normal',
        textAlign: 'left',
        borderRadius: '12px',
      },
    };

    pushUndoSnapshot();
    setElements([...elements, newEl]);
    setSelectedElementId(newId);
    markDirty();
  };

  const autoFitActiveChartToPage = () => {
    if (!activeElement || activeElement.type !== 'chart') return;

    const pageIndex = Math.max(0, Math.floor(activeElement.y / PAGE_HEIGHT));
    const pageTop = pageIndex * PAGE_HEIGHT;
    const topPadding = pageIndex === 0 && hasDocumentHeader ? 192 : 48;
    const footerPadding = reportSettings.showFooter ? 96 : 48;
    const nextY = pageTop + topPadding;
    const nextHeight = Math.max(260, PAGE_HEIGHT - topPadding - footerPadding);

    updateElement(activeElement.id, {
      x: 48,
      y: nextY,
      width: DEFAULT_REPORT_WIDTH,
      height: nextHeight,
    });
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
    if (isReadOnlyReport) return;
    pushUndoSnapshot();
    setPageCount((currentPageCount) => currentPageCount + 1);
    markDirty();
  };

  const removePage = () => {
    if (isReadOnlyReport) return;
    pushUndoSnapshot();
    setPageCount((currentPageCount) => Math.max(DEFAULT_PAGE_COUNT, currentPageCount - 1));
    markDirty();
  };

  const deleteSelected = useCallback(() => {
    if (isReadOnlyReport) return;
    if (selectedElementId) {
      pushUndoSnapshot();
      setElements(elements.filter(el => el.id !== selectedElementId));
      broadcastWidgetUnlock(selectedElementId);
      setSelectedElementId(null);
      markDirty();
    }
  }, [broadcastWidgetUnlock, elements, isReadOnlyReport, markDirty, pushUndoSnapshot, selectedElementId]);

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

  const captureCanvasWithFallbacks = async (node, options) => {
    const attempts = [
      { label: 'high-resolution', scale: 2 },
      { label: 'standard-resolution', scale: 1 },
      { label: 'foreign-object', scale: 1, foreignObjectRendering: true },
    ];
    let lastError;

    for (const attempt of attempts) {
      try {
        return await html2canvas(node, {
          ...options,
          ...attempt,
          onclone: (clonedDocument) => {
            clonedDocument
              .querySelectorAll('[data-html2canvas-ignore="true"], .recharts-tooltip-wrapper')
              .forEach((ignoredNode) => ignoredNode.remove());
          },
        });
      } catch (error) {
        lastError = error;
        console.warn(`Report capture ${attempt.label} attempt failed:`, error);
      }
    }

    throw lastError;
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
      await requireReportReady(element);
      await waitForNextPaint();

      const captureOptions = {
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        ignoreElements: (node) => node?.classList?.contains?.('recharts-tooltip-wrapper'),
      };

      const pageCanvases = [];
      for (let pageIndex = 0; pageIndex < totalVisiblePageCount; pageIndex += 1) {
        try {
          const pageCanvas = await captureCanvasWithFallbacks(element, {
            ...captureOptions,
            x: 0,
            y: pageIndex * PAGE_HEIGHT,
            width: PAGE_WIDTH,
            height: PAGE_HEIGHT,
            windowWidth: PAGE_WIDTH,
            windowHeight: PAGE_HEIGHT,
            scrollX: 0,
            scrollY: 0,
          });
          pageCanvases.push({ canvas: pageCanvas, pageIndex });
        } catch (pageError) {
          console.error(`Failed to capture report page ${pageIndex + 1}:`, pageError);
        }
      }

      return pageCanvases.map(({ canvas, pageIndex }) => createPageImageFromCanvas(canvas, pageIndex));
    } catch (error) {
      console.error("Failed to capture report:", error);
      return [];
    } finally {
      element.style.height = originalHeight;
      setIsDownloading(false);
    }
  };

  const capturePreviewPages = async () => {
    commitTextDrafts();
    const previewPages = Array.from(document.querySelectorAll('[data-export-capture-page]'));
    if (!previewPages.length) return [];

    flushSync(() => {
      setIsDownloading(true);
    });

    try {
      await waitForNextPaint();
      const pageCanvases = [];
      for (const [index, pageNode] of previewPages.entries()) {
        try {
          await requireReportReady(pageNode);
          await waitForNextPaint();
          const pageCanvas = await captureCanvasWithFallbacks(pageNode, {
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#ffffff',
            logging: false,
            width: PAGE_WIDTH,
            height: PAGE_HEIGHT,
            windowWidth: PAGE_WIDTH,
            windowHeight: PAGE_HEIGHT,
            scrollX: 0,
            scrollY: 0,
            ignoreElements: (node) => node?.classList?.contains?.('recharts-tooltip-wrapper'),
          });
          pageCanvases.push({ canvas: pageCanvas, pageIndex: index });
        } catch (pageError) {
          console.error(`Failed to capture export preview page ${index + 1}:`, pageError);
        }
      }

      return pageCanvases.map(({ canvas, pageIndex }) => createPageImageFromCanvas(canvas, pageIndex));
    } catch (error) {
      console.error('Failed to capture export preview:', error);
      return [];
    } finally {
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

  const loadShareEmailDirectory = async () => {
    setIsShareDirectoryLoading(true);

    try {
      const { members, currentUserId } = await fetchInstitutionTeamMembers(supabase);
      setShareEmailDirectory((members || [])
        .filter((profile) => profile?.email && profile.id !== currentUserId)
        .map((profile) => {
          const fullName = String(profile.full_name || '').trim();
          const nameParts = fullName.split(/\s+/).filter(Boolean);
          return {
            id: profile.id,
            email: String(profile.email).trim().toLowerCase(),
            firstName: nameParts[0] || '',
            lastName: nameParts.slice(1).join(' '),
            fullName,
            role: profile.role || '',
          };
        }));
    } catch (error) {
      console.error('Failed to load share directory:', error);
      setShareEmailDirectory([]);
    } finally {
      setIsShareDirectoryLoading(false);
    }
  };

  const handleOpenShareDialog = async () => {
    setShareError('');
    setShareNotice('');
    let shareReportId = reportId;
    if (!shareReportId) {
      const shouldSave = await requestConfirmation({
        title: 'Save before sharing?',
        message: 'This report needs to be saved before you can invite collaborators.',
        actions: [
          { value: false, label: 'Cancel', variant: 'secondary' },
          { value: true, label: 'Save and continue', variant: 'primary' },
        ],
      });
      if (!shouldSave) return;
      const savedId = await handleSaveLayout();
      if (!savedId) return;
      shareReportId = typeof savedId === 'string' ? savedId : (searchParams.get('id') || reportId);
    }

    if (!shareReportId) {
      await requestConfirmation({
        title: 'Share is almost ready',
        message: 'The report was saved, but the share panel needs the saved report id. Please press Share again.',
        actions: [
          { value: true, label: 'Got it', variant: 'primary' },
        ],
      });
      return;
    }

    setShareDialogOpen(true);
    loadShareEmailDirectory();
  };

  const persistSharedAccess = async (nextSharedWith, nextSharedAccess) => {
    if (!reportId) {
      setShareError('Save this report before changing access.');
      return false;
    }

    setIsSharing(true);
    setShareError('');
    setShareNotice('');

    const committedElements = commitTextDrafts();
    const normalizedSharedWith = nextSharedWith.map((value) => String(value).trim().toLowerCase()).filter(Boolean);
    const normalizedSharedAccess = normalizeSharedAccess(nextSharedAccess, normalizedSharedWith);
    const nextReportSettings = {
      ...reportSettings,
      sharedWith: normalizedSharedWith,
      sharedAccess: normalizedSharedAccess,
    };

    const { error } = await supabase.rpc('update_saved_report_access', {
      p_report_id: reportId,
      p_shared_with_emails: normalizedSharedWith,
      p_shared_access: normalizedSharedAccess,
      p_layout_data: getSavedReportState({
        mode: type,
        elements: committedElements,
        pageCount: visiblePageCount,
        selections,
        comparisonSelections,
        reportSettings: nextReportSettings,
      }),
    });

    if (error) {
      console.error('Failed to update report access:', error.message);
      setShareError('Access could not be updated. Make sure you own this report.');
      setIsSharing(false);
      return false;
    }

    setReportSettings((current) => ({ ...current, sharedWith: nextReportSettings.sharedWith, sharedAccess: nextReportSettings.sharedAccess }));
    setShareNotice('Access updated.');
    lastCleanSnapshotRef.current = JSON.stringify(getComparableReportState(getSavedReportState({
      mode: type,
      elements: committedElements,
      pageCount: visiblePageCount,
      selections,
      comparisonSelections,
      reportSettings: nextReportSettings,
    }), getCheckpointDocMeta(lastCleanSnapshotRef.current, docMeta)));
    setIsDirty(false);
    setIsSharing(false);
    return true;
  };

  const handleChangeSharedAccess = async (sharedEmail, role) => {
    const sharedWith = Array.isArray(reportSettings.sharedWith) ? reportSettings.sharedWith : [];
    const sharedAccess = normalizeSharedAccess(reportSettings.sharedAccess, sharedWith);
    const normalizedEmail = String(sharedEmail).trim().toLowerCase();
    await persistSharedAccess(sharedWith, {
      ...sharedAccess,
      [normalizedEmail]: role === 'viewer' ? 'viewer' : 'editor',
    });
  };

  const handleRemoveSharedAccess = async (sharedEmail) => {
    const normalizedEmail = String(sharedEmail).trim().toLowerCase();
    const confirmRemove = await requestConfirmation({
      title: 'Remove access?',
      message: `${normalizedEmail} will no longer be able to open this report.`,
      actions: [
        { value: false, label: 'Cancel', variant: 'secondary' },
        { value: true, label: 'Remove access', variant: 'danger' },
      ],
    });
    if (!confirmRemove) return;

    const sharedWith = (Array.isArray(reportSettings.sharedWith) ? reportSettings.sharedWith : [])
      .map((value) => String(value).trim().toLowerCase())
      .filter((value) => value && value !== normalizedEmail);
    const sharedAccess = normalizeSharedAccess(reportSettings.sharedAccess, sharedWith);
    delete sharedAccess[normalizedEmail];
    await persistSharedAccess(sharedWith, sharedAccess);
  };

  const handleShareReport = async (allowMultiple = false) => {
    const recipientEmails = Array.from(new Set([
      ...selectedShareRecipients.map((recipient) => String(recipient.email).trim().toLowerCase()),
      ...parseShareEmails(shareEmail),
    ].filter(Boolean)));
    if (!recipientEmails.length) return;
    if (!allowMultiple && recipientEmails.length > 1) {
      setShareError('');
    }

    const invalidEmails = recipientEmails.filter((recipientEmail) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail));
    if (invalidEmails.length) {
      setShareError(`Check ${invalidEmails.length === 1 ? invalidEmails[0] : `${invalidEmails.length} email addresses`} and try again.`);
      return;
    }

    let shareReportId = reportId;
    if (!shareReportId) {
      const savedId = await handleSaveLayout();
      if (!savedId) return;
      shareReportId = typeof savedId === 'string' ? savedId : (searchParams.get('id') || reportId);
    }

    if (!shareReportId) {
      setShareError('Save this report before sharing it.');
      return;
    }

    setIsSharing(true);
    setShareError('');
    setShareNotice('');

    const { data: userResult } = await supabase.auth.getUser();
    const currentUser = userResult?.user;
    if (!currentUser) {
      setShareError('You must be signed in to share reports.');
      setIsSharing(false);
      return;
    }

    const [{ data: currentProfile, error: currentProfileError }, { data: recipientProfiles, error: recipientError }] = await Promise.all([
      supabase
        .from('profile')
        .select('id,email,assigned_institute,role')
        .eq('id', currentUser.id)
        .maybeSingle(),
      supabase
        .from('profile')
        .select('id,email,assigned_institute,role')
        .in('email', recipientEmails),
    ]);

    if (currentProfileError || recipientError) {
      setShareError('User lookup failed. Please try again or contact an admin.');
      setIsSharing(false);
      return;
    }

    const isCheckItAdmin = String(currentProfile?.role || '').trim().toLowerCase() === 'checkit_admin';

    if (!isCheckItAdmin && !currentProfile?.assigned_institute) {
      setShareError('Your account is missing an institute assignment.');
      setIsSharing(false);
      return;
    }

    const profilesByEmail = new Map((recipientProfiles || []).map((profile) => [String(profile.email).toLowerCase(), profile]));
    const missingEmails = recipientEmails.filter((recipientEmail) => !profilesByEmail.has(recipientEmail));
    if (missingEmails.length) {
      setShareError(`${missingEmails.length === 1 ? missingEmails[0] : `${missingEmails.length} emails`} not associated with a CheckIt platform user.`);
      setIsSharing(false);
      return;
    }

    const outsideInstitute = recipientEmails.filter((recipientEmail) => profilesByEmail.get(recipientEmail)?.assigned_institute !== currentProfile.assigned_institute);
    if (!isCheckItAdmin && outsideInstitute.length) {
      setShareError('You can only share with users from your institute.');
      setIsSharing(false);
      return;
    }

    const selfEmails = recipientEmails.filter((recipientEmail) => profilesByEmail.get(recipientEmail)?.id === currentUser.id);
    if (selfEmails.length) {
      setShareError('You cannot share this report with yourself.');
      setIsSharing(false);
      return;
    }

    const committedElements = commitTextDrafts();
    const nextSharedWith = Array.from(new Set([
      ...(Array.isArray(reportSettings.sharedWith) ? reportSettings.sharedWith.map((value) => String(value).trim().toLowerCase()) : []),
      ...recipientEmails,
    ]));
    const nextSharedAccess = {
      ...normalizeSharedAccess(reportSettings.sharedAccess, nextSharedWith),
      ...Object.fromEntries(recipientEmails.map((recipientEmail) => [recipientEmail, 'editor'])),
    };
    const nextReportSettings = {
      ...reportSettings,
      sharedWith: nextSharedWith,
      sharedAccess: nextSharedAccess,
    };

    const { error } = await supabase.rpc('update_saved_report_access', {
      p_report_id: shareReportId,
      p_shared_with_emails: nextSharedWith,
      p_shared_access: nextSharedAccess,
      p_layout_data: getSavedReportState({
        mode: type,
        elements: committedElements,
        pageCount: visiblePageCount,
        selections,
        comparisonSelections,
        reportSettings: nextReportSettings,
      }),
    });

    if (error) {
      console.error('Failed to mark report as shared:', error.message);
      setShareError('Couldn’t share the report. Please try again.');
      setIsSharing(false);
      return;
    }

    setReportSettings((current) => ({ ...current, sharedWith: nextReportSettings.sharedWith, sharedAccess: nextReportSettings.sharedAccess }));
    lastCleanSnapshotRef.current = JSON.stringify(getComparableReportState(getSavedReportState({
      mode: type,
      elements: committedElements,
      pageCount: visiblePageCount,
      selections,
      comparisonSelections,
      reportSettings: nextReportSettings,
    }), getCheckpointDocMeta(lastCleanSnapshotRef.current, docMeta)));
    setIsDirty(false);
    setShareEmail('');
    setSelectedShareRecipients([]);
    setShareNotice(`Shared with ${recipientEmails.length === 1 ? recipientEmails[0] : `${recipientEmails.length} people`}.`);
    setIsSharing(false);
  };

  const handleDownloadPDF = async () => {
    const pages = exportPreviewImage ? await capturePreviewPages() : await captureReportPages();
    const fallbackPages = pages.length ? pages : await captureReportPages();
    if (!fallbackPages.length || fallbackPages.length < totalVisiblePageCount) {
      alert('Export could not be generated. Please try again after the charts finish rendering.');
      return;
    }
    downloadPdfFromPages(fallbackPages);
    setExportPreviewImage('');
    setExportPreviewPages([]);
    exportPageCountRef.current = DEFAULT_PAGE_COUNT;
  };

  const handleSaveLayout = () => runSaveTask(async () => {
    if (isReadOnlyReport) {
      alert('You have viewer access for this report. Ask the owner for editor access to save changes.');
      return null;
    }
    setIsSaving(true);
    setIsSaved(false);
    clearTimeout(savedIndicatorTimerRef.current);
    try {
      const committedElements = commitTextDrafts();
      const savedRevision = editRevisionRef.current;
      if (reportRef.current) {
        await requireReportReady(reportRef.current);
        await waitForNextPaint();
      }
      const { data: userResult, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      const currentUser = userResult?.user;
      if (!currentUser?.id) throw new Error('Sign in again before saving this report.');
      const nextReportSettings = {
        ...reportSettings,
        metricDefinitions: reportSettings.metricDefinitions || REPORT_METRICS[STUDIO_PRODUCT],
        metricDefinitionVersion: reportSettings.metricDefinitionVersion || 1,
        lastSavedBy: currentUser.email || currentUser.id,
        lastSavedAt: new Date().toISOString(),
      };
      const savedState = getSavedReportState({
        mode: type, elements: committedElements.map(element => {
          const latest = latestElementsRef.current.find(candidate => candidate.id === element.id);
          return latest ? { ...element, snapshotData: latest.snapshotData, snapshotKey: latest.snapshotKey,
            ...(latest.dataEvidence ? { dataEvidence: latest.dataEvidence } : {}) } : element;
        }), pageCount: visiblePageCount,
        selections, comparisonSelections, reportSettings: nextReportSettings,
      });
      const payload = {
        title: docMeta.title, author: docMeta.author, period: docMeta.period,
        date: docMeta.date, layout_data: savedState,
      };
      const savedReportId = await saveReportRecord(supabase, { reportId, payload, user: currentUser });
      if (!mountedRef.current) return savedReportId;
      lastSavedRevisionRef.current = savedRevision;
      if (!reportId) {
        // This document is already in memory. Reloading it would erase edits made while saving.
        createdReportIdRef.current = savedReportId;
        setReportId(savedReportId);
        pendingSavedUrlRef.current = savedReportId;
      }
      setReportSettings((current) => ({ ...current,
        lastSavedBy: nextReportSettings.lastSavedBy, lastSavedAt: nextReportSettings.lastSavedAt,
      }));
      lastCleanSnapshotRef.current = JSON.stringify(getComparableReportState(savedState, docMeta));
      const newerEdits = editRevisionRef.current !== savedRevision;
      setIsSaved(!newerEdits);
      setIsDirty(newerEdits);
      if (!newerEdits) savedIndicatorTimerRef.current = setTimeout(() => setIsSaved(false), 3000);
      return savedReportId;
    } catch (error) {
      console.error('Failed to save report:', error.message);
      if (mountedRef.current) alert(error.message === 'Charts are still loading. Try again once they finish.'
        ? error.message : 'Couldn’t save the report. Please try again.');
      return false;
    } finally {
      if (mountedRef.current) setIsSaving(false);
    }
  });

  const handleExitRequest = () => navigate(insightsLandingPath);

  const isNavigationBlocked = navigationBlocker.state === 'blocked';
  const navigationDialog = isNavigationBlocked ? {
    title: 'Unsaved report changes',
    message: 'Save this report before leaving Insights Studio?',
    actions: [
      { value: 'cancel', label: 'Keep editing', variant: 'secondary' },
      { value: 'discard', label: 'Leave without saving', variant: 'danger' },
      { value: 'save', label: 'Save and leave', variant: 'primary' },
    ],
  } : null;

  const resolveNavigation = async (action) => {
    if (isSavingAndLeaving) return;
    if (action === 'save') {
      setIsSavingAndLeaving(true);
      try {
        const savedId = await handleSaveLayout();
        if (!mountedRef.current) return;
        const blocker = navigationBlockerRef.current;
        if (savedId && editRevisionRef.current === lastSavedRevisionRef.current) {
          pendingSavedUrlRef.current = null;
          if (blocker?.state === 'blocked') blocker.proceed();
        } else if (blocker?.state === 'blocked') {
          blocker.reset();
        }
      } finally {
        if (mountedRef.current) setIsSavingAndLeaving(false);
      }
    } else if (action === 'discard') {
      // Let an already-started write settle before switching to another report.
      // Otherwise its completion could overwrite the next report's editor state.
      if (isSaving) {
        setIsSavingAndLeaving(true);
        await handleSaveLayout();
        if (!mountedRef.current) return;
        setIsSavingAndLeaving(false);
      }
      pendingSavedUrlRef.current = null;
      const blocker = navigationBlockerRef.current;
      if (blocker?.state === 'blocked') blocker.proceed();
    } else {
      navigationBlocker.reset();
    }
  };

  useEffect(() => {
    if (isReadOnlyReport) return undefined;

    const handleBeforeUnload = (event) => {
      if (!hasLoadedReportRef.current || !hasActualUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasActualUnsavedChanges, isDirty, isReadOnlyReport]);

  useEffect(() => {
    const handleKeyboardDelete = (event) => {
      if (isReadOnlyReport || isSavingAndLeaving || isNavigationBlocked) return;
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
  }, [confirmDialog, copySelectedElement, deleteSelected, isReadOnlyReport, isSavingAndLeaving, isNavigationBlocked, pasteCopiedElement, redoLastChange, selectedElementId, undoLastChange]);

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

  // Setting `selections`/`comparisonSelections` here is enough on its own — every
  // chart/summary created by createTemplateElements has no `selections` field of its
  // own, so getElementPrimarySelections/getElementComparisonSelections fall back to
  // these report-level values for every element at once.
  const renderTargetPromptModal = () => {
    if (!showTargetPrompt || typeof document === 'undefined') return null;

    return createPortal((
      <div className={styles.modalOverlay} role="presentation">
        <div className={styles.confirmDialog} role="dialog" aria-modal="true" aria-labelledby="insights-target-prompt-title" onMouseDown={(event) => event.stopPropagation()} style={{ width: 'min(460px, 100%)', maxHeight: '85vh', overflowY: 'auto' }}>
          <h2 id="insights-target-prompt-title">What would you like to analyze?</h2>
          <p>Pick the institute and corridor this report's charts should start with. You can still change any chart individually later.</p>

          {renderTargetControls({
            title: isComparison ? 'Primary data source' : 'Data source',
            targetSelections: selections,
            targetFloors: getFloorsForSelections(selections),
            onChange: setSelections,
          })}

          {isComparison && renderTargetControls({
            title: 'Compare against',
            targetSelections: comparisonSelections,
            targetFloors: getFloorsForSelections(comparisonSelections),
            onChange: setComparisonSelections,
          })}

          <div className={styles.confirmActions}>
            <button type="button" className={styles.secondaryBtn} onClick={() => setShowTargetPrompt(false)}>
              I'll set this up later
            </button>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => setShowTargetPrompt(false)}
              // Comparison charts render "Select at least two data sources to compare"
              // until both sides are set, so confirming with only the primary target
              // filled in would leave every comparison chart/summary in that same
              // placeholder state — defeating the point of setting them all up at once.
              disabled={!hasSelectionValue(selections) || (isComparison && !hasSelectionValue(comparisonSelections))}
            >
              Use this target
            </button>
          </div>
        </div>
      </div>
    ), document.body);
  };

  const renderElementContent = (el) => {
    if (isViewingVersion && ['chart', 'summary'].includes(el.type) && !el.snapshotData) return <p>No data was saved for this module in this version.</p>;

    const elementPrimarySelections = getElementPrimarySelections(el);
    const elementComparisonSelections = getElementComparisonSelections(el);
    const elementPrimaryTarget = getTargetFromSelections(elementPrimarySelections, '');
    const elementSecondaryTarget = getTargetFromSelections(elementComparisonSelections, '');
    const elementComparisonTargets = isComparison ? getElementComparisonTargets(el) : [elementPrimaryTarget, elementSecondaryTarget];
    const elementHasSoloTarget = Boolean(elementPrimaryTarget.id);
    const elementHasComparisonTargets = elementComparisonTargets.filter((target) => target.id).length >= 2;
    const elementFilters = getElementFilters(el);
    const elementTimeframe = getElementTimeframe(el);
    const elementSnapshotKey = getSnapshotKey({
      mode: type,
      target: elementPrimaryTarget,
      secondaryTarget: elementSecondaryTarget,
      targets: isComparison ? elementComparisonTargets : undefined,
      filters: elementFilters,
      timeframe: elementTimeframe,
    });

    if (el.type === 'text') {
      const isEditing = editingTextId === el.id;
      const savedTextHtml = getTextHtml(el);
      const textHtml = sanitizeReportHtml(textDraftsRef.current[el.id] ?? savedTextHtml);

      return (
        <div
          data-text-element-id={el.id}
          contentEditable={isEditing && !isDownloading && !isReadOnlyReport}
          suppressContentEditableWarning
          onFocus={() => {
            if (!isReadOnlyReport) setSelectedElementId(el.id);
          }}
          onPaste={(event) => {
            if (isReadOnlyReport) return;
            const html = event.clipboardData?.getData('text/html');
            if (!html) return;
            event.preventDefault();
            document.execCommand('insertHTML', false, sanitizeReportHtml(html));
          }}
          onInput={(event) => {
            if (isReadOnlyReport) return;
            const nextHtml = sanitizeReportHtml(event.currentTarget.innerHTML);
            textDraftsRef.current[el.id] = nextHtml;
            markDirty();
          }}
          onBlur={(event) => {
            if (isReadOnlyReport) return;
            const nextHtml = sanitizeReportHtml(event.currentTarget.innerHTML);
            textDraftsRef.current[el.id] = nextHtml;
            if (event.relatedTarget?.closest?.('[data-insights-editor-sidebar="true"]')) {
              markDirty();
              return;
            }
            if (nextHtml !== savedTextHtml) updateElement(el.id, { html: nextHtml, content: stripHtml(nextHtml) });
            setEditingTextId(null);
          }}
          onMouseUp={() => {
            if (!isReadOnlyReport) saveTextSelection(el.id);
          }}
          onKeyUp={() => {
            if (!isReadOnlyReport) saveTextSelection(el.id);
          }}
          onMouseDown={(event) => {
            if (isReadOnlyReport || isEditing) event.stopPropagation();
          }}
          style={{ width: '100%', height: '100%', overflow: 'hidden', fontSize: getTextFontSize(el), fontFamily: el.style.fontFamily || FONT_FAMILY_OPTIONS[0].value, color: el.style.color || DEFAULT_TEXT_COLOR, fontWeight: el.style.fontWeight, textAlign: el.style.textAlign, outline: 'none', whiteSpace: 'pre-wrap', cursor: isReadOnlyReport ? 'default' : isEditing ? 'text' : 'move', lineHeight: 1.18 }}
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
    if (isComparison && !elementHasComparisonTargets) return (
      <div className={styles.moduleEmptyState}>
        <strong>Select comparison corridors</strong>
        <span>Choose at least two corridors, zones, or sensor groups in the sidebar.</span>
      </div>
    );
    if (!isComparison && !elementHasSoloTarget) return (
      <div className={styles.moduleEmptyState}>
        <strong>Select a corridor</strong>
        <span>Choose a corridor, zone, or sensor group in the sidebar to populate this module.</span>
      </div>
    );

    if (el.type === 'summary' && isComparison) return <div style={{ width: '100%', height: '100%' }}><ComparisonSummaryMetrics targets={elementComparisonTargets} filters={elementFilters} timeframe={elementTimeframe} metricMode={el.summaryMetric || 'totalVolume'} metricModes={el.summaryMetrics || DEFAULT_COMPARISON_SUMMARY_METRICS} snapshotData={isViewingVersion || el.snapshotKey === elementSnapshotKey ? el.snapshotData : undefined} onSnapshotData={(data, evidence) => updateElementSnapshot(el.id, elementSnapshotKey, data, evidence)} /></div>;
    if (el.type === 'summary') {
      const attachedChart = getAttachedChart(el);
      const attachedChartSnapshotKey = attachedChart ? getSnapshotKey({
        mode: type,
        target: getTargetFromSelections(getElementPrimarySelections(attachedChart), ''),
        secondaryTarget: getTargetFromSelections(getElementComparisonSelections(attachedChart), ''),
        filters: getElementFilters(attachedChart),
        timeframe: getElementTimeframe(attachedChart),
      }) : '';
      const attachedChartData = attachedChart?.snapshotKey === attachedChartSnapshotKey ? attachedChart.snapshotData : undefined;
      return <div style={{ width: '100%', height: '100%' }}><SummaryMetrics level={elementPrimaryTarget.level} id={elementPrimaryTarget.id} filters={elementFilters} timeframe={elementTimeframe} metrics={getSummaryMetricsForTimeframe(el.summaryMetrics, elementTimeframe)} snapshotData={isViewingVersion || el.snapshotKey === elementSnapshotKey ? el.snapshotData : undefined} sourceChartData={attachedChartData} preferSourceChartData={Boolean(attachedChart)} onSnapshotData={(data, evidence) => updateElementSnapshot(el.id, elementSnapshotKey, data, evidence)} /></div>;
    }
    if (el.type === 'chart' && isComparison) return (
      <ChartFrame title={getChartDisplayName(el)}>
        <ComparisonAggregateChart targets={elementComparisonTargets} filters={elementFilters} type={elementTimeframe} plotType={el.chartType || 'line'} snapshotData={isViewingVersion || el.snapshotKey === elementSnapshotKey ? el.snapshotData : undefined} onSnapshotData={(data, evidence) => updateElementSnapshot(el.id, elementSnapshotKey, data, evidence)} seriesColors={el.seriesColors || []} peopleSeriesColors={el.peopleSeriesColors || []} thresholdEnabled={Boolean(el.thresholdEnabled)} thresholdValue={el.thresholdValue} thresholdLabel={el.thresholdLabel || 'Threshold'} thresholdColor={el.thresholdColor || '#ef4444'} showLegend={el.showLegend ?? true} legendItems={el.legendItems} customMetrics={el.customMetrics} frameless />
      </ChartFrame>
    );
    if (el.type === 'chart') return (
      <ChartFrame title={getChartDisplayName(el)}>
        <AggregateChart level={elementPrimaryTarget.level} id={elementPrimaryTarget.id} sensorIds={elementPrimaryTarget.sensorIds || []} filters={elementFilters} type={elementTimeframe} plotType={el.chartType || 'combo'} snapshotData={isViewingVersion || el.snapshotKey === elementSnapshotKey ? el.snapshotData : undefined} onSnapshotData={(data, evidence) => updateElementSnapshot(el.id, elementSnapshotKey, data, evidence)} highlightMode={el.highlightPeak ? 'peak' : 'none'} highlightLabel={el.highlightLabel || 'Peak'} occupancyColor={el.occupancyColor || CHART_COLORS.accent} peopleColor={el.peopleColor || CHART_COLORS.primary} highlightColor={el.highlightColor || CHART_COLORS.rust} thresholdEnabled={Boolean(el.thresholdEnabled)} thresholdValue={el.thresholdValue} thresholdLabel={el.thresholdLabel || 'Threshold'} thresholdColor={el.thresholdColor || '#ef4444'} showLegend={el.showLegend ?? ['combo', 'custom'].includes(el.chartType || 'combo')} legendItems={el.legendItems} customMetrics={el.customMetrics} frameless />
      </ChartFrame>
    );
    if (el.type === 'table') return <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', opacity: 0.6 }}>[ Customizable Data Table ]</div>;
    return null;
  };

  const renderStandardPreviewPage = (pageIndex) => {
    const pageTop = pageIndex * PAGE_HEIGHT;
    const pageBottom = pageTop + PAGE_HEIGHT;
    const headerTop = reportContentOffset + 48;
    const visibleElements = elements.filter((el) => {
      const elementTop = el.y + reportContentOffset;
      const elementBottom = elementTop + el.height;
      return elementBottom > pageTop && elementTop < pageBottom;
    });

    return (
      <div className={styles.exportPreviewLivePage} data-export-capture-page={pageIndex}>
        <div
          className={styles.exportPreviewLiveReport}
          style={{ height: `${PAGE_HEIGHT}px`, top: 0 }}
        >
          {hasCoverPage && pageIndex === 0 && (
            <section
              className={`${styles.coverPage} ${styles[`coverPage${String(reportSettings.coverLayout || 'classic').charAt(0).toUpperCase()}${String(reportSettings.coverLayout || 'classic').slice(1)}`] || ''}`}
              style={{
                '--cover-accent': getColorInputValue(reportSettings.coverAccentColor, '#34524D'),
                '--cover-bg': getColorInputValue(reportSettings.coverBackground, '#fbfcfb'),
                position: 'absolute',
                inset: 0,
                width: `${PAGE_WIDTH}px`,
                height: `${PAGE_HEIGHT}px`,
                background: getCoverExportBackground(reportSettings),
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
                  left: '72px',
                  bottom: '72px',
                  width: '704px',
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

          {hasDocumentHeader && headerTop >= pageTop && headerTop < pageBottom && (
            <div className={styles.documentHeader} style={{ position: 'absolute', top: `${headerTop - pageTop}px`, left: '48px', right: '48px', width: `${DEFAULT_REPORT_WIDTH}px` }}>
              <h1 className={styles.documentTitle}>{docMeta.title}</h1>
              <div className={styles.documentMetaGrid}>
                <div className={styles.metaItem}><span className={styles.metaLabel}>Author</span><span className={styles.metaValue}>{docMeta.author}</span></div>
                <div className={styles.metaItem}><span className={styles.metaLabel}>Date Created</span><span className={styles.metaValue}>{docMeta.date}</span></div>
                <div className={styles.metaItem}><span className={styles.metaLabel}>Timeframe</span><span className={styles.metaValue}>{reportSettings.timeframe === 'daily' ? '24hr' : reportSettings.timeframe === 'weekly' ? 'Weekly' : reportSettings.timeframe === 'monthly' ? 'Monthly' : 'Custom'}</span></div>
              </div>
            </div>
          )}

          {visibleElements.map((el) => {
            const currentBg = el.style.background || DEFAULT_CARD_BACKGROUND;
            const localY = el.y + reportContentOffset - pageTop;

            return (
              <div
                key={el.id}
                style={{
                  position: 'absolute',
                  left: `${el.x}px`,
                  top: `${localY}px`,
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

          {reportSettings.showFooter && (
            <footer className={styles.reportFooter} style={{ top: `${PAGE_HEIGHT - 56}px` }}>
              <span>CheckIt</span>
              <span>{docMeta.title}</span>
              <span>Page {pageIndex + 1}</span>
            </footer>
          )}
        </div>
      </div>
    );
  };

  if (reportLoadError || profileRoleError) {
    return (
      <main className={styles.builderPage} data-theme="light">
        <div className={styles.builderAccessLoading} role="alert">
          <p>{reportLoadError || profileRoleError}</p>
          <div className={styles.builderErrorActions}>
            <button type="button" className={styles.primaryBtn} onClick={() => setReportReloadVersion((version) => version + 1)}>Try again</button>
            <button type="button" className={styles.toolbarBtn} onClick={() => navigate(insightsLandingPath)}>Back to reports</button>
          </div>
        </div>
      </main>
    );
  }

  if (isReportAccessPending) {
    return (
      <main className={styles.builderPage} data-theme="light">
        <div className={styles.builderAccessLoading} role="status" aria-live="polite">
          <span className={styles.builderAccessSpinner} aria-hidden="true" />
          <p>Loading report...</p>
        </div>
      </main>
    );
  }

  // Ensure app stays strictly in light mode
  return (
    <main className={styles.builderPage} data-theme="light">
      
      {/* TOP NAVBAR */}
      <header className={styles.builderTopNav}>
        <div className={`${styles.navGroup} ${styles.builderIdentity}`}>
          <ToolbarIconButton label="Back to reports" tooltipAlign="start" onClick={handleExitRequest} disabled={isSaving || isSharing}><ArrowLeft size={18} aria-hidden="true" /></ToolbarIconButton>
          <span className={styles.navTitle} title={`${title} Builder`}>{title} Builder</span>
          <span className={styles.collaborationPill} title={isReadOnlyReport ? 'View only' : !reportId ? 'Save the report to collaborate' : collaborators.map((user) => user.email || user.name).join(', ')}>
            {isReadOnlyReport ? 'View only' : reportId ? `${collaborators.length + 1} editing` : 'Draft'}
          </span>
        </div>
        
        {canUseBuilderTools && <div className={`${styles.navGroup} ${styles.toolbarGroup}`}>
          <ToolbarIconButton label="Add text" onClick={() => addNewElement('text')}><Type size={18} aria-hidden="true" /></ToolbarIconButton>
          <ToolbarIconButton label="Add chart" onClick={() => addNewElement('chart')}><BarChart2 size={18} aria-hidden="true" /></ToolbarIconButton>
          <div className={styles.toolbarBtnGroup} ref={summaryCardsMenuRef}>
            <ToolbarIconButton label="Add summary card" aria-expanded={isSummaryCardsMenuOpen}
              aria-controls="insights-summary-menu" onClick={() => setIsSummaryCardsMenuOpen((isOpen) => !isOpen)}>
              <Layers size={18} aria-hidden="true" />
            </ToolbarIconButton>
            {isSummaryCardsMenuOpen && (
              <div id="insights-summary-menu" className={styles.toolbarDropdownMenu}>
                {(isComparison ? COMPARISON_SUMMARY_MODES : SUMMARY_METRIC_OPTIONS).map((metric) => (
                  <button
                    key={metric.value}
                    type="button"
                    className={styles.toolbarDropdownItem}
                    onClick={() => { addSummaryMetricCard(metric.value); setIsSummaryCardsMenuOpen(false); }}
                  >
                    <Layers size={14} /> {metric.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <ToolbarIconButton label="Insert file" onClick={() => uploadInputRef.current?.click()}><ImagePlus size={18} aria-hidden="true" /></ToolbarIconButton>
          <ToolbarIconButton label="Add link" onClick={addLinkElement}><Link2 size={18} aria-hidden="true" /></ToolbarIconButton>
          <ToolbarIconButton label="Add divider" onClick={() => addNewElement('divider')}><MinusSquare size={18} aria-hidden="true" /></ToolbarIconButton>
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
        </div>}

        <div className={`${styles.navGroup} ${styles.reportActions}`}>
          <ToolbarIconButton label="Report details" aria-haspopup="dialog" onClick={() => {
            setWorkspaceInitialTab('overview'); setIsWorkspaceOpen(true);
          }}><PanelRightOpen size={18} aria-hidden="true" /></ToolbarIconButton>
          <ToolbarIconButton label="Comments" aria-haspopup="dialog" onClick={() => {
            setWorkspaceInitialTab('discussion'); setIsWorkspaceOpen(true);
          }}><MessageSquare size={18} aria-hidden="true" /></ToolbarIconButton>
          {isViewingVersion && <ToolbarIconButton label="Return to draft" onClick={() => setSearchParams(current => {
            const next = new URLSearchParams(current); next.delete('version'); return next;
          })}><Undo2 size={18} aria-hidden="true" /></ToolbarIconButton>}
          <ToolbarIconButton label="Preview export" onClick={handleExportPreview} disabled={isDownloading}>
            <Download size={18} aria-hidden="true" />
          </ToolbarIconButton>
          {canUseBuilderTools && reportAccessRole === 'owner' && (
            <ToolbarIconButton label="Share report" onClick={handleOpenShareDialog} disabled={isSaving || isSharing}>
              <Share2 size={18} aria-hidden="true" />
            </ToolbarIconButton>
          )}
          {canUseBuilderTools && <ToolbarIconButton label="Save report" tooltipAlign="end" primary
            tooltip={isSaving ? 'Saving…' : isSaved ? 'Saved' : 'Save report'}
            aria-busy={isSaving} data-save-state={isSaving ? 'saving' : isSaved ? 'saved' : 'idle'}
            onClick={handleSaveLayout} disabled={isReadOnlyReport || isSaving || isSharing}>
            {isSaving ? <LoaderCircle size={18} aria-hidden="true" className={styles.saveSpinner} />
              : isSaved ? <Check size={18} aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}
          </ToolbarIconButton>}
          <span className={styles.screenReaderOnly} role="status" aria-live="polite">{isSaving ? 'Saving report' : isSaved ? 'Report saved' : ''}</span>
        </div>
      </header>

      <div className={`${styles.workspace} ${isReadOnlyReport ? styles.viewerWorkspace : ''}`}>
        
        {/* LEFT SIDEBAR */}
        {canUseBuilderTools && <div className={`${styles.sidebarPanel} ${styles.left}`}>
          <h3 className={styles.sidebarTitle}>Document Metadata</h3>
          
          <label className={styles.inputLabel}>Report Title</label>
          <input type="text" value={docMeta.title} onChange={(e) => updateDocMeta({ title: e.target.value })} className={styles.inputField} />
          
          <label className={styles.inputLabel}>Author / Department</label>
          <input type="text" value={docMeta.author} onChange={(e) => updateDocMeta({ author: e.target.value })} className={styles.inputField} />
          
          <label className={styles.inputLabel}>Date</label>
          <input type="text" value={docMeta.date} onChange={(e) => updateDocMeta({ date: e.target.value })} className={styles.inputField} />

          <h3 className={styles.sidebarTitle}>Default Data Source</h3>
          {renderTargetControls({
            title: isComparison ? 'Primary data source' : 'Data source',
            targetSelections: selections,
            targetFloors: getFloorsForSelections(selections),
            onChange: setSelections,
          })}
          {isComparison && renderTargetControls({
            title: 'Compare against',
            targetSelections: comparisonSelections,
            targetFloors: getFloorsForSelections(comparisonSelections),
            onChange: setComparisonSelections,
          })}

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
        </div>}

        {/* CENTER CANVAS */}
        <div ref={canvasRef} onMouseDown={(e) => { if(!isReadOnlyReport && e.target === e.currentTarget) { commitTextDrafts(); clearSelectedElement(); } }} className={styles.canvasArea}>
          {isReportLoading ? (
            <div className={styles.reportLoadingState}>Loading report...</div>
          ) : (
          <>
            <div
            ref={reportRef}
            className={styles.paperBoundary}
            onMouseDown={(e) => { if(!isReadOnlyReport && e.target === e.currentTarget) { commitTextDrafts(); clearSelectedElement(); } }}
            style={{ height: `${totalVisiblePageCount * PAGE_HEIGHT}px`, backgroundColor: '#ffffff' }}
          >
            
            {Array.from({ length: totalVisiblePageCount }).map((_, i) => (
                i > 0 && (
                    <div key={`page-break-${i}`} data-html2canvas-ignore="true" className={styles.pageBreakMarker} style={{ top: i * PAGE_HEIGHT }}>
                        <span className={styles.pageBreakLabel}>Page {i + 1}</span>
                    </div>
                )
            ))}

            {!isDownloading && canUseBuilderTools && (
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
                  if (isReadOnlyReport) return;
                  setSelectedElementId('cover');
                  setEditingTextId(null);
                }}
                style={{
                  '--cover-accent': getColorInputValue(reportSettings.coverAccentColor, '#34524D'),
                  '--cover-bg': getColorInputValue(reportSettings.coverBackground, '#fbfcfb'),
                }}
              >
                <Rnd
                  bounds="parent"
                  size={{ width: 704, height: 48 }}
                  position={{ x: reportSettings.coverEyebrowX ?? 72, y: reportSettings.coverEyebrowY ?? 88 }}
                  dragGrid={[GRID_SIZE, GRID_SIZE]}
                  enableResizing={false}
                  disableDragging={isReadOnlyReport}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    if (isReadOnlyReport) return;
                    setSelectedElementId('cover');
                  }}
                  onDragStop={(event, data) => updateReportSettings({ coverEyebrowX: data.x, coverEyebrowY: data.y })}
                >
                  <p
                    className={styles.coverEyebrow}
                    contentEditable={!isDownloading && !isReadOnlyReport}
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
                  disableDragging={isReadOnlyReport}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    if (isReadOnlyReport) return;
                    setSelectedElementId('cover');
                  }}
                  onDragStop={(event, data) => updateReportSettings({ coverTitleX: data.x, coverTitleY: data.y })}
                >
                  <h1
                    contentEditable={!isDownloading && !isReadOnlyReport}
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
                  disableDragging={isReadOnlyReport}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    if (isReadOnlyReport) return;
                    setSelectedElementId('cover');
                  }}
                  onDragStop={(event, data) => updateReportSettings({ coverSubtitleX: data.x, coverSubtitleY: data.y })}
                >
                  <p
                    contentEditable={!isDownloading && !isReadOnlyReport}
                    suppressContentEditableWarning
                    onMouseDown={(event) => event.stopPropagation()}
                    onBlur={(event) => updateReportSettings({ coverSubtitle: event.currentTarget.innerText })}
                    style={{ fontSize: reportSettings.coverSubtitleFontSize, fontFamily: reportSettings.coverFontFamily }}
                  >
                    {reportSettings.coverSubtitle || 'Add a short report subtitle'}
                  </p>
                </Rnd>
                <div
                  className={styles.coverMeta}
                  style={{
                    position: 'absolute',
                    left: '72px',
                    bottom: '72px',
                    width: '704px',
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
              <div className={styles.documentHeader} onMouseDown={() => { commitTextDrafts(); clearSelectedElement(); }} style={{ position: 'absolute', top: `${reportContentOffset + 48}px`, left: '48px', right: '48px', width: `${DEFAULT_REPORT_WIDTH}px` }}>
                <h1 className={styles.documentTitle}>{docMeta.title}</h1>
                <div className={styles.documentMetaGrid}>
                    <div className={styles.metaItem}><span className={styles.metaLabel}>Author</span><span className={styles.metaValue}>{docMeta.author}</span></div>
                    <div className={styles.metaItem}><span className={styles.metaLabel}>Date Created</span><span className={styles.metaValue}>{docMeta.date}</span></div>
                    <div className={styles.metaItem}><span className={styles.metaLabel}>Timeframe</span><span className={styles.metaValue}>{reportSettings.timeframe === 'daily' ? '24hr' : reportSettings.timeframe === 'weekly' ? 'Weekly' : reportSettings.timeframe === 'monthly' ? 'Monthly' : 'Custom'}</span></div>
                </div>
              </div>
            )}
            
            {elements.map((el) => {
              const isSelected = !isDownloading && !isReadOnlyReport && selectedElementId === el.id;
              const lockedBy = remoteLocks[el.id];
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
                    if (isReadOnlyReport) return;
                    if (lockedBy) return;
                    if (editingTextId && editingTextId !== el.id) commitTextDrafts();
                    selectElement(el.id);
                    if (editingTextId && editingTextId !== el.id) setEditingTextId(null);
                    if (el.type === 'text' && selectedElementId === el.id) {
                      setEditingTextId(el.id);
                      setTimeout(() => {
                        document.querySelector(`[data-text-element-id="${el.id}"]`)?.focus?.();
                      }, 0);
                    }
                  }}
                  onDoubleClick={(event) => {
                    if (isReadOnlyReport) return;
                    if (lockedBy) return;
                    selectElement(el.id);
                    if (el.type === 'text') {
                      setEditingTextId(el.id);
                      setTimeout(() => event.target?.focus?.(), 0);
                    }
                  }}
                  style={{ zIndex: isSelected ? (el.zIndex || 1) + 1000 : (el.zIndex || 1) }}
                  disableDragging={isReadOnlyReport || editingTextId === el.id || Boolean(lockedBy)}
                  enableResizing={!isReadOnlyReport && isSelected && !lockedBy} 
                  resizeHandleStyles={{
                    bottomRight: { width: '12px', height: '12px', background: '#3b82f6', border: '2px solid #fff', right: '-6px', bottom: '-6px', borderRadius: '50%', zIndex: 50 },
                    bottomLeft: { width: '12px', height: '12px', background: '#3b82f6', border: '2px solid #fff', left: '-6px', bottom: '-6px', borderRadius: '50%', zIndex: 50 },
                    topRight: { width: '12px', height: '12px', background: '#3b82f6', border: '2px solid #fff', right: '-6px', top: '-6px', borderRadius: '50%', zIndex: 50 },
                    topLeft: { width: '12px', height: '12px', background: '#3b82f6', border: '2px solid #fff', left: '-6px', top: '-6px', borderRadius: '50%', zIndex: 50 },
                  }}
                >
                  <div className={`${styles.widgetBox} ${el.type === 'chart' ? styles.chartWidgetBox : ''} ${isSelected ? styles.widgetBoxSelected : ''} ${lockedBy ? styles.widgetBoxLocked : ''}`} style={{
                      backgroundColor: ['divider', 'chart', 'summary'].includes(el.type) ? 'transparent' : currentBg,
                      borderRadius: el.style.borderRadius, 
                      pointerEvents: isReadOnlyReport ? 'none' : isSelected || ['text', 'image', 'attachment', 'link'].includes(el.type) ? 'auto' : 'none', 
                      padding: ['divider', 'image', 'chart', 'summary'].includes(el.type) ? '0' : '16px',
                      boxSizing: 'border-box',
                      border: ['text', 'divider', 'image', 'chart', 'summary'].includes(el.type) ? 'none' : undefined,
                      boxShadow: ['text', 'divider', 'image', 'chart', 'summary'].includes(el.type) ? 'none' : undefined
                  }}>
                     {lockedBy && <div className={styles.widgetLockBadge}>{lockedBy.userName || 'Teammate'} editing</div>}
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

          {!isDownloading && canUseBuilderTools && pageCount > DEFAULT_PAGE_COUNT && (
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

          {!isDownloading && canUseBuilderTools && pageCount === DEFAULT_PAGE_COUNT && (
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
        {canUseBuilderTools && <div className={`${styles.sidebarPanel} ${styles.right}`} data-insights-editor-sidebar="true">
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
                    <input type="color" value={getColorInputValue(reportSettings.coverAccentColor, '#34524D')} onChange={(e) => updateReportSettings({ coverAccentColor: e.target.value })} className={styles.colorPicker} />
                  </div>
                  <div>
                    <label className={styles.inputLabel}>Background</label>
                    <input type="color" value={getColorInputValue(reportSettings.coverBackground, '#fbfcfb')} onChange={(e) => updateReportSettings({ coverBackground: e.target.value })} className={styles.colorPicker} />
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

                  <TimeframeOverrideControls
                    element={activeElement}
                    reportTimeframe={reportSettings.timeframe}
                    onToggle={(checked) => updateElement(activeElement.id, { useReportTimeframe: checked })}
                    onTimeframeChange={(value) => updateElementTimeframe(activeElement.id, value)}
                    onFieldChange={(field, value) => updateElement(activeElement.id, { [field]: value })}
                    onReset={() => resetElementCustomTimeframe(activeElement.id)}
                  />

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
                            <input type="color" value={getColorInputValue(activeElement.occupancyColor, CHART_COLORS.accent)} onChange={(e) => updateElement(activeElement.id, { occupancyColor: e.target.value })} className={styles.colorPicker} />
                          </div>
                          <div>
                            <label className={styles.inputLabel}>Traffic Bars</label>
                            <input type="color" value={getColorInputValue(activeElement.peopleColor, CHART_COLORS.primary)} onChange={(e) => updateElement(activeElement.id, { peopleColor: e.target.value })} className={styles.colorPicker} />
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
                                value={getColorInputValue(activeElement.seriesColors?.[index], CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length])}
                                onChange={(e) => updateElementArrayValue(activeElement.id, 'seriesColors', index, e.target.value)}
                                className={styles.colorPicker}
                              />
                            </div>
                            <div>
                              <label className={styles.inputLabel}>Traffic {index + 1}</label>
                              <input
                                type="color"
                                value={getColorInputValue(activeElement.peopleSeriesColors?.[index], CHART_PEOPLE_COLORS[index % CHART_PEOPLE_COLORS.length])}
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
                          <input type="color" value={getColorInputValue(activeElement.highlightColor, CHART_COLORS.rust)} onChange={(e) => updateElement(activeElement.id, { highlightColor: e.target.value })} className={styles.colorPicker} />
                        </>
                      )}
                    </>
                  )}
                  <button type="button" className={styles.secondaryBtnFull} onClick={() => addNewElement('summary')}>
                    <Layers size={14} /> Add linked summary
                  </button>
                  <button type="button" className={styles.secondaryBtnFull} onClick={autoFitActiveChartToPage}>
                    <Maximize2 size={14} /> Auto fit chart to page
                  </button>
                  <button type="button" className={styles.secondaryBtnFull} onClick={addAutoInsightForChart}>
                    <FileText size={14} /> Add auto insight
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
                      <TimeframeOverrideControls
                        element={activeElement}
                        reportTimeframe={reportSettings.timeframe}
                        onToggle={(checked) => updateElement(activeElement.id, { useReportTimeframe: checked })}
                        onTimeframeChange={(value) => updateElementTimeframe(activeElement.id, value)}
                        onFieldChange={(field, value) => updateElement(activeElement.id, { [field]: value })}
                        onReset={() => resetElementCustomTimeframe(activeElement.id)}
                      />
                    </>
                  )}

                  {activeElement.isIndividualMetricCard ? (
                    <>
                      <label className={styles.inputLabel}>Metric</label>
                      <select
                        className={styles.inputField}
                        value={activeElement.summaryMetrics?.[0] || SUMMARY_METRIC_OPTIONS[0].value}
                        onChange={(e) => updateElement(activeElement.id, { summaryMetrics: [e.target.value] })}
                      >
                        {SUMMARY_METRIC_OPTIONS.map((metric) => (
                          <option key={metric.value} value={metric.value}>{metric.label}</option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
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
                      <TimeframeOverrideControls
                        element={activeElement}
                        reportTimeframe={reportSettings.timeframe}
                        onToggle={(checked) => updateElement(activeElement.id, { useReportTimeframe: checked })}
                        onTimeframeChange={(value) => updateElementTimeframe(activeElement.id, value)}
                        onFieldChange={(field, value) => updateElement(activeElement.id, { [field]: value })}
                        onReset={() => resetElementCustomTimeframe(activeElement.id)}
                      />
                    </>
                  )}

                  {activeElement.isIndividualMetricCard ? (
                    <>
                      <label className={styles.inputLabel}>Metric</label>
                      <select
                        className={styles.inputField}
                        value={activeElement.summaryMetrics?.[0] || COMPARISON_SUMMARY_MODES[0].value}
                        onChange={(e) => updateElement(activeElement.id, { summaryMetrics: [e.target.value], summaryMetric: e.target.value })}
                      >
                        {COMPARISON_SUMMARY_MODES.map((mode) => (
                          <option key={mode.value} value={mode.value}>{mode.label}</option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
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
        </div>}

      </div>
      {isWorkspaceOpen && <ReportWorkspace initialTab={workspaceInitialTab} client={supabase} reportId={reportId} product={STUDIO_PRODUCT}
        elements={elements} decisionQuestion={reportSettings.decisionQuestion || ''} metricDefinitions={reportSettings.metricDefinitions} readOnly={reportAccessRole === 'viewer' || isReportAccessPending || isViewerProfile} documentReadOnly={isViewingVersion} currentVersionId={viewingVersionId}
        onDecisionChange={value => updateReportSettings({ decisionQuestion: value })}
        onClose={() => setIsWorkspaceOpen(false)}
        onSave={async () => {
          const savedId = await handleSaveLayout();
          if (savedId && editRevisionRef.current !== lastSavedRevisionRef.current) throw new Error('New edits arrived during saving. Save again before requesting review.');
          return savedId;
        }}
        onRefreshData={() => {
          pushUndoSnapshot();
          setElements(current => current.map(element => ({ ...element, snapshotData: undefined, snapshotKey: undefined, dataEvidence: undefined })));
          setReportSettings(current => ({ ...current, metricDefinitions: REPORT_METRICS[STUDIO_PRODUCT], metricDefinitionVersion: 1 }));
          markDirty(); setIsWorkspaceOpen(false);
        }}
        onOpenVersion={id => { setIsWorkspaceOpen(false); setSearchParams(current => {
          const next = new URLSearchParams(current); next.set('version', id); return next;
        }); }}
        onRestore={async versionId => {
          if (hasActualUnsavedChanges() && !window.confirm('Replace the unsaved working copy with this saved version?')) return;
          await runReportCommand(supabase, reportId, 'restore', { version_id: versionId });
          setIsWorkspaceOpen(false);
          setSearchParams(current => { const next = new URLSearchParams(current); next.delete('version'); return next; });
          setReportReloadVersion(value => value + 1);
        }} />}
      <SavingReportOverlay isOpen={isSavingAndLeaving} />
      <ConfirmDialog
        dialog={isSavingAndLeaving ? null : navigationDialog || confirmDialog}
        onClose={navigationDialog ? resolveNavigation : resolveConfirmation}
      />
      {renderTargetPromptModal()}
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
      <ShareReportModal
        isOpen={shareDialogOpen}
        email={shareEmail}
        error={shareError}
        notice={shareNotice}
        isSharing={isSharing}
        sharedWith={Array.isArray(reportSettings.sharedWith) ? reportSettings.sharedWith : []}
        sharedAccess={reportSettings.sharedAccess || {}}
        suggestions={filteredShareSuggestions}
        isLoadingSuggestions={isShareDirectoryLoading}
        selectedRecipients={selectedShareRecipients}
        onEmailChange={(value) => {
          setShareEmail(value);
          setShareError('');
          setShareNotice('');
        }}
        onSuggestionSelect={(suggestion) => {
          const email = String(suggestion?.email || '').trim().toLowerCase();
          if (!email) return;
          setSelectedShareRecipients((currentRecipients) => (
            currentRecipients.some((recipient) => recipient.email === email)
              ? currentRecipients
              : [...currentRecipients, { ...suggestion, email }]
          ));
          setShareEmail(removeActiveShareEmailToken(shareEmail));
          setShareError('');
          setShareNotice('');
        }}
        onRecipientRemove={(recipientEmail) => {
          const email = String(recipientEmail || '').trim().toLowerCase();
          setSelectedShareRecipients((currentRecipients) => currentRecipients.filter((recipient) => recipient.email !== email));
        }}
        onClose={() => {
          if (isSharing) return;
          setShareDialogOpen(false);
          setShareEmail('');
          setSelectedShareRecipients([]);
          setShareEmailDirectory([]);
          setShareError('');
          setShareNotice('');
        }}
        onShare={handleShareReport}
        onAccessChange={handleChangeSharedAccess}
        onRemoveAccess={handleRemoveSharedAccess}
      />
    </main>
  );
};

const InsightsStudio = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [reports, setReports] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentUserRole, setCurrentUserRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savedReportsError, setSavedReportsError] = useState('');
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [templatePickerMode, setTemplatePickerMode] = useState(null);
  const [activeReportTab, setActiveReportTab] = useState(() => (searchParams.get('tab') === 'shared' ? 'shared' : 'owned'));
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

  const isOwnedReport = (report) => {
    if (!currentUser) return false;
    if (report?.owner_id) return report.owner_id === currentUser.id;

    const currentEmail = currentUser.email?.toLowerCase();
    const isSharedWithCurrentUser = getReportSharedEmails(report)
      .map((email) => String(email).trim().toLowerCase())
      .includes(currentEmail);
    if (isSharedWithCurrentUser) return false;

    const lastSavedBy = getReportLastSavedBy(report).toLowerCase();
    return Boolean(currentEmail && lastSavedBy && currentEmail === lastSavedBy);
  };
  const isSharedWithCurrentUser = (report) => {
    const currentEmail = currentUser?.email?.toLowerCase();
    if (!currentEmail || isOwnedReport(report)) return false;

    return getReportSharedEmails(report)
      .map((email) => String(email).trim().toLowerCase())
      .includes(currentEmail);
  };
  const ownReports = reports.filter((report) => isOwnedReport(report));
  const sharedReports = reports.filter((report) => isSharedWithCurrentUser(report));
  const isViewerRole = currentUserRole === 'viewer';
  const visibleReportTab = isViewerRole ? 'shared' : activeReportTab;
  const activeReports = visibleReportTab === 'owned' ? ownReports : sharedReports;
  const builderReturnQuery = visibleReportTab === 'shared' ? '&fromTab=shared' : '';

  const updateActiveReportTab = (tab) => {
    if (isViewerRole && tab !== 'shared') return;
    setActiveReportTab(tab);
    setSearchParams(tab === 'shared' ? { tab: 'shared' } : {}, { replace: true });
  };

  const handleDeleteReport = async (report) => {
    if (!isOwnedReport(report)) {
      alert('Only the owner can delete this report.');
      return;
    }

    const confirmDelete = await requestConfirmation({
      title: 'Delete saved report?',
      message: 'This report, its saved versions, comments, and follow-up actions will be permanently removed.',
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
        .eq('id', report.id);

      if (error) throw error;
      setReports((currentReports) => currentReports.filter((savedReport) => savedReport.id !== report.id));
    } catch (err) {
      console.error('Failed to delete report:', err.message);
      alert('Failed to delete report. Please try again.');
    }
  };

  useEffect(() => {
    const nextTab = searchParams.get('tab') === 'shared' ? 'shared' : 'owned';
    setActiveReportTab(isViewerRole ? 'shared' : nextTab);
  }, [isViewerRole, searchParams]);

  useEffect(() => {
    if (isViewerRole && searchParams.get('tab') !== 'shared') {
      setSearchParams({ tab: 'shared' }, { replace: true });
    }
  }, [isViewerRole, searchParams, setSearchParams]);

  useEffect(() => {
    const fetchSavedReports = async () => {
      try {
        if (!supabase) {
          setSavedReportsError('Saved reports are not available in this environment.');
          setReports([]);
          return;
        }

        const { data: userResult } = await supabase.auth.getUser();
        setCurrentUser(userResult?.user || null);
        if (userResult?.user?.id) {
          const { data: profile, error: roleError } = await supabase
            .from('profile')
            .select('role')
            .eq('id', userResult.user.id)
            .maybeSingle();
          if (roleError) throw roleError;
          setCurrentUserRole(normalizeStudioRole(profile?.role));
        } else {
          setCurrentUserRole('viewer');
        }

        const { data, error } = await supabase
          .from('saved_reports') 
          .select('*')
          .order('created_at', { ascending: false });

        if (error) {
          console.warn('Saved reports cache warning:', error.message);
          setSavedReportsError(error.message);
          setReports([]); 
          return;
        }
        
        let reportRows = data || [];
        if (reportRows.length) {
          const { data: workflows } = await supabase.from('insight_report_workflows')
            .select('report_id,status,published_version_id').in('report_id', reportRows.map(report => report.id));
          const byId = new Map((workflows || []).map(workflow => [workflow.report_id, workflow]));
          reportRows = reportRows.map(report => ({ ...report, workflow: byId.get(report.id) }));
        }
        setSavedReportsError('');
        setReports(sortReportsByLastSaved(reportRows));
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

  const renderReportsTable = (reportList, emptyTitle, emptyCopy) => {
    if (reportList.length === 0) {
      return (
        <div className={styles.emptyReportGroup}>
          <FileText size={28} />
          <p>{emptyTitle}</p>
          <span>{emptyCopy}</span>
        </div>
      );
    }

    return (
      <div className={styles.savedReportsTable}>
        <div className={`${styles.savedReportsGrid} ${styles.savedReportsHeader}`}>
          <div>Document Name</div>
          <div>Last Saved</div>
          <div>Generated Date</div>
          <div>Action</div>
        </div>
        
        {reportList.map((report) => {
          const owned = isOwnedReport(report);
          const sharedEmails = getReportSharedEmails(report);

          return (
            <div key={report.id} className={`${styles.savedReportsGrid} ${styles.savedReportsRow}`}>
              <div className={styles.savedReportNameCell}>
                <div
                  className={styles.savedReportIcon}
                  title={sharedEmails.length ? `Shared with ${sharedEmails.join(', ')}` : 'Only you'}
                  aria-label={sharedEmails.length ? 'Shared report' : 'Private report'}
                >
                  {sharedEmails.length ? <Users size={18} /> : <User size={18} />}
                </div>
                <div className={styles.savedReportTitleBlock}>
                  <div className={styles.savedReportTitle}>{report.title || 'Untitled report'}</div>
                  {report.workflow && <small className={styles.reportStatus}>{({ draft: 'Draft', in_review: 'In review', reviewed: 'Reviewed', published: 'Published' })[report.workflow.status] || 'Draft'}{report.workflow.published_version_id && report.workflow.status !== 'published' ? ' · Published version available' : ''}</small>}
                  <div className={styles.reportAuthor}>{report.author ? `By ${report.author}` : 'Author not specified'}</div>
                </div>
              </div>
              
              <div className={styles.savedReportPeriodCell}>{formatReportDateTime(getReportLastSavedDate(report))}</div>
              
              <div className={styles.savedReportDateCell}>
                <Calendar size={14} />
                {formatReportDate(report.created_at || report.date)}
              </div>
              
              <div className={styles.savedReportActions}>
                <Link to={`/insights-studio/${getReportMode(report)}?id=${report.id}${builderReturnQuery}`} className={styles.openReportButton}>
                  Open report <ArrowRight size={14} aria-hidden="true" />
                </Link>

                {owned && (
                  <button type="button" className={styles.deleteReportButton}
                    onClick={() => handleDeleteReport(report)} aria-label={`Delete ${report.title || 'report'}`} title="Delete report">
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <main className={styles.page}>
      <section className={styles.content}>
        
        {/* HERO SECTION */}
        <header className={styles.hero}>
          <h1>Insights Studio</h1>
          <p>Turn activity data into clear, presentation-ready insights.</p>
        </header>

        {/* INSIGHT CREATION CARDS */}
        {currentUserRole !== null && !isViewerRole && <section className={styles.cardGrid}>
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
        </section>}

        {currentUserRole !== null && !isViewerRole && templatePickerMode && (
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
                  <Link key={option.id} className={styles.templateChoiceCard} to={`/insights-studio/${templatePickerMode}?template=${option.id}${builderReturnQuery}`}>
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

        {/* Saved reports */}
        <section className={styles.templates}>
          <h2>Saved reports</h2>
          
          {isLoading ? (
            <div className={styles.reportsLoading} role="status">Loading reports…</div>
          ) : savedReportsError ? (
            <div className={styles.reportsError} role="alert">
              <FileText size={24} aria-hidden="true" />
              <p>Saved reports could not connect.</p>
              <span>{savedReportsError}</span>
            </div>
          ) : reports.length === 0 ? (
            <div className={styles.emptyReportGroup}>
              <FileText size={26} aria-hidden="true" />
              <p>No saved reports yet.</p>
              <span>Reports you save will appear here.</span>
            </div>
          ) : (
            <div className={styles.reportTabsPanel}>
              <div className={styles.reportTabs} role="tablist" aria-label="Saved report ownership">
                {currentUserRole !== null && !isViewerRole && <button
                  type="button"
                  role="tab"
                  aria-selected={visibleReportTab === 'owned'}
                  className={`${styles.reportTab} ${visibleReportTab === 'owned' ? styles.reportTabActive : ''}`}
                  onClick={() => updateActiveReportTab('owned')}
                >
                  Your reports
                  <span>{ownReports.length}</span>
                </button>}
                <button
                  type="button"
                  role="tab"
                  aria-selected={visibleReportTab === 'shared'}
                  className={`${styles.reportTab} ${visibleReportTab === 'shared' ? styles.reportTabActive : ''}`}
                  onClick={() => updateActiveReportTab('shared')}
                >
                  Shared with you
                  <span>{sharedReports.length}</span>
                </button>
              </div>

              {renderReportsTable(
                activeReports,
                visibleReportTab === 'owned' ? 'No reports you own yet.' : 'No shared reports yet.',
                visibleReportTab === 'owned' ? 'Reports you create will appear here.' : 'Reports shared by collaborators will appear here.',
              )}
            </div>
          )}
        </section>

      </section>
      <ConfirmDialog dialog={confirmDialog} onClose={resolveConfirmation} />
    </main>
  );
};

export default InsightsStudio;
