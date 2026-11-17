import { decodeReportLayout } from './ReportSafety.js';

export const REPORT_THUMBNAIL_VERSION = 3;

export const getReportThumbnailRevision = async (report) => {
  const decoded = decodeReportLayout(report.layout_data);
  if (!decoded) throw new Error('The saved report layout could not be read.');
  const layout = Array.isArray(decoded) ? { elements: decoded } : { ...decoded };
  delete layout.thumbnail;
  if (layout.reportSettings) {
    layout.reportSettings = { ...layout.reportSettings };
    for (const key of ['sharedWith', 'sharedAccess', 'lastSavedAt', 'lastSavedBy']) delete layout.reportSettings[key];
  }
  const content = { rendererVersion: REPORT_THUMBNAIL_VERSION, layout, title: report.title || '', author: report.author || '', date: report.date || '', period: report.period || '' };
  const serialized = JSON.stringify(content, (_, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};

export const getCurrentReportThumbnail = (report, revision) => {
  const thumbnail = decodeReportLayout(report.layout_data)?.thumbnail;
  return thumbnail?.version === REPORT_THUMBNAIL_VERSION && thumbnail.revision === revision
    && /^data:image\/(png|jpeg|webp);base64,/i.test(thumbnail.src || '') ? thumbnail.src : '';
};

export const preserveReportThumbnail = async (layout, metadata, thumbnail) => {
  if (!thumbnail || thumbnail.version !== REPORT_THUMBNAIL_VERSION) return layout;
  const revision = await getReportThumbnailRevision({ ...metadata, layout_data: layout });
  return thumbnail.revision === revision ? { ...layout, thumbnail } : layout;
};

let databaseTask;
const thumbnailDatabase = () => {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  databaseTask ||= new Promise(resolve => {
    const request = indexedDB.open('checkit-report-images', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('images', { keyPath: 'key' });
      store.createIndex('cachedAt', 'cachedAt');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return databaseTask;
};

export const readCachedReportThumbnail = async key => {
  try {
    const db = await thumbnailDatabase();
    if (!db) return '';
    return await new Promise(resolve => {
      const request = db.transaction('images').objectStore('images').get(key);
      request.onsuccess = () => resolve(request.result?.src || '');
      request.onerror = () => resolve('');
    });
  } catch { return ''; }
};

export const cacheReportThumbnail = async (key, src) => {
  try {
    const db = await thumbnailDatabase();
    if (!db) return;
    await new Promise(resolve => {
      const transaction = db.transaction('images', 'readwrite');
      const store = transaction.objectStore('images');
      store.put({ key, src, cachedAt: Date.now() });
      const count = store.count();
      count.onsuccess = () => {
        let excess = count.result - 48;
        if (excess <= 0) return;
        const cursor = store.index('cachedAt').openCursor();
        cursor.onsuccess = () => {
          if (!cursor.result || excess <= 0) return;
          cursor.result.delete();
          excess -= 1;
          cursor.result.continue();
        };
      };
      transaction.oncomplete = resolve;
      transaction.onerror = resolve;
      transaction.onabort = resolve;
    });
  } catch { /* The image still works if browser storage is unavailable. */ }
};

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

export const waitForReportPaint = async (node, cancelled = () => false, timeoutMs = 10000) => {
  const started = Date.now();
  let previous = null;
  let stableFrames = 0;
  while (Date.now() - started < timeoutMs) {
    if (cancelled()) throw new Error('Preview cancelled.');
    const containers = [...node.querySelectorAll('.recharts-responsive-container')];
    const surfaces = containers.map(container => container.querySelector('svg.recharts-surface'));
    const ready = !node.querySelector('[data-report-loading="true"]') && surfaces.every(svg => svg && svg.getBoundingClientRect().width > 0 && svg.getBoundingClientRect().height > 0);
    const signature = ready ? surfaces.map(svg => svg.outerHTML).join('') : null;
    stableFrames = ready && signature === previous ? stableFrames + 1 : 0;
    if (ready && stableFrames >= 2) return;
    previous = signature;
    await nextFrame();
  }
  throw new Error('The report graph has not finished rendering.');
};

const decodeImage = (image) => typeof image.decode === 'function' ? image.decode() : new Promise((resolve, reject) => {
  if (image.complete && image.naturalWidth) { resolve(); return; }
  image.onload = resolve;
  image.onerror = () => reject(new Error('A report image could not be loaded.'));
});

// Convert chart SVGs to bitmaps before html2canvas sees them. This preserves the
// rendered graph, including CSS colors, fonts, clipping and multiple data series.
export const rasterizeReportSvgs = async (node) => Promise.all([...node.querySelectorAll('svg')].map(async svg => {
  const bounds = svg.getBoundingClientRect();
  if (!bounds.width || !bounds.height) throw new Error('The report graph has no rendered size.');
  const clone = svg.cloneNode(true);
  const originals = [svg, ...svg.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  const properties = ['fill', 'stroke', 'fill-opacity', 'stroke-opacity', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'clip-path', 'visibility', 'display'];
  originals.forEach((element, index) => {
    const computed = window.getComputedStyle(element);
    properties.forEach(property => {
      const value = computed.getPropertyValue(property).replace(/url\(["']?[^)"']*#([^\s)"']+)["']?\)/g, 'url(#$1)');
      if (value) copies[index].style.setProperty(property, value);
    });
  });
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(bounds.width));
  clone.setAttribute('height', String(bounds.height));
  const image = document.createElement('img');
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new window.XMLSerializer().serializeToString(clone))}`;
  await decodeImage(image);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(bounds.width * 2);
  canvas.height = Math.ceil(bounds.height * 2);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The report graph could not be captured.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { src: canvas.toDataURL('image/png'), width: bounds.width, height: bounds.height };
}));

export const captureReportImage = async (node, capture, { width, height, revision, cancelled = () => false }) => {
  if (document.fonts?.ready) await document.fonts.ready;
  await Promise.all([...node.querySelectorAll('img')].map(decodeImage));
  await waitForReportPaint(node, cancelled);
  const graphs = await rasterizeReportSvgs(node);
  if (cancelled()) throw new Error('Preview cancelled.');
  const marker = `report-capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  node.setAttribute('data-report-image-capture', marker);
  try {
    const canvas = await capture(node, {
      scale: 1, width, height, useCORS: true, allowTaint: false, backgroundColor: '#ffffff', logging: false,
      scrollX: 0, scrollY: 0,
      onclone: async clonedDocument => {
        const source = clonedDocument.querySelector(`[data-report-image-capture="${marker}"]`);
        if (!source) throw new Error('The report capture surface is missing.');
        Object.assign(source.style, { position: 'fixed', left: '0', top: '0', transform: 'none', width: `${width}px`, height: `${height}px` });
        const clonedSvgs = [...source.querySelectorAll('svg')];
        await Promise.all(clonedSvgs.map(async (svg, index) => {
          const raster = graphs[index];
          const image = clonedDocument.createElement('img');
          image.style.cssText = svg.style.cssText;
          image.style.width = `${raster.width}px`;
          image.style.height = `${raster.height}px`;
          image.src = raster.src;
          svg.replaceWith(image);
          await decodeImage(image);
        }));
        source.querySelectorAll('[data-html2canvas-ignore="true"], .recharts-tooltip-wrapper').forEach(element => element.remove());
        source.querySelectorAll('*').forEach(element => {
          if (element.style) { element.style.animation = 'none'; element.style.transition = 'none'; }
        });
      },
    });
    return { version: REPORT_THUMBNAIL_VERSION, revision, src: canvas.toDataURL('image/webp', 0.85), width, height };
  } finally {
    node.removeAttribute('data-report-image-capture');
  }
};
