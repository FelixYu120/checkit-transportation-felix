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
const avatarSource = await readFile(new URL("../../Header/ProfileAvatar.jsx", import.meta.url), "utf8");
const avatarTransform = await transformWithEsbuild(avatarSource, "ProfileAvatar.jsx", { loader: "jsx", jsx: "transform" });
const avatarModule = asModule(avatarTransform.code.replace(/from "react"/g, `from ${JSON.stringify(reactUrl)}`));
const code = transformed.code.replace(/(^import\s+([\s\S]*?)\s+from\s*)(["'])([^"']+)\3/gm, (match, prefix, clause, quote, specifier) => {
  let target;
  if (specifier === "react") target = reactUrl;
  else if (specifier === "lucide-react") {
    const names = clause.match(/\{([\s\S]*?)\}/)[1].split(",").map(name => name.trim()).filter(Boolean);
    target = asModule(`import React from ${JSON.stringify(reactUrl)};\n` + names.map(name => `export const ${name}=()=>React.createElement('span',{'aria-hidden':true});`).join("\n"));
  } else if (specifier.endsWith(".css")) target = asModule("export default new Proxy({}, {get: (_, key)=>String(key)});");
  else if (specifier.includes("SupabaseClients")) target = asModule("export default {};");
  else if (specifier === "../../Header/ProfileAvatar") target = avatarModule;
  else if (specifier === "../../Header/ProfilePhoto.js") target = import.meta.resolve("../../Header/ProfilePhoto.js");
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
      fixture.members=fixture.members.filter(member=>member.id!==id);
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

const mockRemovalTimers = () => {
  const originalSetTimeout = window.setTimeout;
  const originalClearTimeout = window.clearTimeout;
  const scheduled = new Map();
  let nextId = 0;
  window.setTimeout = (callback, delay, ...args) => {
    if (![3000, 240].includes(delay)) return originalSetTimeout.call(window, callback, delay, ...args);
    const id = `removal-message-${++nextId}`;
    scheduled.set(id, { callback, delay });
    return id;
  };
  window.clearTimeout = id => {
    if (scheduled.delete(id)) return;
    originalClearTimeout.call(window, id);
  };
  return {
    scheduled,
    async advance(delay) {
      const callbacks = [...scheduled].filter(([, timer]) => timer.delay === delay);
      assert.ok(callbacks.length, `Expected a ${delay}ms timer`);
      await act(async () => {
        for (const [id, timer] of callbacks) { scheduled.delete(id); timer.callback(); }
      });
    },
    restore() { window.setTimeout = originalSetTimeout; window.clearTimeout = originalClearTimeout; },
  };
};

test("removal from member details waits for confirmation and updates the directory without a second fetch", async () => {
  const timers = mockRemovalTimers();
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
    await backdropGesture('.removalDialog');
    assert.ok(document.querySelector('.removalDialog[open]'), 'a pending removal stays open');
    assert.equal(document.querySelectorAll(".memberCard").length, 3, "membership remains until the server confirms removal");
    assert.equal(document.querySelector('.removalDialog [type="submit"]').disabled, true);
    await act(async () => release());
    await until(() => document.querySelector(".removalDialog") === null);
    assert.equal(document.querySelectorAll(".memberCard").length, 2);
    assert.equal(fixture.loads, 1, "a failed directory refresh cannot undo confirmed removal");
    assert.deepEqual(fixture.removeCalls, ["member"]);
    assert.match(document.querySelector('[role="status"]').textContent, /Emily Thompson was removed\./);
    await click('[aria-label="Dismiss removal message"]');
    assert.ok(document.querySelector('.removalNoticeClosing'), 'dismissal animates before removing the notice');
    assert.ok(document.querySelector('.removalSuccess'));
    await timers.advance(240);
    assert.equal(document.querySelector('.removalSuccess'), null);
    assert.equal(document.querySelectorAll('.memberCard').length, 2);
  } finally { release(); timers.restore(); }
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
const submitInvite = async () => act(async () => document.querySelector('.inviteModal form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));

test('a confirmed invitation shows success and leaves a usable native dialog', async () => {
  await mount();
  await click('[aria-label="Invite member"]');
  assert.equal(document.querySelector('.inviteModal').tagName, 'DIALOG');
  assert.ok(document.querySelector('.inviteModal').open);
  assert.equal(document.activeElement, document.querySelector('.inviteModal input[type="email"]'));
  await enterInviteEmail('New@Example.test');
  await submitInvite();
  assert.deepEqual(fixture.inviteCalls, [{ email: 'new@example.test', role: 'viewer' }]);
  assert.equal(document.querySelector('.inviteModal [role="status"]').textContent, 'Invited');
  assert.equal(document.querySelector('.inviteModal input[type="email"]').value, '');
  assert.equal(document.querySelector('.inviteModal [role="alert"]'), null);
  await click('.inviteModal [aria-label="Close"]');
  assert.equal(document.querySelector('.inviteModal'), null);
});

for (const flag of ['restored', 'reactivated']) test(`existing-account restoration uses the same concise confirmation (${flag})`, async () => {
  fixture.inviteResult = { ok: true, [flag]: true };
  await mount();
  await click('[aria-label="Invite member"]');
  await enterInviteEmail('returning@example.test');
  await submitInvite();
  const message = document.querySelector('.inviteModal [role="status"]').textContent;
  assert.equal(message, 'Invited');
});

test('a directory refresh failure does not turn a delivered invitation into a sending failure', async () => {
  await mount();
  fixture.failRefresh = true;
  await click('[aria-label="Invite member"]');
  await enterInviteEmail('new@example.test');
  await submitInvite();
  assert.equal(document.querySelector('.inviteModal [role="status"]').textContent, 'Invited');
  assert.equal(document.querySelector('.inviteModal [role="alert"]'), null);
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
    assert.ok(document.querySelector('.inviteModal select').disabled);
    await backdropGesture('.inviteModal');
    assert.ok(document.querySelector('.inviteModal[open]'), 'a pending invitation stays open');
    await click('.inviteModal [aria-label="Close"]');
    assert.ok(document.querySelector('.inviteModal'));
    await act(async () => release());
    assert.equal(document.querySelector('.inviteModal [role="status"]').textContent, 'Invited');
  } finally { release(); }
});

const selectInviteRole = async value => act(async () => {
  const select = document.getElementById('team-invite-role');
  select.value = value;
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
});

test('member roles appear in one directory and in member details, including legacy viewer roles', async () => {
  fixture.members[1].role = 'user';
  fixture.members[2].role = 'field_operator';
  await mount();
  assert.equal(document.querySelectorAll('[aria-label="Team members"]').length, 1);
  assert.deepEqual([...document.querySelectorAll('.memberCard .roleBadge')].map(badge => badge.textContent).sort(), ['Admin', 'Field Operator', 'Viewer']);
  await click('[aria-label="View details for Emily Thompson"]');
  const role = [...document.querySelectorAll('.memberDetailsFields > div')].find(field => field.querySelector('dt').textContent === 'Role');
  assert.equal(role.querySelector('dd').textContent, 'Viewer');
});

test('institution admins can select an operator role and invitations reset to Viewer after success', async () => {
  await mount();
  await click('[aria-label="Invite member"]');
  const select = document.getElementById('team-invite-role');
  assert.equal(select.value, 'viewer');
  assert.deepEqual([...select.options].map(option => option.value), ['viewer', 'field_operator']);
  await enterInviteEmail('operator@example.test');
  await selectInviteRole('field_operator');
  await submitInvite();
  assert.deepEqual(fixture.inviteCalls, [{ email: 'operator@example.test', role: 'field_operator' }]);
  assert.equal(select.value, 'viewer');
  assert.equal(document.querySelector('.inviteModal [role="status"]').textContent, 'Invited');
});

for (const role of ['admin', 'checkit_field_operator', 'checkit_admin']) test(`CheckIt admins can invite the permitted ${role} role`, async () => {
  fixture.currentUserRole = 'checkit_admin';
  fixture.members[0].role = 'checkit_admin';
  await mount();
  await click('[aria-label="Invite member"]');
  assert.deepEqual([...document.getElementById('team-invite-role').options].map(option => option.value), ['viewer', 'field_operator', 'admin', 'checkit_field_operator', 'checkit_admin']);
  await enterInviteEmail('member@example.test');
  await selectInviteRole(role);
  await submitInvite();
  assert.deepEqual(fixture.inviteCalls, [{ email: 'member@example.test', role }]);
});

test('a disallowed role injected into the invite selector is rejected before submission', async () => {
  await mount();
  await click('[aria-label="Invite member"]');
  await enterInviteEmail('member@example.test');
  const option = document.createElement('option');
  option.value = 'checkit_admin';
  document.getElementById('team-invite-role').append(option);
  await selectInviteRole('checkit_admin');
  await submitInvite();
  assert.equal(fixture.inviteCalls.length, 0);
  assert.match(document.querySelector('.inviteModal [role="alert"]').textContent, /Choose a role you can assign/);
});

test('failed invitations preserve the selected role and reopening resets it to Viewer', async () => {
  fixture.inviteError = new Error('Delivery unavailable');
  await mount();
  await click('[aria-label="Invite member"]');
  await enterInviteEmail('operator@example.test');
  await selectInviteRole('field_operator');
  await submitInvite();
  assert.equal(document.getElementById('team-invite-role').value, 'field_operator');
  await click('.inviteModal [aria-label="Close"]');
  await click('[aria-label="Invite member"]');
  assert.equal(document.getElementById('team-invite-role').value, 'viewer');
});

test('viewers cannot open invitations', async () => {
  fixture.currentUserRole = 'viewer';
  fixture.members[0].role = 'viewer';
  await mount();
  assert.equal(document.querySelector('[aria-label="Invite member"]'), null);
});


test('invite dialog cancellation closes cleanly without sending an invitation', async () => {
  await mount();
  await click('[aria-label="Invite member"]');
  await enterInviteEmail('member@example.test');
  await act(async () => document.querySelector('.inviteModal').dispatchEvent(new dom.window.Event('cancel', { cancelable: true })));
  assert.equal(document.querySelector('.inviteModal'), null);
  assert.equal(fixture.inviteCalls.length, 0);
  assert.equal(document.querySelectorAll('.memberCard').length, 3);
});

test('a profile keeps its avatar color when its details are opened', async () => {
  await mount();
  const button = document.querySelector('[aria-label="View details for Emily Thompson"]');
  const card = button.closest('.memberCard');
  const tone = card.getAttribute('data-member-tone');
  assert.ok(['forest', 'ocean', 'indigo', 'plum', 'amber', 'teal'].includes(tone));
  assert.equal(button.querySelector('.avatar').getAttribute('data-member-tone'), tone);
  await click('[aria-label="View details for Emily Thompson"]');
  assert.equal(document.querySelector('.memberDetailsProfile .avatar').getAttribute('data-member-tone'), tone);
  assert.equal(document.querySelector('.memberDetailsFields .roleBadge').getAttribute('data-role'), 'viewer');
});

const backdropGesture = async (selector, { down = [20, 20], up = down } = {}) => act(async () => {
  const dialog = document.querySelector(selector);
  assert.ok(dialog);
  dialog.getBoundingClientRect = () => ({ left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300 });
  dialog.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: down[0], clientY: down[1] }));
  dialog.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: up[0], clientY: up[1] }));
});

