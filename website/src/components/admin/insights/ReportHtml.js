import DOMPurify from 'dompurify';

const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

export const createReportHtmlSanitizer = (purifier) => {
  const cache = new Map();
  return (value) => {
    const html = String(value ?? '');
    // Server rendering and unsupported DOMs must never pass raw HTML through.
    if (!purifier?.isSupported || typeof purifier.sanitize !== 'function') return escapeHtml(html);
    if (cache.has(html)) return cache.get(html);
    const clean = purifier.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe'],
      ALLOW_DATA_ATTR: false,
    });
    if (html.length < 100000) {
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(html, clean);
    }
    return clean;
  };
};

export const sanitizeReportHtml = createReportHtmlSanitizer(DOMPurify);
