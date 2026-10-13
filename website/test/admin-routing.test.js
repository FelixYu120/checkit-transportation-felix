import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// This utility has a JSX extension but contains plain JavaScript and no imports.
const source = readFileSync(new URL('../src/components/admin/routing/AdminRouteUtils.jsx', import.meta.url), 'utf8');
const { normalizeAdminPathSegment, slugifyAdminPathSegment, getAdminAreaPath } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

test('exports the normalizer required by the dashboard and matches canonical area slugs', () => {
  assert.equal(typeof normalizeAdminPathSegment, 'function');
  for (const value of ['Muir College', 'muir-college', 'muir_college', ' Muir_College ']) {
    assert.equal(normalizeAdminPathSegment(value), 'muir_college');
  }
  assert.equal(normalizeAdminPathSegment('Muir College'), slugifyAdminPathSegment('Muir College'));
  assert.equal(getAdminAreaPath('ucsd', normalizeAdminPathSegment('Muir College')),
    '/dashboard/institute/ucsd/area/muir_college');
});

test('missing area values retain the existing unknown-area fallback', () => {
  for (const value of [undefined, null, '']) {
    assert.equal(normalizeAdminPathSegment(value), 'unknown');
  }
});
