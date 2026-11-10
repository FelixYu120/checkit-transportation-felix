import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
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
  await studio.until(() => studio.button('Delete My report'));
  assert.equal(document.querySelector('a.openReportButton').getAttribute('href'), '/insights-studio/solo?id=own');
  await studio.click('Delete My report');
  assert.ok(studio.button('Cancel'));
  assert.ok(studio.button('Delete report'));
  await studio.click('Cancel');
  assert.equal(studio.state.writes.length, 0);
  await studio.click('Shared with you1');
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
