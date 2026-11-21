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
    jsonResponse([]), // No existing profile for the invited email.
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
    if (new URL(url).searchParams.has("email")) return jsonResponse([]);
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

test("re-inviting a removed confirmed member restores access and sends a sign-in email", async () => {
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/user") return jsonResponse({ id: "admin-user" });
    if (parsed.pathname === "/auth/v1/admin/users/removed-user") return jsonResponse({ id: "removed-user", email: "removed@example.com", email_confirmed_at: "2026-10-21T00:00:00Z" });
    if (parsed.searchParams.has("email")) {
      return jsonResponse([{ id: "removed-user", email: "removed@example.com", role: "viewer", assigned_institute: null }]);
    }
    if (options.method === "PATCH") return jsonResponse([{ id: "removed-user", assigned_institute: "institute-1" }]);
    return jsonResponse([{ id: "admin-user", role: "admin", assigned_institute: "institute-1" }]);
  };

  const response = createResponse();
  await handler(createRequest({
    token: "admin-access-token",
    body: { email: "removed@example.com", role: "field_operator" },
  }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, {
    ok: true,
    email: "removed@example.com",
    role: "field_operator",
    restored: true,
  });

  assert.ok(!requests.some(({ url }) => url.includes("/auth/v1/invite")));
  const emailRequest = requests.find(({ url }) => new URL(url).pathname === "/auth/v1/otp");
  assert.ok(emailRequest);
  assert.deepEqual(JSON.parse(emailRequest.options.body), { email: "removed@example.com", create_user: false });
  assert.equal(new URL(emailRequest.url).searchParams.get("redirect_to"), new URL(process.env.APP_PUBLIC_URL).origin + "/login");
  const restoreRequest = requests.find(({ options }) => options.method === "PATCH");
  assert.ok(restoreRequest);
  const restoreUrl = new URL(restoreRequest.url);
  assert.equal(restoreUrl.searchParams.get("id"), "eq.removed-user");
  assert.equal(restoreUrl.searchParams.get("assigned_institute"), "is.null");
  assert.deepEqual(JSON.parse(restoreRequest.options.body), {
    role: "field_operator",
    assigned_institute: "institute-1",
  });
});

test("inviting a member assigned to another institution is rejected", async () => {
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (options.method && options.method !== "GET") throw new Error(`Unexpected ${options.method} ${url}`);
    if (parsed.pathname === "/auth/v1/user") return jsonResponse({ id: "admin-user" });
    if (parsed.searchParams.has("email")) {
      return jsonResponse([{ id: "active-user", email: "active@example.com", role: "viewer", assigned_institute: "institute-2" }]);
    }
    return jsonResponse([{ id: "admin-user", role: "admin", assigned_institute: "institute-1" }]);
  };

  const response = createResponse();
  await handler(createRequest({
    token: "admin-access-token",
    body: { email: "active@example.com", role: "viewer" },
  }), response);

  assert.equal(response.statusCode, 409);
  assert.match(response.payload.error, /already exists/i);
});



test("a concurrent team assignment cannot be reported as restored membership", async () => {
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/user") return jsonResponse({ id: "admin-user" });
    if (parsed.pathname === "/auth/v1/admin/users/removed-user") return jsonResponse({ id: "removed-user", email: "removed@example.com", email_confirmed_at: "2026-10-21T00:00:00Z" });
    if (parsed.searchParams.has("email")) return jsonResponse([{ id: "removed-user", role: "viewer", assigned_institute: null }]);
    if (options.method === "PATCH") return jsonResponse([]);
    return jsonResponse([{ id: "admin-user", role: "admin", assigned_institute: "institute-1" }]);
  };
  const response = createResponse();
  await handler(createRequest({ token: "admin-access-token", body: { email: "removed@example.com", role: "viewer" } }), response);
  assert.equal(response.statusCode, 409);
  assert.match(response.payload.error, /could not be restored/);
});

test("institution admins cannot claim a detached CheckIt admin account", async () => {
  global.fetch = async (url, options = {}) => {
    if (options.method && options.method !== "GET") throw new Error("Protected account must not change");
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/user") return jsonResponse({ id: "admin-user" });
    if (parsed.searchParams.has("email")) return jsonResponse([{ id: "protected-user", role: "checkit_admin", assigned_institute: null }]);
    return jsonResponse([{ id: "admin-user", role: "admin", assigned_institute: "institute-1" }]);
  };
  const response = createResponse();
  await handler(createRequest({ token: "admin-access-token", body: { email: "protected@example.com", role: "viewer" } }), response);
  assert.equal(response.statusCode, 403);
});

