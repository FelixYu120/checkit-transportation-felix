import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { getReportThumbnailRevision, REPORT_THUMBNAIL_VERSION } from './ReportThumbnails.js';
import { createStudioHarness } from './StudioTestHarness.js';

const studio = await createStudioHarness();
afterEach(() => studio.reset());
after(() => studio.close());

test('the Studio main page keeps both creation flows without the redundant instruction', async () => {
  await studio.mountLanding();
  await studio.until(() => studio.button('Create Solo Insight'));
  assert.equal(document.querySelector('h1').textContent, 'Insights Studio');
  assert.ok(document.body.textContent.includes('Saved reports'));
  assert.ok(document.body.textContent.includes('No saved reports yet.'));
  assert.equal(document.body.textContent.includes('Choose an insight type to begin.'), false);
  for (const [button, mode] of [['Create Solo Insight', 'solo'], ['Create Comparison Insight', 'comparison']]) {
    await studio.click(button);
    const links = [...document.querySelectorAll('[role="dialog"] a')];
    assert.ok(links.length > 1);
    assert.ok(links.every(link => link.getAttribute('href').startsWith(`/insights-studio/${mode}?template=`)));
    await studio.click('Close');
  }
  assert.equal(studio.state.writes.length, 0);
});

test('saved report actions retain the correct report mode, shared tab, and owner-only deletion', async () => {
  studio.state.reports.set('own', studio.report({ id: 'own', title: 'My report' }));
  studio.state.reports.set('shared', studio.report({ id: 'shared', title: 'Shared report', owner_id: 'colleague', shared_with_emails: ['owner@example.test'], layout_data: { mode: 'comparison', elements: [], pageCount: 1 } }));
  await studio.mountLanding();
  await studio.until(() => document.querySelector('summary[aria-label="Actions for My report"]'));
  await act(async () => document.querySelector('summary[aria-label="Actions for My report"]').click());
  assert.equal(document.querySelector('details').open, true);
  assert.equal(document.querySelector('a.openReportButton').getAttribute('href'), '/insights-studio/solo?id=own');
  await studio.click('Delete My report');
  assert.ok(studio.button('Cancel'));
  assert.ok(studio.button('Delete report'));
  await studio.click('Cancel');
  assert.equal(studio.state.writes.length, 0);
  await studio.click('Shared with you1');
  await studio.until(() => document.querySelector('a.openReportButton'));
  assert.equal(document.querySelector('a.openReportButton').getAttribute('href'), '/insights-studio/comparison?id=shared&fromTab=shared');
  assert.equal(document.querySelector('.deleteReportButton'), null);
});

test('viewer accounts see shared reports without report-creation controls', async () => {
  studio.state.role = 'user';
  studio.state.reports.set('shared', studio.report({ id: 'shared', owner_id: 'colleague', shared_with_emails: ['owner@example.test'] }));
  await studio.mountLanding();
  await studio.until(() => document.querySelector('a.openReportButton'));
  assert.equal(studio.button('Create Solo Insight'), undefined);
  assert.equal(studio.button('Create Comparison Insight'), undefined);
  assert.equal(document.querySelector('.deleteReportButton'), null);
  assert.ok(document.querySelector('[data-location]').textContent.includes('tab=shared'));
});

