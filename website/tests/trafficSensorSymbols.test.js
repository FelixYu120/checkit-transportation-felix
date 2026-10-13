import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { replaceSensorGlyph, preloadMarkerImages } from '../src/components/maps/TrafficSensorSymbols.js';
import { addHeadingPointer } from '../src/components/maps/TrafficSensorData.js';

test('supplied PNG replaces the drawn glyph while retaining the round badge and heading', () => {
  for (const asset of ['sensor.svg', 'sensor-selected.svg']) {
    const svg = readFileSync(new URL(`../src/components/maps/assets/${asset}`, import.meta.url), 'utf8');
    const result = replaceSensorGlyph(svg, 'data:image/png;base64,brand');
    assert.ok(result.includes('href="data:image/png;base64,brand"'));
    assert.ok(result.includes('clip-path="url(#logo-clip)"'));
    assert.ok(result.includes('r="21"'));
    assert.ok(!result.includes('M20 25'));
    assert.ok(decodeURIComponent(addHeadingPointer(result, 90)).includes('rotate(90 32 32)'));
  }
});

test('marker replacement waits for whole images and reuses already loaded symbols', async (t) => {
  const images = [];
  const previousImage = globalThis.Image;
  globalThis.Image = class {
    set src(value) { this.url = value; images.push(this); }
  };
  t.after(() => {
    if (previousImage === undefined) delete globalThis.Image;
    else globalThis.Image = previousImage;
  });
  let complete = false;
  const ready = preloadMarkerImages(['badge-one', 'badge-one', 'badge-two']).then(() => { complete = true; });
  assert.equal(images.length, 2);
  images[0].onload();
  await Promise.resolve();
  assert.equal(complete, false);
  images[1].onload();
  await ready;
  await preloadMarkerImages(['badge-one']);
  assert.equal(images.length, 2);
});