test("an unconfirmed invitation response never reports success", async () => {
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/user") return jsonResponse({ id: "admin-user" });
    if (parsed.pathname === "/auth/v1/invite") return jsonResponse({});
    if (parsed.searchParams.has("email")) return jsonResponse([]);
    if (options.method === "POST") throw new Error("No profile may be created without an invited account");
    return jsonResponse([{ id: "admin-user", role: "admin", assigned_institute: "institute-1" }]);
  };
  const response = createResponse();
  await handler(createRequest({ token: "admin-access-token", body: { email: "new@example.com", role: "viewer" } }), response);
  assert.equal(response.statusCode, 502);
});

test("email service configuration failures are returned to the inviter", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/user") return jsonResponse({ id: "admin-user" });
    if (parsed.pathname === "/auth/v1/invite") return jsonResponse({ message: "Error sending invite email" }, 500);
    if (parsed.searchParams.has("email")) return jsonResponse([]);
    return jsonResponse([{ id: "admin-user", role: "admin", assigned_institute: "institute-1" }]);
  };
  const response = createResponse();
  await handler(createRequest({ token: "admin-access-token", body: { email: "new@example.com", role: "viewer" } }), response);
  assert.equal(response.statusCode, 500);
  assert.match(response.payload.error, /Error sending invite email/);
});

for (const [name, appUrl, productionHost, expected] of [
  ['configured public URL', ' https://custom.example/ ', '', 'https://custom.example/create-account'],
  ['stable production alias', '', 'transportation-production.example', 'https://transportation-production.example/create-account'],
  ['default Transportation host', '', '', 'https://checkit-transportation-felix.vercel.app/create-account'],
]) test(`invitation links use the ${name}, rather than a preview or the other app`, async () => {
  const keys = ['APP_PUBLIC_URL', 'TRANSPORTATION_APP_PUBLIC_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL'];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  try {
    process.env.APP_PUBLIC_URL = appUrl;
    process.env.TRANSPORTATION_APP_PUBLIC_URL = '';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = productionHost;
    process.env.VERCEL_URL = 'protected-preview.example';
    const { default: configuredHandler } = await import(`../api/team/invite.js?redirect=${encodeURIComponent(name)}`);
    global.fetch = async (url, options = {}) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/auth/v1/user') return jsonResponse({ id: 'admin-user' });
      if (parsed.searchParams.has('email')) return jsonResponse([]);
      if (parsed.pathname === '/auth/v1/invite') return jsonResponse({ id: 'new-user' });
      if (options.method === 'POST') return jsonResponse([{ id: 'new-user' }]);
      return jsonResponse([{ id: 'admin-user', role: 'admin', assigned_institute: 'institute-1' }]);
    };
    const response = createResponse();
    await configuredHandler(createRequest({ token: 'admin-access-token', body: { email: 'new@example.com', role: 'viewer' } }), response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.redirectTo, expected);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

for (const confirmed of [true, false]) test(`re-inviting a current ${confirmed ? "confirmed" : "unconfirmed"} member sends email without changing their role`, async () => {
  const requests = [];
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    requests.push({ url: parsed, options });
    if (parsed.pathname === "/auth/v1/user") return jsonResponse({ id: "admin-user" });
    if (parsed.pathname === "/auth/v1/admin/users/member-user") return jsonResponse({ id: "member-user", email: "member@example.com", email_confirmed_at: confirmed ? "2026-10-21T00:00:00Z" : null });
    if (parsed.searchParams.has("email")) return jsonResponse([{ id: "member-user", email: "member@example.com", role: "viewer", assigned_institute: "institute-1" }]);
    if (["/auth/v1/otp", "/auth/v1/invite"].includes(parsed.pathname)) return jsonResponse({ id: "member-user" });
    if (options.method && options.method !== "GET") throw new Error("Existing member access must not change");
    return jsonResponse([{ id: "admin-user", role: "admin", assigned_institute: "institute-1" }]);
  };
  const response = createResponse();
  await handler(createRequest({ token: "admin-access-token", body: { email: "member@example.com", role: "field_operator" } }), response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.role, "viewer");
  assert.equal(response.payload.restored, false);
  const mail = requests.filter(({ options }) => options.method === "POST");
  assert.equal(mail.length, 1);
  assert.equal(mail[0].url.pathname, confirmed ? "/auth/v1/otp" : "/auth/v1/invite");
  assert.equal(mail[0].url.searchParams.get("redirect_to"), new URL(process.env.APP_PUBLIC_URL).origin + (confirmed ? "/login" : "/create-account"));
  assert.deepEqual(JSON.parse(mail[0].options.body), confirmed ? { email: "member@example.com", create_user: false } : { email: "member@example.com" });
});

test("a restored member can retry email delivery after a mail failure", async () => {
  let assignedInstitute = null;
  let mailAttempts = 0;
  let patches = 0;
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/user") return jsonResponse({ id: "admin-user" });
    if (parsed.pathname === "/auth/v1/admin/users/member-user") return jsonResponse({ id: "member-user", email: "member@example.com", email_confirmed_at: "2026-10-21T00:00:00Z" });
    if (parsed.searchParams.has("email")) return jsonResponse([{ id: "member-user", email: "member@example.com", role: "viewer", assigned_institute: assignedInstitute }]);
    if (options.method === "PATCH") {
      patches++;
      assignedInstitute = "institute-1";
      return jsonResponse([{ id: "member-user", assigned_institute: assignedInstitute }]);
    }
    if (parsed.pathname === "/auth/v1/otp") {
      mailAttempts++;
      return mailAttempts === 1 ? jsonResponse({ message: "Error sending sign-in email" }, 502) : jsonResponse({});
    }
    return jsonResponse([{ id: "admin-user", role: "admin", assigned_institute: "institute-1" }]);
  };
  const request = createRequest({ token: "admin-access-token", body: { email: "member@example.com", role: "viewer" } });
  const failed = createResponse();
  await handler(request, failed);
  assert.equal(failed.statusCode, 502);
  assert.match(failed.payload.error, /sending sign-in email/);
  assert.notEqual(failed.payload.ok, true);
  const retried = createResponse();
  await handler(request, retried);
  assert.equal(retried.statusCode, 200);
  assert.equal(retried.payload.ok, true);
  assert.equal(mailAttempts, 2);
  assert.equal(patches, 1);
});