test('clicking outside an invite closes it and clears the next invite without sending', async () => {
  await mount();
  await click('[aria-label="Invite member"]');
  await enterInviteEmail('operator@example.test');
  await selectInviteRole('field_operator');
  await backdropGesture('.inviteModal');
  assert.equal(document.querySelector('.inviteModal'), null);
  assert.equal(fixture.inviteCalls.length, 0);
  await click('[aria-label="Invite member"]');
  assert.equal(document.querySelector('.inviteModal input[type="email"]').value, '');
  assert.equal(document.getElementById('team-invite-role').value, 'viewer');
});

test('clicks inside dialog padding and drags from inside to outside retain the invite', async () => {
  await mount();
  await click('[aria-label="Invite member"]');
  await enterInviteEmail('operator@example.test');
  await backdropGesture('.inviteModal', { down: [110, 110] });
  assert.ok(document.querySelector('.inviteModal[open]'));
  await backdropGesture('.inviteModal', { down: [200, 200], up: [20, 20] });
  assert.ok(document.querySelector('.inviteModal[open]'));
  await click('.inviteModal input[type="email"]');
  assert.equal(document.querySelector('.inviteModal input[type="email"]').value, 'operator@example.test');
});

test('outside clicks close profile details and removal confirmation without removing anyone', async () => {
  await mount();
  await click('[aria-label="View details for Emily Thompson"]');
  await backdropGesture('.memberDetailsDialog');
  assert.equal(document.querySelector('.memberDetailsDialog'), null);
  await click('[aria-label="Remove Emily Thompson from team"]');
  await backdropGesture('.removalDialog');
  assert.equal(document.querySelector('.removalDialog'), null);
  assert.equal(fixture.removeCalls.length, 0);
  assert.equal(document.querySelectorAll('.memberCard').length, 3);
});


