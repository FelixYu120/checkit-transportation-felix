import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { createReportHtmlSanitizer } from './ReportHtml.js';

const dom = new JSDOM('');
const sanitize = createReportHtmlSanitizer(createDOMPurify(dom.window));
after(() => dom.window.close());

test('stored and pasted report text cannot retain scripts, event handlers, or JavaScript links', () => {
  const clean = sanitize('<p>Notes</p><script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">Link</a><svg onload="alert(4)"></svg>');
  const container = dom.window.document.createElement('div');
  container.innerHTML = clean;
  assert.equal(container.querySelector('script, svg'), null);
  assert.equal(container.querySelector('img').hasAttribute('onerror'), false);
  assert.equal(container.querySelector('a').hasAttribute('href'), false);
  assert.ok(container.textContent.includes('Notes'));
});

test('rich-text formatting and ordinary links survive sanitization', () => {
  const html = '<p><strong>Summary</strong> <em>notes</em><span style="color: rgb(52, 82, 77); font-size: 18px;"> detail</span><a href="https://example.test/report">Reference</a></p>';
  const clean = sanitize(html);
  const container = dom.window.document.createElement('div');
  container.innerHTML = clean;
  assert.equal(container.querySelector('strong').textContent, 'Summary');
  assert.equal(container.querySelector('em').textContent, 'notes');
  assert.equal(container.querySelector('span').style.fontSize, '18px');
  assert.equal(container.querySelector('a').href, 'https://example.test/report');
  assert.equal(sanitize(html), clean);
});

test('pasted content cannot insert editor controls, stylesheets, or fake widget IDs', () => {
  const container = dom.window.document.createElement('div');
  container.innerHTML = sanitize('<style>body{display:none}</style><form><input name="id"></form><p data-text-element-id="other-widget">Text</p><iframe src="https://example.test"></iframe>');
  assert.equal(container.querySelector('style, form, input, iframe'), null);
  assert.equal(container.querySelector('[data-text-element-id]'), null);
  assert.ok(container.textContent.includes('Text'));
});

test('unsupported DOMs escape input instead of rendering unsanitized HTML', () => {
  const fallback = createReportHtmlSanitizer({ isSupported: false });
  assert.equal(fallback('<img onerror="run()">'), '&lt;img onerror=&quot;run()&quot;&gt;');
});
