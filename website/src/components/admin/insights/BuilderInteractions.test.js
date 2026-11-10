import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { readFile } from 'node:fs/promises';
import { createStudioHarness } from './StudioTestHarness.js';

const studio = await createStudioHarness();
afterEach(() => studio.reset());
after(() => studio.close());

test('editing only a saved title protects both Back and browser-close navigation', async () => {
  studio.state.reports.set('saved-report', studio.report());
  await studio.mount('/insights-studio/solo?id=saved-report');
  await studio.until(() => studio.button('Save report'));
  await studio.setTitle('Updated title');
  const leaving = new studio.dom.window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaving);
  assert.equal(leaving.defaultPrevented, true);
  await studio.click('Back to reports');
  assert.ok(studio.button('Keep editing'));
  assert.ok(document.body.textContent.includes('Unsaved report changes'));
  await studio.click('Keep editing');
  assert.equal(studio.titleInput().value, 'Updated title');
});

test('double Save creates one report and preserves edits made while the write is pending', async () => {
  await studio.mount();
  await studio.until(() => studio.button('Save report'));
  await studio.setTitle('First version');
  let finishWrite;
  studio.state.writeGate = new Promise(resolve => { finishWrite = resolve; });
  const save = studio.button('Save report');
  await act(async () => {
    save.dispatchEvent(new studio.dom.window.MouseEvent('click', { bubbles: true }));
    save.dispatchEvent(new studio.dom.window.MouseEvent('click', { bubbles: true }));
  });
  await studio.until(() => studio.state.writes.length === 1);
  await studio.setTitle('Newer unsaved version');
  await act(async () => { finishWrite(); });
  await studio.until(() => studio.button('Save report') && !studio.button('Save report').disabled);
  assert.equal(studio.state.writes.length, 1);
  assert.equal(studio.state.reports.get('created-report').title, 'First version');
  assert.equal(studio.titleInput().value, 'Newer unsaved version');
  assert.equal(studio.state.reads.includes('created-report'), false, 'the new ID must not reload and erase the editor');
  await studio.click('Back to reports');
  assert.ok(studio.button('Keep editing'));
});

test('failed report loads show recovery actions and a successful retry restores the editor', async () => {
  studio.state.readError = { message: 'Report lookup failed' };
  await studio.mount('/insights-studio/solo?id=saved-report');
  await studio.until(() => studio.button('Try again'));
  assert.equal(studio.button('Save report'), undefined);
  assert.ok(studio.button('Back to reports'));
  studio.state.readError = null;
  studio.state.reports.set('saved-report', studio.report());
  await studio.click('Try again');
  await studio.until(() => studio.button('Save report'));
  assert.equal(studio.titleInput().value, 'Original title');
});

test('writes without a confirmed saved row cannot display a false Saved state', async () => {
  await studio.mount();
  await studio.until(() => studio.button('Save report'));
  studio.state.noSavedRow = true;
  await studio.click('Save report');
  await studio.until(() => studio.state.alerts.length > 0);
  assert.equal(studio.isSaved(), false);
  assert.ok(studio.state.alerts.some(message => message.includes('Couldn’t save')));
});

test('legacy user-role accounts cannot enter the new-report editor', async () => {
  studio.state.role = 'user';
  await studio.mount();
  await studio.until(() => document.body.textContent.includes('Reports landing'));
  assert.equal(studio.button('Save report'), undefined);
});

test('a text draft without blur still protects browser-close navigation', async () => {
  const report = studio.report();
  report.layout_data.elements = [{ id: 'note', type: 'text', x: 48, y: 192, width: 250, height: 120,
    content: 'Original note', html: 'Original note', style: { fontSize: '16px' } }];
  studio.state.reports.set(report.id, report);
  await studio.mount('/insights-studio/solo?id=saved-report');
  await studio.until(() => document.querySelector('[data-text-element-id="note"]'));
  const note = document.querySelector('[data-text-element-id="note"]');
  await act(async () => {
    note.innerHTML = '<b>Uncommitted text</b>';
    note.dispatchEvent(new studio.dom.window.Event('input', { bubbles: true }));
  });
  const leaving = new studio.dom.window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaving);
  assert.equal(leaving.defaultPrevented, true);

  await act(async () => {
    note.innerHTML = '';
    note.dispatchEvent(new studio.dom.window.Event('input', { bubbles: true }));
  });
  const cleared = new studio.dom.window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(cleared);
  assert.equal(cleared.defaultPrevented, true, 'clearing the entire text also remains an unsaved edit');
});

