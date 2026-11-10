import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { JSDOM } from 'jsdom';
import { transformWithEsbuild } from 'vite';
import React, { act } from 'react';

const asModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const account = { id: 'owner', email: 'owner@example.test' };

export async function createStudioHarness() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test' });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: callback => setTimeout(callback, 0),
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const state = { reports: new Map(), role: 'admin', reads: [], writes: [], alerts: [], captures: [], pdfs: [], rpcCalls: [], profileError: null };
  const originalConsoleError = console.error;
  console.error = (message, ...details) => {
    if (/^Failed to (open report:|save report:|capture export preview page|capture report:)/.test(String(message))) return;
    originalConsoleError(message, ...details);
  };
  globalThis.__checkitStudioFixture = state;
  globalThis.alert = message => state.alerts.push(message);

  state.supabase = {
    auth: { getUser: async () => ({ data: { user: account }, error: null }) },
    from(table) {
      let operation = 'read';
      let payload;
      const filters = {};
      const execute = async () => {
        if (table === 'profile') return { data: state.profileError ? null : { id: account.id, role: state.role }, error: state.profileError || null };
        if (table === 'insight_report_versions') return { data: state.versions?.get(filters.id), error: null };
        if (table !== 'saved_reports') return { data: table === 'areas' ? [{ id: 'ucsd', name: 'UC San Diego' }] : [], error: null };
        if (operation === 'read') {
          state.reads.push(filters.id);
          if (state.readError) return { data: null, error: state.readError };
          if (!filters.id) return { data: [...state.reports.values()], error: null };
          const data = state.reports.get(filters.id);
          return { data, error: data ? null : { message: 'Report not found' } };
        }
        state.writes.push({ operation, payload, id: filters.id });
        if (state.writeGate) await state.writeGate;
        if (state.writeError) return { data: null, error: state.writeError };
        if (state.noSavedRow) return { data: null, error: null };
        const id = filters.id || 'created-report';
        state.reports.set(id, { ...(state.reports.get(id) || {}), ...payload, id, owner_id: account.id });
        return { data: { id }, error: null };
      };
      const query = {
        select() { return query; },
        eq(key, value) { filters[key] = value; return query; },
        order() { return query; },
        in() { return query; },
        update(value) { operation = 'update'; payload = value; return query; },
        insert(value) { operation = 'insert'; payload = value[0]; return query; },
        single: execute, maybeSingle: execute,
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      return query;
    },
    channel() {
      const channel = {
        on() { return channel; }, subscribe() { return channel; },
        presenceState: () => ({}), track: async () => {}, untrack() {}, send() {},
      };
      return channel;
    },
    removeChannel: async () => {},
    rpc: async (name, payload) => {
      state.rpcCalls.push({ name, payload });
      if (name === 'insights_report_workspace') return { data: state.workspace || { workflow: { status: 'draft' }, versions: [], comments: [], actions: [], events: [], members: [{ id: 'owner', label: 'Owner' }, { id: 'editor', label: 'Editor' }], user_id: 'owner', can_edit: true, is_owner: true }, error: state.workspaceError || null };
      if (name === 'insights_report_command') return { data: { id: 'command-result' }, error: state.commandError || null };
      return { data: null, error: null };
    },
  };

  const source = await readFile(new URL('./InsightsStudio.jsx', import.meta.url), 'utf8');
  const transformed = await transformWithEsbuild(source, 'InsightsStudio.jsx', {
    loader: 'jsx', jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment',
  });
  const reactUrl = import.meta.resolve('react');
  const stubComponent = `import React from ${JSON.stringify(reactUrl)}; export default function Widget(){return React.createElement('div',{'data-report-loading':globalThis.__checkitStudioFixture.widgetsLoading?'true':'false'},'Widget');}`;
  const workspaceSource = await readFile(new URL('./ReportWorkspace.jsx', import.meta.url), 'utf8');
  const workspaceTransform = await transformWithEsbuild(workspaceSource, 'ReportWorkspace.jsx', { loader: 'jsx', jsx: 'transform' });
  const workspaceModule = asModule(workspaceTransform.code.replace(/(from\s*)['"]([^'"]+)['"]/g, (match, prefix, specifier) => {
    const target = specifier.endsWith('.css') ? asModule('export default new Proxy({}, {get:(_,key)=>String(key)});')
      : specifier.startsWith('.') ? new URL(specifier, import.meta.url).href : import.meta.resolve(specifier);
    return prefix + JSON.stringify(target);
  }));
  const code = transformed.code.replace(/(^import\s+([\s\S]*?)\s+from\s*)(["'])([^"']+)\3/gm, (match, prefix, clause, quote, specifier) => {
    let target;
    if (['react', 'react-dom', 'react-router-dom'].includes(specifier)) target = import.meta.resolve(specifier);
    else if (specifier === './ReportWorkspace.jsx') target = workspaceModule;
    else if (['./ReportSafety.js', './ReportHtml.js', './ReportEnterprise.js'].includes(specifier)) target = new URL(specifier, import.meta.url).href;
    else if (specifier.endsWith('.css')) target = asModule('export default new Proxy({}, {get: (_, name) => String(name)});');
    else if (specifier.includes('SupabaseClients')) target = asModule('export default globalThis.__checkitStudioFixture.supabase;');
    else if (specifier === 'html2canvas') target = asModule(`export default async function capture(node){globalThis.__checkitStudioFixture.captures.push(node);return {width:820,height:1200,toDataURL:()=> 'data:image/png;base64,test'};}`);
    else if (specifier === 'jspdf') target = asModule(`export class jsPDF{internal={pageSize:{getWidth:()=>210,getHeight:()=>297}};addPage(){}addImage(){}save(name){globalThis.__checkitStudioFixture.pdfs.push(name)}}`);
    else {
      const named = clause.match(/\{([\s\S]*?)\}/)?.[1].split(',').map(name => name.trim().split(/\s+as\s+/)[0]).filter(Boolean) || [];
      let stub = `import React from ${JSON.stringify(reactUrl)};\n`;
      if (/^\s*[A-Za-z_$]/.test(clause)) stub += stubComponent.replace(/^import[^;]+;/, '') + '\n';
      for (const name of named) {
        if (specifier === 'lucide-react') stub += `export const ${name}=()=>React.createElement('span',{'aria-hidden':true});\n`;
        else if (name === 'Rnd') stub += "export const Rnd=props=>React.createElement('div',{className:props.className,onDoubleClick:props.onDoubleClick},props.children);\n";
        else if (name === 'fetchSensorDirectory') stub += "export const fetchSensorDirectory=async()=>({institutes:[{institute_id:'ucsd',full_name:'UC San Diego'}],sensors:[]});\n";
        else if (name === 'fetchInstitutionTeamMembers') stub += 'export const fetchInstitutionTeamMembers=async()=>({members:[],currentUserId:"owner"});\n';
        else stub += `export const ${name}=[];\n`;
      }
      target = asModule(stub);
    }
    return prefix + JSON.stringify(target);
  });
  const { default: InsightsStudio, InsightBuilderPage } = await import(asModule(code));
  const { createRoot } = await import('react-dom/client');
  const { createMemoryRouter, RouterProvider, Routes, Route, useLocation } = await import('react-router-dom');
  let root;
  let router;
  const LocationProbe = () => { const location = useLocation(); return React.createElement('output', { 'data-location': true }, location.pathname + location.search); };
  const until = async (condition, message = 'Editor did not settle') => {
    for (let i = 0; i < 100; i++) {
      if (condition()) return;
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    }
    throw new Error(message);
  };
  const button = label => {
    const scope = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].at(-1) || document;
    return [...scope.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') || node.textContent.trim()) === label);
  };
  return {
    state, dom, until, button,
    isSaved: () => Boolean(document.querySelector('[aria-label="Save report"][data-save-state="saved"]')),
    report(overrides = {}) {
      return { id: 'saved-report', owner_id: account.id, title: 'Original title', author: 'Author', date: 'November 9', period: 'Last 7 Days',
        layout_data: { version: 2, mode: 'solo', pageCount: 1, elements: [], selections: {}, comparisonSelections: {}, reportSettings: { showCoverPage: false } }, ...overrides };
    },
    async mount(url = '/insights-studio/solo?template=blank', previous = '/insights-studio', { renderLanding = false } = {}) {
      document.body.innerHTML = '<div id="root"></div>';
      root = createRoot(document.getElementById('root'));
      await act(async () => {
        const editor = React.createElement(React.Fragment, null,
            React.createElement(LocationProbe),
            React.createElement(Routes, null,
              React.createElement(Route, { path: '/insights-studio/solo', element: React.createElement(InsightBuilderPage, { type: 'solo' }) }),
              React.createElement(Route, { path: '/insights-studio/comparison', element: React.createElement(InsightBuilderPage, { type: 'comparison' }) }),
              React.createElement(Route, { path: '/insights-studio', element: renderLanding ? React.createElement(InsightsStudio) : React.createElement('div', null, 'Reports landing') }),
            ),
          );
        router = createMemoryRouter([{ path: '*', element: editor }], { initialEntries: [previous, url], initialIndex: 1 });
        root.render(React.createElement(RouterProvider, { router }));
      });
    },
    async mountLanding(url = '/insights-studio') { await this.mount(url, '/previous', { renderLanding: true }); },
    async navigate(to) { await act(async () => { await router.navigate(to); }); },
    async click(label) {
      const node = button(label);
      if (!node) throw new Error('Missing button ' + label);
      await act(async () => { node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    },
    titleInput() {
      const label = [...document.querySelectorAll('label')].find(node => /^(report|document) title$/i.test(node.textContent.trim()));
      const input = label?.nextElementSibling;
      if (input?.tagName !== 'INPUT') throw new Error('Report title input not found');
      return input;
    },
    async setTitle(value) {
      const input = this.titleInput();
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    },
    async reset() {
      if (root) await act(async () => root.unmount());
      root = null;
      router?.dispose();
      router = null;
      Object.assign(state, { reports: new Map(), role: 'admin', reads: [], writes: [], alerts: [], captures: [], pdfs: [], rpcCalls: [], profileError: null, readError: null, writeError: null, noSavedRow: false, writeGate: null, widgetsLoading: false, workspace: null, workspaceError: null, commandError: null, versions: new Map() });
    },
    async close() { await this.reset(); dom.window.close(); console.error = originalConsoleError; },
  };
}
