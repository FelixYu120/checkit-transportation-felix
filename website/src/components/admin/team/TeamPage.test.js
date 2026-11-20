import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { transformWithEsbuild } from "vite";

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: "https://example.test" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
const fixture = globalThis.__checkitTeamTest = {};
const reset = () => Object.assign(fixture, {
  currentUserId: "owner", currentUserRole: "admin", loads: 0, removeCalls: [], removalGate: null, removeError: null, failRefresh: false,
  inviteCalls: [], inviteResult: {ok:true}, inviteError: null, inviteGate: null,
  members: [
    { id: "owner", full_name: "Team Owner", email: "owner@example.test", role: "admin", assigned_institute: "institute-a" },
    { id: "member", full_name: "Emily Thompson", email: "emily@example.test", role: "viewer", assigned_institute: "institute-a" },
    { id: "protected", full_name: "Another Admin", email: "admin@example.test", role: "admin", assigned_institute: "institute-a" },
  ],
});
reset();
const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const source = await readFile(new URL("./TeamPage.jsx", import.meta.url), "utf8");
const transformed = await transformWithEsbuild(source, "TeamPage.jsx", { loader: "jsx", jsx: "transform" });
const reactUrl = import.meta.resolve("react");
const code = transformed.code.replace(/(^import\s+([\s\S]*?)\s+from\s*)(["'])([^"']+)\3/gm, (match, prefix, clause, quote, specifier) => {
  let target;
  if (specifier === "react") target = reactUrl;
  else if (specifier === "lucide-react") {
    const names = clause.match(/\{([\s\S]*?)\}/)[1].split(",").map(name => name.trim()).filter(Boolean);
    target = asModule(`import React from ${JSON.stringify(reactUrl)};\n` + names.map(name => `export const ${name}=()=>React.createElement('span',{'aria-hidden':true});`).join("\n"));
  } else if (specifier.endsWith(".css")) target = asModule("export default new Proxy({}, {get: (_, key)=>String(key)});");
  else if (specifier.includes("SupabaseClients")) target = asModule("export default {};");
  else if (specifier === "./TeamData") target = asModule(`
    const fixture=globalThis.__checkitTeamTest;
    export const fetchInstitutionTeamMembers=async()=>{
      fixture.loads++;
      if(fixture.failRefresh && fixture.loads>1) throw new Error('Directory refresh unavailable');
      return {...fixture, institutionId:'institute-a', members:fixture.members.filter(member=>member.assigned_institute)};
    };
    export const removeTeamMember=async(_client,id)=>{
      fixture.removeCalls.push(id);
      if(fixture.removalGate) await fixture.removalGate;
      if(fixture.removeError) throw fixture.removeError;
      fixture.members=fixture.members.map(member=>member.id===id?{...member,assigned_institute:null}:member);
    };
    export const inviteTeamMember=async(_client, invitation)=>{
      fixture.inviteCalls.push(invitation);
      if(fixture.inviteGate) await fixture.inviteGate;
      if(fixture.inviteError) throw fixture.inviteError;
      return fixture.inviteResult;
    };
  `);
  else throw new Error(`Unexpected import: ${specifier}`);
  return prefix + JSON.stringify(target);
});
const { default: TeamPage } = await import(asModule(code));
const { createRoot } = await import("react-dom/client");
let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; reset(); });
after(() => dom.window.close());
const until = async check => {
  for (let index = 0; index < 50; index++) {
    if (check()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  throw new Error("Team page did not settle");
};
const mount = async () => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(TeamPage)));
  await until(() => document.querySelectorAll(".memberCard").length === 3);
};
const click = async selector => {
  const button = document.querySelector(selector);
  assert.ok(button, `Missing ${selector}`);
  await act(async () => button.click());
};
const enterName = async value => act(async () => {
  const input = document.getElementById("team-remove-name");
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
});
const submit = async () => act(async () => document.querySelector(".removalDialog form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));

test("removal from member details waits for confirmation and updates the directory without a second fetch", async () => {
  await mount();
  fixture.failRefresh = true;
  let release;
  fixture.removalGate = new Promise(resolve => { release = resolve; });
  try {
    await click('[aria-label="View details for Emily Thompson"]');
    await click(".removeFromProfileButton");
    assert.equal(document.querySelector(".memberDetailsDialog"), null);
    assert.ok(document.querySelector(".removalDialog[open]"));
    await enterName("Emily");
    assert.equal(document.querySelector('.removalDialog [type="submit"]').disabled, true);
    await enterName(" Emily Thompson ");
    assert.equal(document.querySelector('.removalDialog [type="submit"]').disabled, false);
    await submit();
    assert.equal(document.querySelectorAll(".memberCard").length, 3, "membership remains until the server confirms removal");
    assert.equal(document.querySelector('.removalDialog [type="submit"]').disabled, true);
    await act(async () => release());
    await until(() => document.querySelector(".removalDialog") === null);
    assert.equal(document.querySelectorAll(".memberCard").length, 2);
    assert.equal(fixture.loads, 1, "a failed directory refresh cannot undo confirmed removal");
    assert.deepEqual(fixture.removeCalls, ["member"]);
    assert.match(document.querySelector('[role="status"]').textContent, /Emily Thompson was removed/);
  } finally { release(); }
});

test("a rejected removal keeps the member and shows the backend error", async () => {
  await mount();
  fixture.removeError = new Error("This member is still assigned to the team.");
  await click('[aria-label="Remove Emily Thompson from team"]');
  await enterName("Emily Thompson");
  await submit();
  assert.equal(document.querySelectorAll(".memberCard").length, 3);
  assert.ok(document.querySelector(".removalDialog[open]"));
  assert.match(document.querySelector('[role="alert"]').textContent, /still assigned/);
  assert.equal(document.querySelector('[role="status"]'), null);
  assert.equal(document.querySelector('.removalDialog [type="submit"]').disabled, false);
});

test("self-removal and protected admin removal remain unavailable", async () => {
  await mount();
  assert.equal(document.querySelector('[aria-label="Remove Team Owner from team"]'), null);
  assert.equal(document.querySelector('[aria-label="Remove Another Admin from team"]'), null);
  await click('[aria-label="View details for Another Admin"]');
  assert.equal(document.querySelector(".removeFromProfileButton"), null);
});

for (const targetRole of ["admin", "checkit_admin", "checkit_field_operator"]) test(`CheckIt admins can remove a ${targetRole} through member details`, async () => {
  fixture.currentUserRole = "checkit_admin";
  fixture.members[0].role = "checkit_admin";
  fixture.members[2].role = targetRole;
  await mount();
  assert.equal(document.querySelector('[aria-label="Remove Team Owner from team"]'), null);
  await click('[aria-label="View details for Another Admin"]');
  await click(".removeFromProfileButton");
  await enterName("Another Admin");
  await submit();
  await until(() => document.querySelector(".removalDialog") === null);
  assert.deepEqual(fixture.removeCalls, ["protected"]);
  assert.equal(document.querySelectorAll(".memberCard").length, 2);
});

const enterInviteEmail = async value => act(async () => {
  const input = document.querySelector('.inviteModal input[type="email"]');
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
});
const submitInvite = async () => act(async () => document.querySelector('.inviteModal').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));

test('a confirmed invitation shows success and leaves a usable dialog', async () => {
  await mount();
  await click('[aria-label="Invite member"]');
  await enterInviteEmail('New@Example.test');
  await submitInvite();
  assert.deepEqual(fixture.inviteCalls, [{ email: 'new@example.test', role: 'viewer' }]);
  assert.match(document.querySelector('.inviteModal [role="status"]').textContent, /Invite sent to new@example.test/);
  assert.equal(document.querySelector('.inviteModal input[type="email"]').value, '');
  assert.equal(document.querySelector('.inviteModal [role="alert"]'), null);
  await click('.inviteModal [aria-label="Close"]');
  assert.equal(document.querySelector('.inviteModal'), null);
});

for (const flag of ['restored', 'reactivated']) test(`restoring an existing account is clearly distinguished from sending email (${flag})`, async () => {
  fixture.inviteResult = { ok: true, [flag]: true };
  await mount();
  await click('[aria-label="Invite member"]');
  await enterInviteEmail('returning@example.test');
  await submitInvite();
  const message = document.querySelector('.inviteModal [role="status"]').textContent;
  assert.match(message, /Team access restored/);
  assert.match(message, /no new invitation email was sent/);
});

test('a directory refresh failure does not turn a delivered invitation into a sending failure', async () => {
  await mount();
  fixture.failRefresh = true;
  await click('[aria-label="Invite member"]');
  await enterInviteEmail('new@example.test');
  await submitInvite();
  assert.match(document.querySelector('.inviteModal [role="status"]').textContent, /Invite sent/);
  assert.match(document.querySelector('.inviteModal [role="alert"]').textContent, /invitation was successful.*team list could not be refreshed/i);
  assert.equal(fixture.inviteCalls.length, 1);
});

test('delivery errors keep the email available for retry and never show success', async () => {
  fixture.inviteError = new Error('Supabase admin configuration is missing.');
  await mount();
  await click('[aria-label="Invite member"]');
  await enterInviteEmail('new@example.test');
  await submitInvite();
  assert.equal(document.querySelector('.inviteModal input[type="email"]').value, 'new@example.test');
  assert.match(document.querySelector('.inviteModal [role="alert"]').textContent, /configuration is missing/);
  assert.equal(document.querySelector('.inviteModal [role="status"]'), null);
  assert.equal(fixture.loads, 1);
});

test('pending invitations cannot be submitted twice or closed mid-request', async () => {
  let release;
  fixture.inviteGate = new Promise(resolve => { release = resolve; });
  try {
    await mount();
    await click('[aria-label="Invite member"]');
    await enterInviteEmail('new@example.test');
    await submitInvite();
    await submitInvite();
    assert.equal(fixture.inviteCalls.length, 1);
    assert.ok(document.querySelector('.inviteModal input').disabled);
    await click('.inviteModal [aria-label="Close"]');
    assert.ok(document.querySelector('.inviteModal'));
    await act(async () => release());
    assert.match(document.querySelector('.inviteModal [role="status"]').textContent, /Invite sent/);
  } finally { release(); }
});