test('a corrupt saved layout cannot open as a blank editable report', async () => {
  studio.state.reports.set('saved-report', studio.report({ layout_data: { broken: true } }));
  await studio.mount('/insights-studio/solo?id=saved-report');
  await studio.until(() => studio.button('Try again'));
  assert.equal(studio.button('Save report'), undefined);
  assert.equal(studio.state.writes.length, 0);
});

test('legacy comparison layouts open in the correct editor and preserve the return tab', async () => {
  studio.state.reports.set('saved-report', studio.report({ layout_data: [
    { id: 'chart', type: 'chart', x: 48, y: 192, style: {}, comparisonSelections: { roomId: 'room-2' } },
  ] }));
  await studio.mount('/insights-studio/solo?id=saved-report&fromTab=shared');
  await studio.until(() => studio.button('Save report'));
  const location = document.querySelector('[data-location]').textContent;
  assert.ok(location.startsWith('/insights-studio/comparison?'));
  assert.ok(location.includes('fromTab=shared'));
});

test('a failed role lookup offers retry instead of silently treating an editor as a viewer', async () => {
  studio.state.profileError = { message: 'Temporary role lookup failure' };
  await studio.mount();
  await studio.until(() => studio.button('Try again'));
  assert.equal(studio.button('Save report'), undefined);
  studio.state.profileError = null;
  await studio.click('Try again');
  await studio.until(() => studio.button('Save report'));
});

test('changing sharing access does not clear an unsaved title edit', async () => {
  const report = studio.report();
  report.layout_data.reportSettings.sharedWith = ['reader@example.test'];
  report.layout_data.reportSettings.sharedAccess = { 'reader@example.test': 'editor' };
  studio.state.reports.set(report.id, report);
  await studio.mount('/insights-studio/solo?id=saved-report');
  await studio.until(() => studio.button('Save report'));
  await studio.setTitle('Unsaved title');
  await studio.click('Share report');
  const access = document.querySelector('select[aria-label="Access for reader@example.test"]');
  assert.ok(access);
  await act(async () => {
    access.value = 'viewer';
    access.dispatchEvent(new studio.dom.window.Event('change', { bubbles: true }));
  });
  await studio.until(() => document.body.textContent.includes('Access updated.'));
  assert.equal(studio.state.rpcCalls.length, 1);
  const leaving = new studio.dom.window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaving);
  assert.equal(leaving.defaultPrevented, true);
});

test('export cannot capture loading charts as a completed PDF', async () => {
  const report = studio.report();
  report.layout_data.selections = { areaId: 'ucsd' };
  report.layout_data.elements = [{ id: 'chart', type: 'chart', x: 48, y: 192, width: 720, height: 480, timeType: 'weekly', chartType: 'line', style: {} }];
  studio.state.widgetsLoading = true;
  studio.state.reports.set(report.id, report);
  await studio.mount('/insights-studio/solo?id=saved-report');
  await studio.until(() => document.querySelector('[data-report-loading="true"]'));
  await studio.click('Preview export');
  const originalNow = Date.now;
  let clock = originalNow();
  Date.now = () => { clock += 9000; return clock; };
  try {
    await studio.click('Download PDF');
    await studio.until(() => studio.state.alerts.length > 0);
    assert.equal(studio.state.captures.length, 0);
    assert.equal(studio.state.pdfs.length, 0);
  } finally {
    Date.now = originalNow;
  }
});


