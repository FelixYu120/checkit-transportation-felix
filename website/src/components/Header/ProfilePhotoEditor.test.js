import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { transformWithEsbuild } from 'vite';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const original = { Image: globalThis.Image, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
const fixture = { revoked: [], saved: [], canceled: 0, decodeError: null, gate: null };
URL.createObjectURL = () => 'blob:local-profile-preview';
URL.revokeObjectURL = url => fixture.revoked.push(url);
globalThis.Image = class {
  naturalWidth = 1200; naturalHeight = 800;
  async decode() { if (fixture.gate) await fixture.gate; if (fixture.decodeError) throw fixture.decodeError; }
};
const reactUrl = import.meta.resolve('react');
const transformed = await transformWithEsbuild(await readFile(new URL('./ProfilePhotoEditor.jsx', import.meta.url), 'utf8'), 'ProfilePhotoEditor.jsx', { loader: 'jsx', jsx: 'transform' });
const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const code = transformed.code.replace(/from "react"/g, `from ${JSON.stringify(reactUrl)}`)
  .replace(/from "\.\/ProfilePhoto.js"/g, `from ${JSON.stringify(new URL('./ProfilePhoto.js', import.meta.url).href)}`)
  .replace(/from "\.\/ProfileModal.module.css"/g, `from ${JSON.stringify(asModule('export default new Proxy({}, {get:(_,key)=>String(key)});'))}`);
const { default: Editor } = await import(asModule(code));
const { createRoot } = await import('react-dom/client');
const file = new dom.window.File(['photo'], 'profile.png', { type: 'image/png' });
let root;
const props = busy => ({ file, busy, onSave: crop => fixture.saved.push(crop), onCancel: () => fixture.canceled++ });
const mount = async () => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Editor, props(false))));
};
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent === text);
const setZoom = async value => act(async () => {
  const input = document.querySelector('[aria-label="Photo zoom"]');
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, String(value));
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
});
const pointer = async (type, x, y, pointerId = 1) => act(async () => {
  const preview = document.querySelector('.cropPreview');
  preview.getBoundingClientRect = () => ({ width: 200, height: 200 });
  const event = new dom.window.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  preview.dispatchEvent(event);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  Object.assign(fixture, { revoked: [], saved: [], canceled: 0, decodeError: null, gate: null });
});
after(() => { globalThis.Image = original.Image; URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke; dom.window.close(); });

test('photo zoom changes the preview crop and the saved selection', async () => {
  await mount();
  assert.equal(document.querySelector('.cropPreview img').style.width, '150%');
  await setZoom(2);
  assert.equal(document.querySelector('.cropPreview img').style.width, '300%');
  await act(async () => button('Save photo').click());
  assert.deepEqual(fixture.saved, [{ zoom: 2, offsetX: 0.5, offsetY: 0.5 }]);
});

test('dragging repositions the image, stays inside its bounds, and saves that crop', async () => {
  await mount();
  await setZoom(2);
  await pointer('pointerdown', 100, 100);
  await pointer('pointermove', 150, 100);
  await pointer('pointerup', 150, 100);
  await act(async () => button('Save photo').click());
  assert.equal(fixture.saved[0].offsetX, 0.375);
  assert.equal(fixture.saved[0].offsetY, 0.5);
  await pointer('pointerdown', 100, 100);
  await pointer('pointermove', 10000, 10000);
  await pointer('pointerup', 10000, 10000);
  await act(async () => button('Save photo').click());
  assert.equal(fixture.saved[1].offsetX, 0);
  assert.equal(fixture.saved[1].offsetY, 0);
});

test('two fingers zoom the circular crop and continue panning when one finger lifts', async () => {
  await mount();
  assert.ok(document.querySelector('[aria-label="Circular photo crop preview"]'));
  await pointer('pointerdown',50,100,1);
  await pointer('pointerdown',150,100,2);
  await pointer('pointermove',200,100,2);
  assert.equal(document.querySelector('[aria-label="Photo zoom"]').value,'1.5');
  await pointer('pointermove',0,100,1);
  assert.equal(document.querySelector('[aria-label="Photo zoom"]').value,'2');
  await pointer('pointerup',200,100,2);
  await pointer('pointermove',20,100,1);
  await pointer('pointerup',20,100,1);
  await act(async()=>button('Save photo').click());
  assert.equal(fixture.saved[0].zoom,2);
  assert.ok(Math.abs(fixture.saved[0].offsetX-0.45)<0.0001);
});

test('keyboard positioning works and a canceled pointer gesture restores its starting position', async () => {
  await mount();
  await setZoom(2);
  await pointer('pointerdown', 100, 100);
  await pointer('pointermove', 150, 100);
  await pointer('pointercancel', 150, 100);
  await act(async () => document.querySelector('.cropPreview').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
  await act(async () => button('Save photo').click());
  assert.equal(fixture.saved[0].offsetX, 0.47);
});

test('busy uploads disable crop actions and canceling never saves a selection', async () => {
  await mount();
  await act(async () => root.render(React.createElement(Editor, props(true))));
  assert.equal(document.querySelector('[aria-label="Photo zoom"]').disabled, true);
  assert.equal(button('Cancel').disabled, true);
  assert.ok([...document.querySelectorAll('button')].every(item => item.disabled));
  await act(async () => root.render(React.createElement(Editor, props(false))));
  await act(async () => button('Cancel').click());
  assert.equal(fixture.canceled, 1);
  assert.deepEqual(fixture.saved, []);
});

test('closing the editor releases its private temporary image URL', async () => {
  await mount();
  await act(async () => root.unmount()); root = null;
  assert.deepEqual(fixture.revoked, ['blob:local-profile-preview']);
});

test('unreadable images cannot be saved and allow cancellation', async () => {
  fixture.decodeError = new Error('Corrupt image');
  await mount();
  assert.ok(document.querySelector('[role="alert"]'));
  assert.equal(button('Save photo').disabled, true);
  assert.equal(button('Cancel').disabled, false);
  assert.equal(document.querySelector('.cropPreview'), null);
});
