import assert from "node:assert/strict";
import test from "node:test";

test("renders the production storefront", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.doesNotMatch(html, /codex-preview|development/i);
  assert.match(html, /tile\.openstreetmap\.org/);
  assert.match(html, /map\.naver\.com\/p\/entry\/place\/1626605361/);
  assert.match(html, /catharsis-mark\.svg/);
  assert.doesNotMatch(html, /favicon\.svg/);
  assert.doesNotMatch(
    html,
    /입력 정보는|서버로 전송|저장되지|데이터베이스|미완성|시범|데모/i,
  );
  assert.match(html, /예약 조회·취소/);
  assert.match(html, /실시간 예약 현황/);
  assert.match(html, /테마와 이용 인원에 맞는 요금/);
  assert.doesNotMatch(html, /예약 확정은 네이버 예약|네이버에서 예약하기/);
});

function testEnv(overrides = {}) {
  const statement = {
    bind() { return this; },
    async run() { return { success: true }; },
    async first() { return { request_count: 1 }; },
  };
  return {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    DB: { prepare: () => Object.create(statement) },
    BOOKING_LOOKUP_PEPPER: "test-lookup-pepper-for-admin-access",
    ADMIN_ACCESS_KEY: "test-admin-access-key",
    ADMIN_SESSION_SECRET: "test-session-secret-with-at-least-thirty-two-characters",
    ...overrides,
  };
}

const testContext = {
  waitUntil() {},
  passThroughOnException() {},
};

test("shows the administrator key screen without an account redirect", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("admin-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/admin", { headers: { accept: "text/html" } }),
    testEnv(),
    testContext,
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /관리자 키를 입력해 주세요/);
  assert.match(html, /관리 화면 열기/);
  assert.doesNotMatch(html, /signin-with-chatgpt|로그인|계정/);
});

test("issues a secure administrator session and rejects invalid access", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("admin-session-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const headers = {
    "content-type": "application/json",
    origin: "http://localhost",
    "x-catharsis-admin-request": "1",
  };

  const wrong = await worker.fetch(
    new Request("http://localhost/api/admin/session", {
      method: "POST",
      headers,
      body: JSON.stringify({ accessKey: "incorrect-key" }),
    }),
    testEnv(),
    testContext,
  );
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get("set-cookie"), null);

  const valid = await worker.fetch(
    new Request("http://localhost/api/admin/session", {
      method: "POST",
      headers,
      body: JSON.stringify({ accessKey: "test-admin-access-key" }),
    }),
    testEnv(),
    testContext,
  );
  assert.equal(valid.status, 200);
  const setCookie = valid.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /__Host-catharsis_admin_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.doesNotMatch(setCookie, /test-admin-access-key/);

  const cookie = setCookie.split(";")[0];
  const adminPage = await worker.fetch(
    new Request("http://localhost/admin", {
      headers: { accept: "text/html", cookie },
    }),
    testEnv(),
    testContext,
  );
  assert.equal(adminPage.status, 200);
  const adminHtml = await adminPage.text();
  assert.match(adminHtml, /RESERVATION ADMIN/);
  assert.doesNotMatch(adminHtml, /관리자 키를 입력해 주세요/);

  const forgedCookie = `${cookie.slice(0, -1)}${cookie.endsWith("a") ? "b" : "a"}`;
  const forgedPage = await worker.fetch(
    new Request("http://localhost/admin", {
      headers: { accept: "text/html", cookie: forgedCookie },
    }),
    testEnv(),
    testContext,
  );
  assert.match(await forgedPage.text(), /관리자 키를 입력해 주세요/);

  for (const suffix of [".", "..junk", "...junk"]) {
    const suffixedPage = await worker.fetch(
      new Request("http://localhost/admin", {
        headers: { accept: "text/html", cookie: `${cookie}${suffix}` },
      }),
      testEnv(),
      testContext,
    );
    assert.match(await suffixedPage.text(), /관리자 키를 입력해 주세요/);
  }

  const locked = await worker.fetch(
    new Request("http://localhost/api/admin/session", {
      method: "DELETE",
      headers: {
        cookie,
        origin: "http://localhost",
        "x-catharsis-admin-request": "1",
      },
    }),
    testEnv(),
    testContext,
  );
  assert.equal(locked.status, 200);
  assert.match(locked.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("requires a session and same-origin marker for administrator APIs", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("admin-api-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const anonymous = await worker.fetch(
    new Request("http://localhost/api/admin/dashboard"),
    testEnv(),
    testContext,
  );
  assert.equal(anonymous.status, 401);

  const session = await worker.fetch(
    new Request("http://localhost/api/admin/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        "x-catharsis-admin-request": "1",
      },
      body: JSON.stringify({ accessKey: "test-admin-access-key" }),
    }),
    testEnv(),
    testContext,
  );
  const cookie = (session.headers.get("set-cookie") ?? "").split(";")[0];
  const missingOriginMarker = await worker.fetch(
    new Request("http://localhost/api/admin/settings", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: "{}",
    }),
    testEnv(),
    testContext,
  );
  assert.equal(missingOriginMarker.status, 403);
});