test('browser Back offers Keep editing and Leave without saving', async () => {
  studio.state.reports.set('saved-report', studio.report());
  await studio.mount('/insights-studio/solo?id=saved-report');
  await studio.until(() => studio.button('Save report'));
  await studio.setTitle('Unsaved edit');
  await studio.navigate(-1);
  assert.ok(studio.button('Keep editing'));
  await studio.click('Keep editing');
  assert.equal(studio.titleInput().value, 'Unsaved edit');
  await studio.navigate(-1);
  await studio.click('Leave without saving');
  await studio.until(() => document.body.textContent.includes('Reports landing'));
  assert.equal(studio.state.writes.length, 0);
});

test('Save and leave after browser Back creates exactly one report and completes navigation', async () => {
  await studio.mount();
  await studio.until(() => studio.button('Save report'));
  await studio.setTitle('Save before leaving');
  await studio.navigate(-1);
  await studio.click('Save and leave');
  await studio.until(() => document.body.textContent.includes('Reports landing'));
  assert.equal(studio.state.writes.length, 1);
  assert.equal(studio.state.reports.get('created-report').title, 'Save before leaving');
  assert.equal(document.querySelector('[data-location]').textContent, '/insights-studio');
});

test('a failed Save and leave keeps the report open with its edits intact', async () => {
  await studio.mount();
  await studio.until(() => studio.button('Save report'));
  await studio.setTitle('Keep this edit');
  studio.state.writeError = { message: 'Write denied' };
  await studio.navigate(-1);
  await studio.click('Save and leave');
  await studio.until(() => studio.state.alerts.length > 0 && studio.button('Save report'));
  assert.equal(studio.titleInput().value, 'Keep this edit');
  assert.ok(document.querySelector('[data-location]').textContent.startsWith('/insights-studio/solo'));
  await studio.navigate(-1);
  assert.ok(studio.button('Keep editing'));
});

test('saving a new report replaces its URL and browser Back returns to reports', async () => {
  await studio.mount();
  await studio.until(() => studio.button('Save report'));
  await studio.click('Save report');
  await studio.until(() => studio.isSaved());
  assert.ok(document.querySelector('[data-location]').textContent.includes('id=created-report'));
  await studio.navigate(-1);
  await studio.until(() => document.body.textContent.includes('Reports landing'));
  assert.equal(studio.button('Keep editing'), undefined);
});

test('navigation between reports on the same editor route loads the requested report', async () => {
  studio.state.reports.set('saved-report', studio.report());
  studio.state.reports.set('second-report', studio.report({ id: 'second-report', title: 'Second report' }));
  await studio.mount('/insights-studio/solo?id=saved-report');
  await studio.until(() => studio.button('Save report'));
  await studio.navigate('/insights-studio/solo?id=second-report');
  await studio.until(() => studio.button('Save report') && studio.titleInput().value === 'Second report');
  await studio.setTitle('Second report edited');
  await studio.click('Save report');
  await studio.until(() => studio.isSaved());
  assert.equal(studio.state.reports.get('second-report').title, 'Second report edited');
  assert.equal(studio.state.reports.get('saved-report').title, 'Original title');
});


test('switching reports while a save finishes cannot overwrite the next editor', async () => {
  studio.state.reports.set('second-report', studio.report({ id: 'second-report', title: 'Second report' }));
  await studio.mount();
  await studio.until(() => studio.button('Save report'));
  await studio.setTitle('First report being saved');
  let finishWrite;
  studio.state.writeGate = new Promise(resolve => { finishWrite = resolve; });
  await studio.click('Save report');
  await studio.until(() => studio.state.writes.length === 1);
  await studio.navigate('/insights-studio/solo?id=second-report');
  await studio.click('Leave without saving');
  await act(async () => { finishWrite(); });
  await studio.until(() => studio.button('Save report') && studio.titleInput().value === 'Second report');
  assert.equal(studio.state.reports.get('created-report').title, 'First report being saved');
  assert.ok(document.querySelector('[data-location]').textContent.includes('id=second-report'));
  assert.equal(studio.state.writes.length, 1);
});

