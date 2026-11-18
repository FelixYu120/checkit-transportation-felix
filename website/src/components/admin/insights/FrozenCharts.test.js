import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createStudioHarness } from './StudioTestHarness.js';

const studio = await createStudioHarness();
afterEach(() => studio.reset());
after(() => studio.close());
const chartSelector = '[data-report-widget="../visualizations/AggregateChart"]';
const summarySelector = '[data-report-widget="../summaries/SummaryMetrics"]';
const props = selector => JSON.parse(document.querySelector(selector).getAttribute('data-widget-props'));
const savedPoints = [{ dateLabel: '11/1', sortKey: '2026-11-01', occupancy: 25, total_people: 10 }];
const savedSummary = { average: 25, peak: 25, total: 10 };
const chart = { id: 'chart-1', type: 'chart', x: 48, y: 192, width: 650, height: 280, style: {},
  chartType: 'bar', snapshotData: savedPoints, snapshotKey: JSON.stringify({ chartSnapshotVersion: 1,
    mode: 'solo', targetLevel: 'area', targetId: 'ucsd', timeframe: 'weekly', filters: {} }) };
const summary = { id: 'summary-1', type: 'summary', attachedChartId: chart.id, x: 48, y: 480, width: 650,
  height: 120, style: {}, snapshotData: savedSummary, snapshotKey: chart.snapshotKey };
const seed = () => {
  const report = studio.report();
  report.layout_data.elements = [chart, summary];
  report.layout_data.selections = { areaId: 'ucsd' };
  report.layout_data.reportSettings = { showCoverPage: false, timeframe: 'monthly' };
  studio.state.reports.set(report.id, report);
};
const changePeriod = async value => {
  const label = [...document.querySelectorAll('label')].find(node => node.textContent.trim() === 'Default Timeframe');
  await act(async () => {
    label.nextElementSibling.value = value;
    label.nextElementSibling.dispatchEvent(new studio.dom.window.Event('change', { bubbles: true }));
  });
};

test('opening, editing, saving, and reopening preserves the existing chart instead of replacing an old-key snapshot', async () => {
  seed();
  await studio.mount('/insights-studio/solo?id=saved-report');
  await studio.until(() => document.querySelector(chartSelector));
  assert.deepEqual(props(chartSelector).snapshotData, savedPoints);
  assert.equal(props(chartSelector).type, 'weekly', 'The saved chart keeps its original period');
  assert.deepEqual(props(summarySelector).snapshotData, savedSummary);
  await changePeriod('daily');
  await studio.setTitle('Same chart, new report title');
  assert.deepEqual(props(chartSelector).snapshotData, savedPoints);
  assert.equal(props(chartSelector).type, 'weekly');
  await studio.click('Save report');
  await studio.until(() => studio.state.writes.length === 1 && !studio.button('Save report').disabled);
  const saved = studio.state.reports.get('saved-report').layout_data.elements;
  assert.deepEqual(saved.find(element => element.id === chart.id).snapshotData, savedPoints);
  assert.deepEqual(saved.find(element => element.id === summary.id).snapshotData, savedSummary);
  await studio.navigate('/insights-studio');
  await studio.navigate('/insights-studio/solo?id=saved-report');
  await studio.until(() => document.querySelector(chartSelector));
  assert.deepEqual(props(chartSelector).snapshotData, savedPoints);
  assert.equal(props(chartSelector).type, 'weekly');
});

test('the chart refresh action opts into the new reporting period and clears its linked summary', async () => {
  seed();
  await studio.mount('/insights-studio/solo?id=saved-report');
  await studio.until(() => document.querySelector(chartSelector));
  await changePeriod('daily');
  await act(async () => document.querySelector(chartSelector).dispatchEvent(new studio.dom.window.MouseEvent('dblclick', { bubbles: true })));
  await studio.click('Refresh chart data');
  assert.equal(props(chartSelector).snapshotData, undefined);
  assert.equal(props(chartSelector).type, 'daily');
  assert.equal(props(summarySelector).snapshotData, undefined);
  await act(async () => document.dispatchEvent(new studio.dom.window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })));
  assert.deepEqual(props(chartSelector).snapshotData, savedPoints);
  assert.deepEqual(props(summarySelector).snapshotData, savedSummary);
});


test('comparison charts stay frozen until the report-wide refresh option is used', async () => {
  const report = studio.report();
  const points = [{ dateLabel: '11/1', target0Occupancy: 25, target1Occupancy: 50, target0People: 10, target1People: 20 }];
  report.layout_data.mode = 'comparison';
  report.layout_data.selections = { areaId: 'ucsd' };
  report.layout_data.comparisonSelections = { areaId: 'other-campus' };
  report.layout_data.elements = [{ ...chart, snapshotData: points, snapshotKey: JSON.stringify({
    chartSnapshotVersion: 1, mode: 'comparison', targetLevel: 'area', targetId: 'ucsd',
    secondaryTargetLevel: 'area', secondaryTargetId: 'other-campus', timeframe: 'weekly', filters: {},
    targets: [{ level: 'area', id: 'ucsd' }, { level: 'area', id: 'other-campus' }],
  }) }];
  const selector = '[data-report-widget="../visualizations/ComparisonAggregateChart"]';
  studio.state.reports.set(report.id, report);
  await studio.mount('/insights-studio/comparison?id=saved-report');
  await studio.until(() => document.querySelector(selector));
  await changePeriod('daily');
  assert.deepEqual(props(selector).snapshotData, points);
  assert.equal(props(selector).type, 'weekly');
  await studio.click('Report details');
  await studio.until(() => studio.button('Refresh all chart data'));
  await studio.click('Refresh all chart data');
  assert.equal(props(selector).snapshotData, undefined);
  assert.equal(props(selector).type, 'daily');
});
