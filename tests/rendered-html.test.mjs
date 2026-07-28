import assert from "node:assert/strict";
import test from "node:test";

const workerModule = await import("../dist/server/index.js");
const worker = workerModule.default;

test("production build renders the main application shell", async () => {
  const response = await worker.fetch(
    new Request("http://anthropology-canteen.localhost:3000/"),
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /^text\/html/);
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /Anthropology Canteen/);
  assert.match(html, /学者动态/);
  assert.match(html, /期刊更新/);
  assert.match(html, /关键词命中/);
});