test('returning from a saved report to a new blank report resets the editor', async () => {
  studio.state.reports.set('saved-report', studio.report());
  await studio.mount('/insights-studio/solo?id=saved-report');
  await studio.until(() => studio.button('Save report'));
  await studio.navigate('/insights-studio/solo?template=blank');
  await studio.until(() => studio.button('Save report') && studio.titleInput().value !== 'Original title');
  await studio.setTitle('Brand new report');
  await studio.click('Save report');
  await studio.until(() => studio.isSaved());
  assert.equal(studio.state.writes.length, 1);
  assert.equal(studio.state.reports.get('created-report').title, 'Brand new report');
  assert.equal(studio.state.reports.get('saved-report').title, 'Original title');
});


test('Save and leave cannot discard edits that arrived during an earlier save', async () => {
  await studio.mount();
  await studio.until(() => studio.button('Save report'));
  await studio.setTitle('Version sent to storage');
  let finishWrite;
  studio.state.writeGate = new Promise(resolve => { finishWrite = resolve; });
  await studio.click('Save report');
  await studio.until(() => studio.state.writes.length === 1);
  await studio.setTitle('Newer edit must stay');
  await studio.navigate(-1);
  await studio.click('Save and leave');
  await act(async () => { finishWrite(); });
  await studio.until(() => studio.button('Save report') && !studio.button('Save report').disabled);
  assert.equal(studio.titleInput().value, 'Newer edit must stay');
  assert.equal(studio.state.reports.get('created-report').title, 'Version sent to storage');
  assert.ok(document.querySelector('[data-location]').textContent.includes('id=created-report'));
  await studio.navigate(-1);
  assert.ok(studio.button('Keep editing'));
});


test('the workspace edits the decision question and saves it with the report', async () => {
  await studio.mount();
  await studio.until(() => studio.button('Report details'));
  await studio.click('Report details');
  const input = [...document.querySelectorAll('textarea')].find(node => node.parentElement.textContent.startsWith('Decision question'));
  assert.ok(input);
  await act(async () => {
    Object.getOwnPropertyDescriptor(studio.dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'Should we change operating hours?');
    input.dispatchEvent(new studio.dom.window.Event('input', { bubbles: true }));
  });
  await studio.click('Close');
  await studio.click('Save report');
  await studio.until(() => studio.isSaved());
  assert.equal(studio.state.reports.get('created-report').layout_data.reportSettings.decisionQuestion, 'Should we change operating hours?');
});

test('report review saves the current document before sending the reviewer command', async () => {
  studio.state.reports.set('saved-report', studio.report());
  await studio.mount('/insights-studio/solo?id=saved-report');
  await studio.until(() => studio.button('Report details'));
  await studio.setTitle('Current decision');
  await studio.click('Report details');
  await studio.click('Review');
  await studio.until(() => studio.button('Save and request review'));
  const select = [...document.querySelectorAll('select')].find(node => node.parentElement.textContent.startsWith('Reviewer'));
  await act(async () => { select.value = 'editor'; select.dispatchEvent(new studio.dom.window.Event('change', { bubbles: true })); });
  await studio.click('Save and request review');
  await studio.until(() => studio.state.rpcCalls.some(call => call.payload.p_command === 'submit'));
  assert.equal(studio.state.reports.get('saved-report').title, 'Current decision');
  assert.equal(studio.state.rpcCalls.find(call => call.payload.p_command === 'submit').payload.p_payload.reviewer_id, 'editor');
});