test("a mismatched login cannot restore access or send an email", async () => {
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (options.method && options.method !== "GET") throw new Error("Mismatched account must not change or receive mail");
    if (parsed.pathname === "/auth/v1/user") return jsonResponse({ id: "admin-user" });
    if (parsed.pathname === "/auth/v1/admin/users/member-user") return jsonResponse({ id: "member-user", email: "different@example.com", email_confirmed_at: "2026-10-21T00:00:00Z" });
    if (parsed.searchParams.has("email")) return jsonResponse([{ id: "member-user", email: "member@example.com", role: "viewer", assigned_institute: null }]);
    return jsonResponse([{ id: "admin-user", role: "admin", assigned_institute: "institute-1" }]);
  };
  const response = createResponse();
  await handler(createRequest({ token: "admin-access-token", body: { email: "member@example.com", role: "viewer" } }), response);
  assert.equal(response.statusCode, 409);
  assert.match(response.payload.error, /does not match/);
});

for (const assignedInstitute of [null, "institute-1"]) test(`institution admins cannot email a protected account with assignment ${assignedInstitute}`, async () => {
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (options.method && options.method !== "GET") throw new Error("Protected account must not change or receive mail");
    if (parsed.pathname === "/auth/v1/user") return jsonResponse({ id: "admin-user" });
    if (parsed.searchParams.has("email")) return jsonResponse([{ id: "protected-user", email: "protected@example.com", role: "checkit_admin", assigned_institute: assignedInstitute }]);
    if (parsed.pathname.startsWith("/auth/v1/admin/")) throw new Error("Protected login must not be accessed");
    return jsonResponse([{ id: "admin-user", role: "admin", assigned_institute: "institute-1" }]);
  };
  const response = createResponse();
  await handler(createRequest({ token: "admin-access-token", body: { email: "protected@example.com", role: "viewer" } }), response);
  assert.equal(response.statusCode, 403);
});

test("re-inviting an unconfirmed removed member restores access and resends onboarding", async () => {
  let restored = false;
  let sent = false;
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/user") return jsonResponse({ id: "admin-user" });
    if (parsed.pathname === "/auth/v1/admin/users/member-user") return jsonResponse({ id: "member-user", email: "member@example.com", email_confirmed_at: null });
    if (parsed.searchParams.has("email")) return jsonResponse([{ id: "member-user", email: "member@example.com", role: "viewer", assigned_institute: null }]);
    if (options.method === "PATCH") { restored = true; return jsonResponse([{ id: "member-user", assigned_institute: "institute-1" }]); }
    if (parsed.pathname === "/auth/v1/invite") {
      assert.equal(restored, true);
      assert.equal(parsed.searchParams.get("redirect_to"), new URL(process.env.APP_PUBLIC_URL).origin + "/create-account");
      sent = true;
      return jsonResponse({ id: "member-user" });
    }
    if (parsed.pathname === "/auth/v1/otp") throw new Error("Onboarding needs an invite email");
    return jsonResponse([{ id: "admin-user", role: "admin", assigned_institute: "institute-1" }]);
  };
  const response = createResponse();
  await handler(createRequest({ token: "admin-access-token", body: { email: "member@example.com", role: "viewer" } }), response);
  assert.equal(response.statusCode, 200);
  assert.equal(sent, true);
});