test("uploaded photos appear on cards, member details, and removal confirmation without changing roles", async () => {
  fixture.members[1].avatar_url = 'https://photos.example/member.webp';
  fixture.members[1].avatar_path = 'member/original.webp';
  await mount();
  assert.equal(document.querySelector('[aria-label="View details for Emily Thompson"] .avatar img').src, 'https://photos.example/member.webp');
  await click('[aria-label="View details for Emily Thompson"]');
  assert.equal(document.querySelector('.memberDetailsDialog .avatar img').src, 'https://photos.example/member.webp');
  await act(async () => window.dispatchEvent(new window.CustomEvent('checkit:profile-updated', { detail: {
    id: 'member', avatar_path: 'member/new.webp', avatar_url: 'https://photos.example/new.webp', role: 'checkit_admin',
  } })));
  assert.equal(document.querySelector('.memberDetailsDialog .avatar img').src, 'https://photos.example/new.webp');
  assert.equal(document.querySelector('.memberDetailsFields .roleBadge').textContent, 'Viewer');
  await click('.removeFromProfileButton');
  assert.equal(document.querySelector('.removalDialog .avatar img').src, 'https://photos.example/new.webp');
});


test('the removal message fades and collapses after three seconds without changing the directory', async () => {
  const timers = mockRemovalTimers();
  try {
    await mount();
    await click('[aria-label="Remove Emily Thompson from team"]');
    await enterName('Emily Thompson');
    await submit();
    await until(() => document.querySelector('.removalSuccess'));
    assert.equal(timers.scheduled.size, 1);
    await timers.advance(3000);
    assert.ok(document.querySelector('.removalNoticeClosing'));
    assert.equal(document.querySelector('.removalNoticeClosing').getAttribute('aria-hidden'), 'true');
    assert.ok(document.querySelector('.removalSuccess'), 'the notice stays mounted during its exit');
    await timers.advance(240);
    assert.equal(document.querySelector('.removalNotice'), null);
    assert.equal(document.querySelectorAll('.memberCard').length, 2);
    assert.equal(timers.scheduled.size, 0, 'both timers are cleaned up');
  } finally { timers.restore(); }
});

