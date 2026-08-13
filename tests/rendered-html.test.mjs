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
});