test('saved report search, sorting, and view controls keep document links intact', async () => {
  for (const [id, title, savedAt] of [
    ['alpha', 'Alpha report', '2026-11-10T12:00:00Z'],
    ['zulu', 'Zulu report', '2026-11-12T12:00:00Z'],
  ]) studio.state.reports.set(id, studio.report({ id, title, layout_data: {
    mode: 'solo', elements: [], reportSettings: { showCoverPage: false, lastSavedAt: savedAt },
  } }));
  await studio.mountLanding();
  await studio.until(() => document.querySelectorAll('.savedReportCard').length === 2);
  const titles = () => [...document.querySelectorAll('.savedReportTitle')].map(node => node.textContent);
  assert.deepEqual(titles(), ['Zulu report', 'Alpha report']);
  const sort = document.querySelector('[aria-label="Sort saved reports"]');
  await act(async () => {
    sort.value = 'title';
    sort.dispatchEvent(new studio.dom.window.Event('change', { bubbles: true }));
  });
  assert.deepEqual(titles(), ['Alpha report', 'Zulu report']);
  await studio.click('List view');
  assert.ok(document.querySelector('.savedReportList'));
  assert.equal(document.querySelector('a.openReportButton').getAttribute('href'), '/insights-studio/solo?id=alpha');
  await studio.click('Grid view');
  assert.equal(document.querySelector('.savedReportList'), null);
  const search = document.querySelector('[aria-label="Search saved reports"]');
  const enterSearch = async value => act(async () => {
    Object.getOwnPropertyDescriptor(studio.dom.window.HTMLInputElement.prototype, 'value').set.call(search, value);
    search.dispatchEvent(new studio.dom.window.Event('input', { bubbles: true }));
  });
  await enterSearch('alpha');
  assert.deepEqual(titles(), ['Alpha report']);
  await enterSearch('missing');
  assert.ok(document.body.textContent.includes('No matching reports.'));
  await enterSearch('');
  assert.equal(titles().length, 2);
  assert.equal(studio.state.writes.length, 0);
});

test('legacy reports render once offscreen and then display only a static image', async () => {
  studio.state.reports.set('snapshot', studio.report({ id: 'snapshot', title: 'Saved snapshot', layout_data: JSON.stringify({ mode: 'solo', elements: [
    { id: 'note', type: 'text', x: 48, y: 200, width: 700, height: 120, html: '<p>Saved finding</p><script>unsafe()</script>' },
    { id: 'chart', type: 'chart', chartType: 'combo', x: 48, y: 350, width: 700, height: 300, thresholdEnabled: true, thresholdValue: 75, snapshotData: [{ occupancy: 10, total_people: 12 }, { occupancy: 20, total_people: 24 }] },
  ], selections: { areaId: 'ucsd' }, reportSettings: { showCoverPage: false } }) }));
  studio.state.reports.set('unavailable', studio.report({ id: 'unavailable', title: 'Unavailable preview', layout_data: 'invalid' }));
  await studio.mountLanding();
  await studio.until(() => document.querySelector('.reportThumbnailImage'));
  const preview = document.querySelector('[aria-label="Open Saved snapshot"]').closest('article').querySelector('.savedReportPreview');
  assert.ok(preview.querySelector('img'));
  assert.equal(preview.querySelector('svg, [data-report-widget], .exportPreviewLiveReport'), null, 'the gallery must never contain running report widgets');
  const captured = studio.state.captures[0];
  assert.ok(captured.textContent.includes('Saved finding'));
  assert.equal(captured.textContent.includes('unsafe()'), false);
  const chartProps = JSON.parse(captured.querySelector('[data-report-widget="../visualizations/AggregateChart"]').dataset.widgetProps);
  assert.equal(chartProps.plotType, 'combo');
  assert.equal(chartProps.thresholdValue, 75);
  assert.deepEqual(chartProps.snapshotData, [{ occupancy: 10, total_people: 12 }, { occupancy: 20, total_people: 24 }]);
  await studio.until(() => document.querySelectorAll('.savedReportCard').length === 2);
  assert.equal(document.querySelector('.thumbnailCaptureHost'), null, 'rendering resources are released after capture');
  assert.equal(document.body.textContent.includes('Some report images could not be refreshed.'), false);
  assert.equal(document.body.textContent.includes('View affected reports'), false);
  assert.equal(studio.button('Retry report images'), undefined);
  assert.equal(studio.state.writes.length, 0);
});

