import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { REPORT_THUMBNAIL_VERSION, captureReportImage, getCurrentReportThumbnail, getReportThumbnailRevision, preserveReportThumbnail, rasterizeReportSvgs, waitForReportPaint } from './ReportThumbnails.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, requestAnimationFrame: callback => setTimeout(callback, 0) });
after(() => dom.window.close());
const report = () => ({ title: 'Saved report', author: 'Planning', date: 'November 16', period: 'Last week', layout_data: {
  mode: 'solo', elements: [{ id: 'chart', type: 'chart', snapshotData: [{ occupancy: 10, total_people: 5 }], style: { color: '#34524d' } }],
  reportSettings: { timeframe: 'weekly', showCoverPage: false, sharedWith: [], lastSavedAt: '2026-11-16' },
} });

test('image revisions include saved graph data, formatting, and metadata, independent of JSON key order', async () => {
  const original = report();
  const revision = await getReportThumbnailRevision(original);
  assert.ok(revision.length === 64);
  const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).reverse().map(key => [key, sorted(value[key])])) : value;
  assert.equal(await getReportThumbnailRevision(sorted(original)), revision);
  for (const modify of [
    copy => { copy.title = 'A new title'; },
    copy => { copy.layout_data.elements[0].snapshotData[0].occupancy = 20; },
    copy => { copy.layout_data.elements[0].style.color = '#ff0000'; },
    copy => { copy.layout_data.reportSettings.timeframe = 'monthly'; },
  ]) {
    const copy = structuredClone(original);
    modify(copy);
    assert.notEqual(await getReportThumbnailRevision(copy), revision);
  }
});

test('old or stale images are rejected and sharing preserves only an image matching the document', async () => {
  const original = report();
  const revision = await getReportThumbnailRevision(original);
  const thumbnail = { version: REPORT_THUMBNAIL_VERSION, revision, src: 'data:image/png;base64,test', width: 820, height: 1200 };
  original.layout_data.thumbnail = thumbnail;
  assert.equal(getCurrentReportThumbnail(original, revision), thumbnail.src);
  assert.equal(getCurrentReportThumbnail(original, 'outdated'), '');
  assert.equal(getCurrentReportThumbnail({ ...original, layout_data: { ...original.layout_data, thumbnail: { ...thumbnail, version: 2 } } }, revision), '', 'older captures are regenerated after a renderer fix');
  assert.equal(getCurrentReportThumbnail({ ...original, layout_data: { ...original.layout_data, thumbnail: { ...thumbnail, version: 1 } } }, revision), '');
  const shared = structuredClone(original.layout_data);
  delete shared.thumbnail;
  shared.reportSettings.sharedWith = ['colleague@example.test'];
  shared.reportSettings.lastSavedAt = '2026-11-17';
  const preserved = await preserveReportThumbnail(shared, original, thumbnail);
  assert.equal(preserved.thumbnail, thumbnail);
  shared.elements[0].snapshotData[0].occupancy = 99;
  assert.equal((await preserveReportThumbnail(shared, original, thumbnail)).thumbnail, undefined);
});

test('capture waits until the graph has a real size and has stopped changing', async () => {
  const host = document.createElement('div');
  host.innerHTML = '<div data-report-loading="true"></div><div class="recharts-responsive-container"><svg class="recharts-surface"><path d="M0,0" /></svg></div>';
  const svg = host.querySelector('svg');
  let frames = 0;
  svg.getBoundingClientRect = () => ({ width: frames >= 3 ? 300 : 0, height: frames >= 3 ? 200 : 0 });
  const originalFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => setTimeout(() => {
    frames += 1;
    if (frames === 2) host.querySelector('[data-report-loading]').remove();
    if (frames < 6) svg.querySelector('path').setAttribute('d', `M0,${frames}`);
    callback();
  }, 0);
  try { await waitForReportPaint(host); } finally { globalThis.requestAnimationFrame = originalFrame; }
  assert.ok(frames >= 7, 'an axis-only or zero-size graph must not be photographed');
  await assert.rejects(waitForReportPaint(host, () => true), /cancelled/);
});

const withRasterCanvas = async callback => {
  const originalDecode = dom.window.HTMLImageElement.prototype.decode;
  const originalContext = dom.window.HTMLCanvasElement.prototype.getContext;
  const originalDataUrl = dom.window.HTMLCanvasElement.prototype.toDataURL;
  const images = [];
  const draws = [];
  dom.window.HTMLImageElement.prototype.decode = async function () { images.push(this.src); };
  dom.window.HTMLCanvasElement.prototype.getContext = function () { return { drawImage: (...args) => draws.push(args) }; };
  dom.window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,raster';
  try { await callback({ images, draws }); } finally {
    dom.window.HTMLImageElement.prototype.decode = originalDecode;
    dom.window.HTMLCanvasElement.prototype.getContext = originalContext;
    dom.window.HTMLCanvasElement.prototype.toDataURL = originalDataUrl;
  }
};
const chartNode = () => {
  const host = document.createElement('div');
  host.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><path d="M0,50 L100,20" style="stroke:rgb(52,82,77);fill:none"/><path d="M0,70 L100,40" style="stroke:rgb(150,60,30);fill:none"/></svg>';
  host.querySelector('svg').getBoundingClientRect = () => ({ width: 300, height: 200 });
  return host;
};

test('graph rasterization retains both plotted series and computed styling', async () => withRasterCanvas(async ({ images, draws }) => {
  const rasters = await rasterizeReportSvgs(chartNode());
  assert.equal(rasters[0].src, 'data:image/png;base64,raster');
  assert.equal(rasters[0].width, 300);
  assert.equal(draws.length, 1);
  assert.deepEqual(draws[0].slice(1), [0, 0, 600, 400]);
  const svg = decodeURIComponent(images[0].split(',').slice(1).join(','));
  assert.ok(svg.includes('M0,50 L100,20'));
  assert.ok(svg.includes('M0,70 L100,40'));
  assert.ok(svg.includes('stroke:'));
}));

test('the screenshot receives raster images in place of SVG graphs', async () => withRasterCanvas(async () => {
  const host = chartNode();
  const thumbnail = await captureReportImage(host, async (node, options) => {
    const clone = document.implementation.createHTMLDocument();
    clone.body.appendChild(node.cloneNode(true));
    await options.onclone(clone);
    assert.equal(clone.querySelector('svg'), null);
    assert.equal(clone.querySelector('img').src, 'data:image/png;base64,raster');
    return { toDataURL: () => 'data:image/png;base64,complete' };
  }, { width: 820, height: 1200, revision: 'saved-revision' });
  assert.equal(thumbnail.revision, 'saved-revision');
  assert.equal(thumbnail.version, REPORT_THUMBNAIL_VERSION);
  assert.equal(thumbnail.src, 'data:image/png;base64,complete');
  assert.equal(host.hasAttribute('data-report-image-capture'), false);
}));