test('a saved version opens its frozen metadata with save controls disabled', async () => {
  studio.state.reports.set('saved-report', studio.report({ title: 'Newer working title' }));
  studio.state.versions = new Map([['frozen-version', { id: 'frozen-version', report_id: 'saved-report', snapshot: {
    title: 'Reviewed title', author: 'Reviewer', date: 'November 1', period: 'Previous analysis', layout_data: studio.report().layout_data,
  } }]]);
  await studio.mount('/insights-studio/solo?id=saved-report&version=frozen-version');
  await studio.until(() => studio.button('Return to draft'));
  assert.ok(document.body.textContent.includes('Reviewed title'));
  assert.equal(studio.button('Save report'), undefined);
  await studio.click('Return to draft');
  await studio.until(() => studio.button('Save report') && !studio.button('Save report').disabled);
  assert.equal(studio.titleInput().value, 'Newer working title');
});

test('a workflow connection failure offers recovery while leaving the report usable', async () => {
  studio.state.reports.set('saved-report', studio.report());
  studio.state.workspaceError = { code: 'PGRST202', message: 'Missing function' };
  await studio.mount('/insights-studio/solo?id=saved-report');
  await studio.until(() => studio.button('Report details'));
  await studio.click('Report details');
  await studio.until(() => document.body.textContent.includes('database update'));
  await studio.click('Close');
  assert.ok(studio.button('Save report'));
});


test('rapid repeated comments create one command with the chosen chart and version', async () => {
  studio.state.reports.set('saved-report', studio.report());
  await studio.mount('/insights-studio/solo?id=saved-report');
  await studio.until(() => studio.button('Report details'));
  await studio.click('Report details');
  await studio.click('Comments');
  await studio.until(() => studio.button('Add comment'));
  const comment = [...document.querySelectorAll('textarea')].find(node => node.parentElement.textContent.startsWith('Comment'));
  await act(async () => {
    Object.getOwnPropertyDescriptor(studio.dom.window.HTMLTextAreaElement.prototype, 'value').set.call(comment, 'Investigate the morning peak.');
    comment.dispatchEvent(new studio.dom.window.Event('input', { bubbles: true }));
  });
  const add = studio.button('Add comment');
  await act(async () => {
    add.dispatchEvent(new studio.dom.window.MouseEvent('click', { bubbles: true }));
    add.dispatchEvent(new studio.dom.window.MouseEvent('click', { bubbles: true }));
  });
  await studio.until(() => studio.state.rpcCalls.some(call => call.payload.p_command === 'comment'));
  assert.equal(studio.state.rpcCalls.filter(call => call.payload.p_command === 'comment').length, 1);
  assert.equal(studio.state.rpcCalls.find(call => call.payload.p_command === 'comment').payload.p_payload.body, 'Investigate the morning peak.');
});


test('the comments icon opens Comments directly and keeps it selected after the first save', async () => {
  await studio.mount();
  await studio.until(() => studio.button('Comments'));
  await studio.click('Comments');
  assert.equal(studio.button('Comments').getAttribute('aria-selected'), 'true');
  assert.ok(document.body.textContent.includes('Save this report to add comments'));
  assert.equal(document.activeElement, studio.button('Close'), 'focus skips the disabled refresh button');
  await studio.click('Save report');
  await studio.until(() => studio.button('Add comment'));
  assert.equal(studio.button('Comments').getAttribute('aria-selected'), 'true');
  assert.ok(document.querySelector('[role="tabpanel"] textarea'));
  assert.equal(studio.state.writes.length, 1);
});