test('report actions dismiss on Escape without opening or deleting the report', async () => {
  studio.state.reports.set('own', studio.report({ id: 'own', title: 'My report' }));
  await studio.mountLanding();
  await studio.until(() => document.querySelector('summary[aria-label="Actions for My report"]'));
  const trigger = document.querySelector('summary[aria-label="Actions for My report"]');
  await act(async () => trigger.click());
  assert.equal(trigger.parentElement.open, true);
  await act(async () => document.dispatchEvent(new studio.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(trigger.parentElement.open, false);
  assert.equal(document.activeElement, trigger);
  assert.equal(studio.state.writes.length, 0);
});

for (const cover of [false, true]) test(`gallery and report export render the same ${cover ? 'custom cover' : 'styled report page'}`, async () => {
  const report = studio.report({ id: `exact-page-${cover}`, title: 'Exact page', author: 'Planning team', date: 'November 16, 2026', layout_data: {
    mode: 'solo', pageCount: 2, elements: [
      { id: 'styled-note', type: 'text', x: 96, y: 240, width: 600, height: 180, html: '<h2>Section heading</h2><p><strong>Bold finding</strong> with <em>emphasis</em>.</p>', style: { color: '#7b3528', fontFamily: 'Georgia, serif', fontSize: '28px', textAlign: 'right', background: '#fff6e5', borderRadius: '12px' } },
      { id: 'divider', type: 'divider', x: 72, y: 450, width: 680, height: 24, style: { line: '3px dashed #7b3528' } },
      { id: 'second-page', type: 'text', x: 48, y: 1260, width: 600, height: 120, content: 'Second page content', style: {} },
    ], reportSettings: { showCoverPage: cover, showDocumentHeader: true, showFooter: true, coverFooterBrand: 'Planning',
      coverLayout: 'banded', coverAccentColor: '#7b3528', coverBackground: '#fff6e5', coverTitleX: 120, coverTitleY: 200,
      coverEyebrow: 'CUSTOM COVER', coverSubtitle: 'A saved cover subtitle', coverTitleFontSize: '54px', coverFontFamily: 'Georgia, serif' },
  } });
  studio.state.reports.set(report.id, report);
  await studio.mountLanding();
  await studio.until(() => document.querySelector('.reportThumbnailImage'));
  const markup = node => {
    const clone = node.cloneNode(true);
    for (const text of clone.querySelectorAll('[data-text-element-id]')) text.style.removeProperty('cursor');
    return clone.outerHTML;
  };
  const gallery = studio.state.captures[0].querySelector('.exportPreviewLiveReport');
  const galleryMarkup = markup(gallery);
  assert.equal(gallery.textContent.includes('Second page content'), false);
  if (!cover) {
    assert.equal(gallery.querySelector('strong').textContent, 'Bold finding');
    assert.equal(gallery.querySelector('[data-text-element-id]').style.fontFamily, 'Georgia, serif');
    assert.ok(gallery.textContent.includes('Planning'));
  } else assert.equal(gallery.querySelector('.coverPage h1').style.left, '120px');
  await studio.reset();
  studio.state.reports.set(report.id, report);
  await studio.mount(`/insights-studio/solo?id=${report.id}`);
  await studio.until(() => studio.button('Preview export'));
  await studio.click('Preview export');
  await studio.until(() => document.querySelector('[data-export-capture-page="0"] .exportPreviewLiveReport'));
  assert.equal(markup(document.querySelector('[data-export-capture-page="0"] .exportPreviewLiveReport')), galleryMarkup,
    'the miniature must contain the same report page, not a reconstructed approximation');
});

test('images load as completed batches with a single shared progress indicator', async () => {
  const intersect = studio.observeManually();
  for (let index = 0; index < 30; index++) {
    const id = `batch-image-${index}`;
    const report = studio.report({ id, title: `Image ${index}`, layout_data: {
      mode: 'solo', elements: [], reportSettings: { showCoverPage: false },
    } });
    report.layout_data.thumbnail = { version: REPORT_THUMBNAIL_VERSION,
      revision: await getReportThumbnailRevision(report), src: 'data:image/png;base64,c3RhdGlj', width: 820, height: 1200 };
    studio.state.reports.set(id, report);
  }
  await studio.mountLanding();
  await studio.until(() => document.querySelectorAll('.savedReportCard').length === 12);
  assert.equal(document.querySelectorAll('.reportThumbnailImage').length, 12);
  assert.equal(document.body.textContent.includes('Loading preview'), false);
  assert.equal(studio.state.captures.length, 0);
  assert.equal(studio.state.batchReads.length, 1);
  assert.equal(studio.state.batchReads[0].length, 12);
  assert.equal(studio.state.reads.filter(Boolean).length, 0, 'cards make no individual preview request');

  let release;
  studio.state.previewReadGate = new Promise(resolve => { release = resolve; });
  await intersect(document.querySelector('.reportLoadMore'));
  await studio.until(() => studio.state.batchReads.length === 2);
  assert.equal(document.querySelectorAll('.savedReportCard').length, 12, 'unfinished cards are not added');
  assert.equal(document.querySelectorAll('.previewBatchStatus').length, 1);
  assert.equal(document.body.textContent.includes('Loading preview'), false);
  await act(async () => release());
  studio.state.previewReadGate = null;
  await studio.until(() => document.querySelectorAll('.savedReportCard').length === 24);
  await studio.click('Show more reports');
  await studio.until(() => document.querySelectorAll('.savedReportCard').length === 30);
  assert.deepEqual(studio.state.batchReads.map(ids => ids.length), [12, 12, 6]);
  assert.equal(studio.button('Show more reports'), undefined);
  assert.equal(document.querySelector('[data-report-widget], .thumbnailCaptureHost'), null);
});


test('slow previews reveal together and scrolling appends only the next batch', async () => {
  const intersect = studio.observeManually();
  const releases = new Map();
  studio.state.captureGate = async count => {
    if ([12, 24, 25].includes(count)) await new Promise(resolve => releases.set(count, resolve));
  };
  for (let index = 0; index < 25; index++) {
    const id = `atomic-batch-${index}`;
    studio.state.reports.set(id, studio.report({ id, title: `Batch report ${index}`, layout_data: {
      mode: 'solo', elements: [], reportSettings: { showCoverPage: false },
    } }));
  }
  try {
    await studio.mountLanding();
    await studio.until(() => releases.has(12));
    assert.equal(document.querySelectorAll('.savedReportCard').length, 0, 'the first batch waits for its final preview');
    await act(async () => releases.get(12)());
    await studio.until(() => document.querySelectorAll('.savedReportCard').length === 12);
    const initialCards = [...document.querySelectorAll('.savedReportCard')];
    assert.equal(studio.state.batchReads.length, 1, 'later batches wait for scrolling');

    await intersect(document.querySelector('.reportLoadMore'));
    await studio.until(() => releases.has(24));
    assert.deepEqual([...document.querySelectorAll('.savedReportCard')], initialCards, 'existing cards stay in place while the next batch is prepared');
    assert.equal(document.querySelectorAll('.previewBatchStatus').length, 1);
    await act(async () => releases.get(24)());
    await studio.until(() => document.querySelectorAll('.savedReportCard').length === 24);

    await intersect(document.querySelector('.reportLoadMore'));
    await studio.until(() => releases.has(25));
    assert.equal(document.querySelectorAll('.savedReportCard').length, 24);
    await act(async () => releases.get(25)());
    await studio.until(() => document.querySelectorAll('.savedReportCard').length === 25);
    assert.deepEqual(studio.state.batchReads.map(ids => ids.length), [12, 12, 1]);
    assert.equal(document.querySelector('.reportLoadMore'), null);
    assert.equal(document.querySelector('.previewBatchStatus'), null);
  } finally {
    for (const release of releases.values()) release();
  }
});

test('legacy reports without frozen chart data render once to repair their image', async () => {
  studio.state.reports.set('repair-no-data', studio.report({ id: 'repair-no-data', layout_data: {
    mode: 'solo', selections: { areaId: 'ucsd' }, reportSettings: { showCoverPage: false },
    elements: [{ id: 'chart', type: 'chart', x: 48, y: 200, width: 700, height: 300 }],
  } }));
  await studio.mountLanding();
  await studio.until(() => document.querySelector('.reportThumbnailImage'));
  assert.equal(studio.state.captures.length, 1);
  const chart = studio.state.captures[0].querySelector('[data-report-widget="../visualizations/AggregateChart"]');
  assert.ok(chart, 'the actual chart renderer prepares missing legacy content');
  assert.equal(document.querySelector('[data-report-widget], .thumbnailCaptureHost'), null);
  assert.equal(document.body.textContent.includes('Save once'), false);
  assert.equal(studio.state.writes.length, 0, 'repair never changes the saved report or its review status');
});

test('saving persists a still image which the gallery reuses without mounting charts', async () => {
  await studio.mount();
  await studio.until(() => studio.button('Save report'));
  await studio.setTitle('Static saved report');
  await studio.click('Save report');
  await studio.until(() => studio.isSaved());
  assert.equal(studio.state.writes.length, 1);
  const saved = studio.state.reports.get('created-report');
  assert.equal(saved.layout_data.thumbnail.version, REPORT_THUMBNAIL_VERSION);
  assert.equal(saved.layout_data.thumbnail.revision, await getReportThumbnailRevision(saved));
  assert.ok(saved.layout_data.thumbnail.src.startsWith('data:image/png;base64,'));
  assert.equal(studio.state.captures.length, 1);
  const capturedPage = studio.state.captureClones[0].querySelector('[data-report-image-capture]');
  assert.equal(capturedPage.style.transform, 'none', 'canvas zoom must not shrink the saved image');
  assert.equal(capturedPage.style.width, '820px');
  assert.equal(capturedPage.style.height, '1200px');
  assert.equal(studio.state.captureOptions[0].height, 1200, 'capture is clipped to the first page');
  assert.equal(capturedPage.querySelector('[data-html2canvas-ignore="true"]'), null, 'editing guides are excluded from the image');
  await studio.click('Back to reports');
  await studio.until(() => document.body.textContent.includes('Reports landing'));
  assert.equal(studio.button('Keep editing'), undefined, 'thumbnail data must not make a saved report dirty');
  await studio.reset();
  studio.state.reports.set(saved.id, saved);
  await studio.mountLanding();
  await studio.until(() => document.querySelector('.reportThumbnailImage'));
  assert.equal(studio.state.captures.length, 0);
  assert.equal(document.querySelector('[data-report-widget], .thumbnailCaptureHost'), null);
});

test('a changed saved graph replaces an old image even when the save timestamp is unchanged', async () => {
  const report = studio.report({ id: 'stale-graph-repair', title: 'Updated graph', layout_data: {
    mode: 'solo', selections: { areaId: 'ucsd' }, elements: [
      { id: 'chart', type: 'chart', x: 48, y: 200, width: 700, height: 300, snapshotData: [{ occupancy: 10, total_people: 1 }] },
    ], reportSettings: { showCoverPage: false, lastSavedAt: '2026-11-16T12:00:00Z' },
  } });
  const oldImage = 'data:image/png;base64,old-image';
  report.layout_data.thumbnail = { version: REPORT_THUMBNAIL_VERSION, revision: await getReportThumbnailRevision(report), src: oldImage };
  report.layout_data.elements[0].snapshotData[0].occupancy = 25;
  studio.state.reports.set(report.id, report);
  await studio.mountLanding();
  await studio.until(() => document.querySelector('.reportThumbnailImage'));
  assert.notEqual(document.querySelector('.reportThumbnailImage').src, oldImage);
  const captured = studio.state.captures[0].querySelector('[data-report-widget="../visualizations/AggregateChart"]');
  assert.equal(JSON.parse(captured.dataset.widgetProps).snapshotData[0].occupancy, 25);
  assert.equal(studio.state.writes.length, 0, 'preview repair leaves the report and review workflow unchanged');
});

test('changing sharing access retains a thumbnail when the report content is unchanged', async () => {
  await studio.mount();
  await studio.until(() => studio.button('Save report'));
  await studio.setTitle('Shared thumbnail');
  await studio.click('Save report');
  await studio.until(() => studio.isSaved());
  const report = studio.state.reports.get('created-report');
  const thumbnail = report.layout_data.thumbnail;
  report.shared_with_emails = ['reader@example.test'];
  report.layout_data.reportSettings.sharedWith = ['reader@example.test'];
  report.layout_data.reportSettings.sharedAccess = { 'reader@example.test': 'editor' };
  await studio.reset();
  studio.state.reports.set(report.id, report);
  await studio.mount('/insights-studio/solo?id=created-report');
  await studio.until(() => studio.button('Share report'));
  await studio.click('Share report');
  const select = document.querySelector('select[aria-label="Access for reader@example.test"]');
  await act(async () => {
    select.value = 'viewer';
    select.dispatchEvent(new studio.dom.window.Event('change', { bubbles: true }));
  });
  await studio.until(() => studio.state.rpcCalls.length > 0);
  assert.equal(studio.state.rpcCalls[0].payload.p_layout_data.thumbnail.src, thumbnail.src);
  assert.equal(studio.state.rpcCalls[0].payload.p_layout_data.thumbnail.revision, thumbnail.revision);
});