test("serves exact GitHub Pages CORS and audience-bound administrator sessions", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("pages-cors-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const pagesOrigin = "https://sosirusok.github.io";

  const preflight = await worker.fetch(
    new Request("http://localhost/api/admin/session", {
      method: "OPTIONS",
      headers: {
        origin: pagesOrigin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-catharsis-admin-request",
      },
    }),
    testEnv(),
    testContext,
  );
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), pagesOrigin);
  assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /Authorization/i);

  const rejectedPreflight = await worker.fetch(
    new Request("http://localhost/api/public/reservations", {
      method: "OPTIONS",
      headers: { origin: "https://example.com", "access-control-request-method": "POST" },
    }),
    testEnv(),
    testContext,
  );
  assert.equal(rejectedPreflight.status, 403);
  assert.equal(rejectedPreflight.headers.get("access-control-allow-origin"), null);

  const session = await worker.fetch(
    new Request("http://localhost/api/admin/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: pagesOrigin,
        "sec-fetch-site": "cross-site",
        "x-catharsis-admin-request": "1",
      },
      body: JSON.stringify({ accessKey: "test-admin-access-key" }),
    }),
    testEnv(),
    testContext,
  );
  assert.equal(session.status, 200);
  assert.equal(session.headers.get("set-cookie"), null);
  assert.equal(session.headers.get("access-control-allow-origin"), pagesOrigin);
  const sessionBody = await session.json();
  assert.equal(sessionBody.ok, true);
  assert.match(sessionBody.sessionToken, /^v2\.github-pages\./);

  const settings = await worker.fetch(
    new Request("http://localhost/api/admin/settings", {
      method: "PUT",
      headers: {
        authorization: `Bearer ${sessionBody.sessionToken}`,
        "content-type": "application/json",
        origin: pagesOrigin,
        "sec-fetch-site": "cross-site",
        "x-catharsis-admin-request": "1",
      },
      body: JSON.stringify({ horizonDays: 21, leadMinutes: 60, cancelCutoffMinutes: 1440, bookingOpen: true }),
    }),
    testEnv(),
    testContext,
  );
  assert.equal(settings.status, 200);
  assert.equal(settings.headers.get("access-control-allow-origin"), pagesOrigin);

  const wrongAudience = await worker.fetch(
    new Request("http://localhost/api/admin/settings", {
      method: "PUT",
      headers: {
        authorization: `Bearer ${sessionBody.sessionToken}`,
        "content-type": "application/json",
        origin: "http://localhost",
        "x-catharsis-admin-request": "1",
      },
      body: "{}",
    }),
    testEnv(),
    testContext,
  );
  assert.equal(wrongAudience.status, 401);
});

test("requires payment before a public reservation and protects owner app pairing", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("payment-gate-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const pagesOrigin = "https://sosirusok.github.io";

  const direct = await worker.fetch(
    new Request("http://localhost/api/public/reservations", {
      method: "POST",
      headers: { origin: pagesOrigin, "content-type": "application/json" },
      body: "{}",
    }),
    testEnv(),
    testContext,
  );
  assert.equal(direct.status, 402);
  assert.equal((await direct.json()).error.code, "PAYMENT_REQUIRED");

  const pairing = await worker.fetch(
    new Request("http://localhost/api/owner-app/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessKey: "wrong-owner-key", deviceName: "Owner Phone" }),
    }),
    testEnv(),
    testContext,
  );
  assert.equal(pairing.status, 401);
  const pairingBody = await pairing.json();
  assert.equal(pairingBody.error.code, "INVALID_ACCESS_KEY");
  assert.equal(pairingBody.token, undefined);
});
