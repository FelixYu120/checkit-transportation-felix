// Embed the supplied PNG so SVG markers have no external image dependency.
export const prepareSensorLogo = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Sensor logo could not load');
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
};

export const replaceSensorGlyph = (svg, logoDataUrl) => svg.replace(
  /<path\b[^>]*\/>/,
  `<defs><clipPath id="logo-clip"><circle cx="32" cy="32" r="15"/></clipPath></defs><image href="${logoDataUrl}" x="17" y="17" width="30" height="30" preserveAspectRatio="xMidYMid meet" clip-path="url(#logo-clip)"/>`,
);

const imageCache = new Map();
// Keep complete old symbols visible until replacement images are ready.
export const preloadMarkerImages = (urls) => Promise.all([...new Set(urls)].map((url) => {
  if (!imageCache.has(url)) {
    const ready = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Sensor marker image could not load'));
      image.src = url;
    });
    imageCache.set(url, ready);
    ready.catch(() => imageCache.delete(url));
  }
  return imageCache.get(url);
}));
