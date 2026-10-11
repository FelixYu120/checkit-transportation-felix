import test from "node:test";
import assert from "node:assert/strict";

import { getSupabaseAuthRedirectPath } from "../src/components/authentication/authRedirect.js";

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
    null
  );
});

test("ignores ordinary navigation", () => {
  assert.equal(getSupabaseAuthRedirectPath({ pathname: "/login" }), null);
});

