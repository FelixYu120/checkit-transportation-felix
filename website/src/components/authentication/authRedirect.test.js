import test from "node:test";
import assert from "node:assert/strict";

import { getSupabaseAuthRedirectPath, isAuthenticationPath } from "./authRedirect.js";

test("routes an implicit invite callback to create-account", () => {
  assert.equal(
    getSupabaseAuthRedirectPath({ pathname: "/login", hash: "#type=invite&access_token=test" }),
    "/create-account"
  );
});

test("routes a code callback to create-account", () => {
  assert.equal(
    getSupabaseAuthRedirectPath({ pathname: "/login", search: "?code=test" }),
    "/create-account"
  );
});

test("keeps password recovery callbacks on the password page", () => {
  assert.equal(
    getSupabaseAuthRedirectPath({ pathname: "/login", hash: "#type=recovery&access_token=test" }),
    "/set-password"
  );
  assert.equal(
    getSupabaseAuthRedirectPath({ pathname: "/set-password", search: "?code=test" }),
    "/set-password"
  );
});

test("ignores ordinary navigation", () => {
  assert.equal(getSupabaseAuthRedirectPath({ pathname: "/login" }), null);
});


for (const type of ['magiclink', 'signup', 'email_change', 'reauthentication']) test(`${type} emails sign in an existing account without restarting account setup`, () => {
  assert.equal(getSupabaseAuthRedirectPath({ pathname: '/login', hash: `#type=${type}&access_token=fixture` }), '/login');
});

for (const pathname of ['/create-account', '/signup', '/create-account/']) test(`resent invitation on ${pathname} keeps setup despite a magic-link token`, () => {
  assert.equal(getSupabaseAuthRedirectPath({pathname,hash:'#type=magiclink&access_token=fixture&refresh_token=fixture'}), '/create-account');
});

test('callback classification survives Supabase clearing the fragment', () => {
  const location = {pathname:'/', hash:'#type=invite&access_token=fixture'};
  const captured = getSupabaseAuthRedirectPath(location);
  location.hash = '';
  assert.equal(captured, '/create-account');
});


test('all authentication routes share the standalone layout, including aliases and trailing slashes', () => {
  for (const path of ['/login','/verify','/signup','/create-account','/forgot-password','/set-password','/reset-password']) {
    assert.equal(isAuthenticationPath(path),true,path);
    assert.equal(isAuthenticationPath(`${path.toUpperCase()}/`),true,path);
  }
  for (const path of ['/','/map','/dashboard/ucsd','/team','/login-not-a-route']) assert.equal(isAuthenticationPath(path),false,path);
});
