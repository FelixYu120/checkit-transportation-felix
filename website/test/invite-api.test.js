import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.APP_PUBLIC_URL = "https://transportation.example";

const { default: handler } = await import("../api/team/invite.js");
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

const createRequest = ({ method = "POST", token = "", body = {} } = {}) => ({
  method,
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body,
});

const createResponse = () => ({
  headers: {},
  statusCode: 200,
  payload: undefined,
  ended: false,
  setHeader(name, value) {
    this.headers[name] = value;
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  },
  end() {
    this.ended = true;
    return this;
  },
});

const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { "Content-Type": "application/json" },
});

test("rejects unauthenticated invitations", async () => {
  const response = createResponse();
  await handler(createRequest(), response);

  assert.equal(response.statusCode, 401);
  assert.match(response.payload.error, /sign in/i);
});

test("rejects methods other than POST and OPTIONS", async () => {
  const response = createResponse();
  await handler(createRequest({ method: "GET" }), response);

  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, "POST, OPTIONS");
});

test("institution admins can invite allowed roles into their institution", async () => {
  const requests = [];
  const responses = [
    jsonResponse({ id: "admin-user" }),
    jsonResponse([{ id: "admin-user", role: "admin", assigned_institute: "institute-1" }]),
    jsonResponse({ id: "invited-user" }),
    jsonResponse([{ id: "invited-user" }]),
  ];

  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return responses.shift();
  };

  const response = createResponse();
  await handler(createRequest({
    token: "admin-access-token",
    body: { email: "New.Member@Example.com", role: "viewer" },
  }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, {
    ok: true,
    email: "new.member@example.com",
    role: "viewer",
    redirectTo: "https://transportation.example/create-account",
  });

  const inviteRequest = requests.find(({ url }) => url.includes("/auth/v1/invite"));
  assert.ok(inviteRequest);
  assert.equal(
    new URL(inviteRequest.url).searchParams.get("redirect_to"),
    "https://transportation.example/create-account"
  );
  assert.deepEqual(JSON.parse(inviteRequest.options.body), {
    email: "new.member@example.com",
    data: {
      role: "viewer",
      assigned_institute: "institute-1",
      invited_by: "admin-user",
    },
  });

  const profileRequest = requests.at(-1);
  assert.ok(profileRequest.url.includes("/rest/v1/profile"));
  assert.deepEqual(JSON.parse(profileRequest.options.body), [{
    id: "invited-user",
    email: "new.member@example.com",
    role: "viewer",
    assigned_institute: "institute-1",
  }]);
});

test("institution admins cannot invite elevated roles", async () => {
  global.fetch = async (url) => {
    if (String(url).includes("/auth/v1/user")) return jsonResponse({ id: "admin-user" });
    return jsonResponse([{ id: "admin-user", role: "admin", assigned_institute: "institute-1" }]);
  };

  const response = createResponse();
  await handler(createRequest({
    token: "admin-access-token",
    body: { email: "new.member@example.com", role: "checkit_admin" },
  }), response);

  assert.equal(response.statusCode, 403);
  assert.match(response.payload.error, /cannot invite/i);
});