test('a new removal replaces a closing notice without being cleared by its old exit timer', async () => {
  const timers = mockRemovalTimers();
  fixture.currentUserRole = 'checkit_admin';
  try {
    await mount();
    await click('[aria-label="Remove Emily Thompson from team"]');
    await enterName('Emily Thompson');
    await submit();
    await click('[aria-label="Dismiss removal message"]');
    assert.ok(document.querySelector('.removalNoticeClosing'));
    await click('[aria-label="Remove Another Admin from team"]');
    await enterName('Another Admin');
    await submit();
    assert.equal(document.querySelector('.removalNoticeClosing'), null);
    assert.match(document.querySelector('[role="status"]').textContent, /Another Admin was removed\./);
    assert.equal([...timers.scheduled.values()].some(timer => timer.delay === 240), false);
    await timers.advance(3000);
    await timers.advance(240);
    assert.equal(document.querySelector('.removalNotice'), null);
    assert.equal(document.querySelectorAll('.memberCard').length, 1);
  } finally { timers.restore(); }
});


test('resend is available for unfinished signup and uses the member’s existing email and role once', async () => {
  fixture.members[1].invitation_pending = true;
  fixture.members[1].role = 'field_operator';
  let release;
  fixture.inviteGate = new Promise(resolve => { release = resolve; });
  await mount();
  await click('[aria-label="View details for Emily Thompson"]');
  assert.equal(document.querySelector('.resendInviteButton').textContent, 'Resend invite');
  try {
    await click('.resendInviteButton');
    await click('.resendInviteButton');
    assert.equal(document.querySelector('.resendInviteButton').disabled, true);
    assert.equal(document.querySelector('.removeFromProfileButton').disabled, true);
    assert.deepEqual(fixture.inviteCalls, [{ email: 'emily@example.test', role: 'field_operator' }]);
    await act(async () => release());
    await until(() => !document.querySelector('.resendInviteButton').disabled);
    assert.equal(document.querySelector('.memberDetailsDialog [role="status"]').textContent, 'Invited');
    assert.equal(document.querySelector('.memberDetailsDialog [role="alert"]'), null);
    assert.equal(fixture.loads, 2);
    await click('[aria-label="Close member details"]');
    await click('[aria-label="View details for Emily Thompson"]');
    assert.equal(document.querySelector('.memberDetailsDialog [role="status"]'), null);
  } finally { release(); }
});

