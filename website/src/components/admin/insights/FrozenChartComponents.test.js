import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { JSDOM } from 'jsdom';
import { transformWithEsbuild } from 'vite';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { createRoot } = await import('react-dom/client');
const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
globalThis.__frozenChartQueries = 0;
const query = new Proxy({}, { get: (_, name) => name === 'then'
  ? resolve => { globalThis.__frozenChartQueries++; return Promise.resolve({ data: [], error: null }).then(resolve); }
  : () => query });
globalThis.__frozenChartClient = { from: () => query };
async function loadChart(name) {
  const source = await readFile(new URL(`../visualizations/${name}.jsx`, import.meta.url), 'utf8');
  const transformed = await transformWithEsbuild(source, `${name}.jsx`, { loader: 'jsx', jsx: 'transform' });
  const code = transformed.code.replace(/(^import\s+([\s\S]*?)\s+from\s*)(["'])([^"']+)\3/gm, (match, prefix, clause, quote, specifier) => {
    if (specifier === 'react') return prefix + JSON.stringify(import.meta.resolve('react'));
    if (specifier === './ChartTheme.js') return prefix + JSON.stringify(new URL('../visualizations/ChartTheme.js', import.meta.url).href);
    const named = clause.match(/\{([\s\S]*?)\}/)?.[1].split(',').map(name => name.trim()).filter(Boolean) || [];
    let stub = `import React from ${JSON.stringify(import.meta.resolve('react'))};`;
    if (specifier.includes('SupabaseClients')) stub += 'export default globalThis.__frozenChartClient;';
    for (const name of named) {
      if (specifier === 'recharts') stub += `export const ${name}=props=>React.createElement('div',null,props.children);`;
      else if (name === 'shouldUseLocalData') stub += 'export const shouldUseLocalData=false;';
      else if (name === 'getDateBounds') stub += `export const ${name}=()=>({start:new Date('2026-11-01'),end:new Date('2026-11-02')});`;
      else if (name === 'getFilterTimeRange') stub += `export const ${name}=()=>({start:'00:00',end:'23:59'});`;
      else if (/fetch|mergeWithArchived/.test(name)) stub += `export const ${name}=async()=>{globalThis.__frozenChartQueries++;return [];};`;
      else stub += `export const ${name}=()=>false;`;
    }
    return prefix + JSON.stringify(asModule(stub));
  });
  return (await import(asModule(code))).default;
}
after(() => dom.window.close());
for (const name of ['AggregateChart', 'ComparisonAggregateChart']) {
  test(`${name} never queries live data for an empty or populated saved snapshot`, async () => {
    const Chart = await loadChart(name);
    const root = createRoot(document.getElementById('root'));
    const captures = [];
    const targets = [{ level: 'area', id: 'area-1', label: 'Area 1' }, { level: 'area', id: 'area-2', label: 'Area 2' }];
    const before = globalThis.__frozenChartQueries;
    try {
      for (const snapshotData of [[], [{ dateLabel: '11/1', occupancy: 25, total_people: 10 }]]) {
        await act(async () => root.render(React.createElement(Chart, { level: 'area', id: 'area-1', targets,
          filters: {}, type: 'weekly', plotType: 'bar', snapshotData, onSnapshotData: data => captures.push(data) })));
        assert.equal(document.querySelector('[data-report-loading="true"]'), null);
        assert.equal(globalThis.__frozenChartQueries, before);
        assert.equal(captures.length, 0);
      }
    } finally { await act(async () => root.unmount()); }
  });
}
