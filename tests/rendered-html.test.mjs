import assert from "node:assert/strict";
import test from "node:test";

test("renders the TripLog application shell", async () => {
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
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>旅記 TripLog<\/title>/i);
  assert.match(html, /全部旅程/);
  assert.match(html, /下一站/);
  assert.match(html, /設定/);
  assert.match(html, /尚未加入行程/);
  assert.doesNotMatch(html, /築地場外市場|teamLab Borderless|銀座 鳥よし/);
});