test('resend failure remains retryable and does not show success', async () => {
  fixture.members[1].invitation_pending = true;
  fixture.inviteError = new Error('Please wait before sending another invite.');
  await mount();
  await click('[aria-label="View details for Emily Thompson"]');
  await click('.resendInviteButton');
  assert.match(document.querySelector('.memberDetailsDialog [role="alert"]').textContent, /Please wait/);
  assert.equal(document.querySelector('.memberDetailsDialog [role="status"]'), null);
  assert.equal(document.querySelector('.resendInviteButton').disabled, false);
  fixture.inviteError = null;
  await click('.resendInviteButton');
  assert.equal(document.querySelector('.memberDetailsDialog [role="status"]').textContent, 'Invited');
  assert.equal(document.querySelector('.memberDetailsDialog [role="alert"]'), null);
});

test('a refresh failure preserves confirmed resend success', async () => {
  fixture.members[1].invitation_pending = true;
  fixture.failRefresh = true;
  await mount();
  await click('[aria-label="View details for Emily Thompson"]');
  await click('.resendInviteButton');
  assert.equal(document.querySelector('.memberDetailsDialog [role="status"]').textContent, 'Invited');
  assert.equal(document.querySelector('.memberDetailsDialog [role="alert"]'), null);
});

test('a directory refresh removes resend when signup has completed', async () => {
  fixture.members[1].invitation_pending = true;
  let release;
  fixture.inviteGate = new Promise(resolve => { release = resolve; });
  await mount();
  await click('[aria-label="View details for Emily Thompson"]');
  await click('.resendInviteButton');
  fixture.members[1].invitation_pending = false;
  await act(async () => release());
  await until(() => !document.querySelector('.resendInviteButton'));
  assert.ok(document.querySelector('.memberDetailsDialog[open]'));
});

for (const kind of ['completed', 'viewer', 'protected', 'removing']) test(`resend is hidden for ${kind} accounts`, async () => {
  fixture.members[1].invitation_pending = kind !== 'completed';
  if (kind === 'viewer') fixture.currentUserRole = 'viewer';
  if (kind === 'protected') fixture.members[1].role = 'checkit_admin';
  if (kind === 'removing') fixture.members[1].removal_pending = true;
  await mount();
  await click('[aria-label="View details for Emily Thompson"]');
  assert.equal(document.querySelector('.resendInviteButton'), null);
  assert.equal(fixture.inviteCalls.length, 0);
});

test('closing a pending resend cannot show its result on a different profile', async () => {
  fixture.members[1].invitation_pending = true;
  let release;
  fixture.inviteGate = new Promise(resolve => { release = resolve; });
  await mount();
  await click('[aria-label="View details for Emily Thompson"]');
  await click('.resendInviteButton');
  await click('[aria-label="Close member details"]');
  await click('[aria-label="View details for Another Admin"]');
  await act(async () => release());
  assert.equal(document.querySelector('.memberDetailsDialog [role="status"]'), null);
  assert.equal(document.querySelector('.memberDetailsDialog [role="alert"]'), null);
});


test('pending signup and awaiting first sign-in have distinct card and member statuses',async()=>{
 fixture.members[1].invitation_pending=true;
 await mount();
 const card=[...document.querySelectorAll('.memberCard')].find(item=>item.textContent.includes('Emily Thompson'));
 assert.equal(card.querySelector('.invitationBadge').textContent,'Pending invite');
 await click('[aria-label="View details for Emily Thompson"]');
 assert.equal(document.querySelector('.memberInvitationStatus').textContent,'Pending invite');
 assert.ok(document.querySelector('.resendInviteButton'));
 fixture.members[1].invitation_pending=false;fixture.members[1].access_status='awaiting_sign_in';
 await act(async()=>window.dispatchEvent(new window.Event('focus')));
 await until(()=>document.querySelector('.invitationBadge')?.textContent==='Awaiting sign-in');
 assert.equal(document.querySelector('.memberInvitationStatus').textContent,'Awaiting sign-in');
 assert.equal(document.querySelector('.resendInviteButton'),null);
});
