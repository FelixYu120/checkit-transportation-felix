import test, { after, afterEach } from 'node:test';
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
let gate = Promise.resolve();
globalThis.__summarySnapshotRows = async () => { await gate; return []; };
const query = new Proxy({}, { get: (_, name) => name === 'then'
  ? (resolve,reject) => globalThis.__summarySnapshotRows().then(data => ({ data, error: null })).then(resolve,reject)
  : () => query });
globalThis.__summarySnapshotClient = { from: () => query };
const source = await readFile(new URL('../summaries/SummaryMetrics.jsx', import.meta.url), 'utf8');
const occupancy = source.includes('rawSessionMetrics');
const transformed = await transformWithEsbuild(source, 'SummaryMetrics.jsx', { loader: 'jsx', jsx: 'transform' });
const code = transformed.code.replace(/(import\s+([\s\S]*?)\s+from\s*)['"]([^'"]+)['"]/g, (match,prefix,clause,specifier) => {
  if (specifier === 'react' || specifier === 'react-dom') return prefix + JSON.stringify(import.meta.resolve(specifier));
  let stub;
  if (specifier.includes('SupabaseClients')) stub = 'export default globalThis.__summarySnapshotClient;';
  else if (specifier.includes('AnalyticsFilterUtils')) stub = `export const applyAnalyticsFilters=rows=>rows;export const applyDateQueryBounds=q=>q;
    export const fetchPaginatedRows=async()=>globalThis.__summarySnapshotRows();export const getDateBounds=()=>({start:new Date('2026-11-01'),end:new Date('2026-11-08')});`;
  else if (specifier.includes('TrafficSummaryData')) stub = 'export const fetchTrafficSummaryRows=async()=>globalThis.__summarySnapshotRows();';
  else if (specifier.includes('roomHistoryArchive')) stub = 'export const mergeWithArchivedRoomHistory=async(_id,_start,_end,rows)=>rows;';
  else throw new Error('Unmocked summary dependency: ' + specifier + clause);
  return prefix + JSON.stringify(asModule(stub));
});
const { default: Summary } = await import(asModule(code));
let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); root=null; gate=Promise.resolve(); });
after(() => dom.window.close());
const points = [{ hasData:true, occupancy:12, total_people:4, max_speed:22, v85_speed:17, sortKey:'2026-11-01', dateLabel:'11/1' },
  { hasData:true, occupancy:18, total_people:6, max_speed:24, v85_speed:19, sortKey:'2026-11-02', dateLabel:'11/2' }];
const settle = async condition => { for(let i=0;i<100;i++){ if(condition())return; await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));}); } assert.fail('Summary did not settle'); };

test('chart-derived KPI values are captured and saved values win over a later chart refresh', async () => {
  const captures=[];
  let snapshot;
  const render = rows => React.createElement(Summary, { level:'area',id:'area',timeframe:'weekly',realtime:false,
    sourceChartData:rows,preferSourceChartData:true,snapshotData:snapshot,onSnapshotData:data=>captures.push(data),
    metrics:occupancy?['current','average','peak']:['total','averageSpeed','maxSpeed'] });
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(render(points)));
  await settle(()=>captures.length>0);
  snapshot=captures[0];
  assert.ok(Object.values(snapshot).some(value=>typeof value==='number'));
  await act(async()=>root.render(render([{ ...points[0],occupancy:999,total_people:999,max_speed:999 }])));
  assert.equal(captures.length,1,'a frozen summary must not resave live values');
  assert.equal(document.body.textContent.includes('999'),false);
});

test('room session KPIs finish loading before they are captured for publication', { skip: !occupancy }, async () => {
  let release;
  gate=new Promise(resolve=>{release=resolve;});
  const captures=[];
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(Summary,{level:'room',id:'room-test',timeframe:'weekly',realtime:false,
    sourceChartData:points,preferSourceChartData:true,metrics:['typicalDwellTime','turnoverRate'],onSnapshotData:data=>captures.push(data)})));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
  assert.equal(captures.length,0);
  assert.ok(document.querySelector('[data-report-loading="true"]'));
  await act(async()=>{release();});
  await settle(()=>captures.length>0);
  assert.equal(document.querySelector('[data-report-loading="true"]'),null);
});


if (!occupancy) test('zero movements do not manufacture a measured speed', async () => {
  const captures=[];
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(Summary,{level:'area',id:'area',timeframe:'weekly',
    sourceChartData:[{hasData:true,total_people:0,occupancy:null,max_speed:null,v85_speed:null}],
    preferSourceChartData:true,metrics:['averageSpeed'],onSnapshotData:data=>captures.push(data)})));
  await settle(()=>captures.length>0);
  assert.equal(captures[0].averageSpeed,null);
  assert.ok(document.body.textContent.includes('—'));
});