test('report detail tabs support keyboard navigation and expose Comments', async () => {
  studio.state.reports.set('saved-report', studio.report());
  await studio.mount('/insights-studio/solo?id=saved-report');
  await studio.until(() => studio.button('Report details'));
  await studio.click('Report details');
  const selected = () => document.querySelector('[role="tab"][aria-selected="true"]');
  assert.equal(selected().textContent.trim(), 'Data');
  await act(async () => {
    selected().focus();
    selected().dispatchEvent(new studio.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  assert.equal(selected().textContent.trim(), 'Review');
  assert.equal(document.activeElement, selected());
  await act(async () => selected().dispatchEvent(new studio.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  assert.equal(selected().textContent.trim(), 'Comments');
  await studio.until(() => studio.button('Add comment'));
  await act(async () => selected().dispatchEvent(new studio.dom.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
  assert.equal(selected().textContent.trim(), 'Data');
});

test('toolbar dimensions stay fixed while saving and the details panel is above the editor', async () => {
  const styles = document.createElement('style');
  styles.textContent = (await Promise.all(['InsightsStudio.module.css','ReportWorkspace.module.css'].map(file => readFile(new URL(file, import.meta.url), 'utf8')))).join('\n');
  document.head.append(styles);
  try {
    await studio.mount();
    await studio.until(() => studio.button('Save report'));
    const save = studio.button('Save report');
    const width = window.getComputedStyle(save).width;
    const pill = document.querySelector('.collaborationPill');
    const pillWidth = window.getComputedStyle(pill).width;
    assert.match(width, /^\d+px$/, 'save must have an explicit icon width rather than depend on label length');
    assert.equal(save.textContent.trim(), '');
    let finish;
    studio.state.writeGate = new Promise(resolve => { finish = resolve; });
    await studio.click('Save report');
    await studio.until(() => studio.state.writes.length === 1);
    assert.equal(save.getAttribute('data-save-state'), 'saving');
    assert.equal(window.getComputedStyle(save).width, width);
    await act(async () => { finish(); });
    await studio.until(() => studio.isSaved());
    assert.equal(window.getComputedStyle(save).width, width);
    assert.equal(window.getComputedStyle(pill).width, pillWidth);
    await studio.click('Report details');
    const dialog = document.querySelector('[role="dialog"]');
    const overlay = dialog.parentElement;
    const editor = document.querySelector('.builderPage');
    assert.equal(overlay.parentElement, document.body);
    assert.ok(Number(window.getComputedStyle(overlay).zIndex) > Number(window.getComputedStyle(editor).zIndex));
    const tabs = dialog.querySelector('[role="tablist"]');
    assert.equal(window.getComputedStyle(tabs).flexShrink, '0');
    assert.equal(dialog.querySelector('[role="tabpanel"]').contains(tabs), false, 'tabs stay outside the scrolling content');
  } finally { styles.remove(); }
});

test('old generated data pages disappear while their sources remain in Report details', async () => {
  const report = studio.report({ layout_data: {
    version: 2, mode: 'solo', pageCount: 2, selections: {}, comparisonSelections: {}, reportSettings: { showCoverPage: false },
    elements: [
      { id: 'my-note', type: 'text', x: 48, y: 200, width: 700, height: 100, html: 'A written finding', style: {} },
      { id: 'chart', type: 'chart', chartType: 'line', x: 48, y: 350, width: 700, height: 500, style: {}, snapshotData: [{ timestamp: '2026-11-09T00:00:00Z', value: 10 }], dataEvidence: { sources: ['test_measurements'], timezone: 'UTC' } },
      { id: 'report-data-notes', type: 'data-notes', x: 48, y: 1392, width: 700, height: 840, style: {} },
    ],
  } });
  const original = structuredClone(report);
  studio.state.reports.set(report.id, report);
  await studio.mount('/insights-studio/solo?id=saved-report');
  await studio.until(() => studio.button('Report details'));
  assert.equal(document.body.textContent.includes('Page 2'), false);
  assert.ok(document.body.textContent.includes('A written finding'));
  assert.equal(studio.state.writes.length, 0, 'opening an old layout must not rewrite the database');
  assert.deepEqual(report, original);
  await studio.click('Report details');
  assert.ok(document.querySelector('[role="dialog"]').textContent.includes('test_measurements'));
  assert.equal(studio.button('Include data notes in report'), undefined);
  await studio.click('Close');
  await studio.setTitle('Updated finding');
  await studio.click('Save report');
  await studio.until(() => studio.isSaved());
  const saved = studio.state.reports.get(report.id).layout_data;
  assert.equal(saved.pageCount, 1);
  assert.deepEqual(saved.elements.map(element => element.id), ['my-note', 'chart']);
  assert.deepEqual(saved.elements.find(element => element.id === 'chart').dataEvidence, original.layout_data.elements[1].dataEvidence);
});
