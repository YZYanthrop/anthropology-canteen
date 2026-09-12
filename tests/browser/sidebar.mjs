import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import { browserFixture } from "./fixture.mjs";

// Run the synthetic preview server first. Requires an installed Edge browser;
// BROWSER_CHANNEL may select another locally installed Chromium channel.
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
const results = [];
await mkdir("outputs/v1.3.3-browser", { recursive: true });

async function openFixture(viewport, hasTouch = false, small = false) {
  const context = await browser.newContext({ viewport, hasTouch });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let data = browserFixture();
  if (small) data.subscriptions = { scholar: data.subscriptions.scholar.slice(0, 1), journal: [], keyword: [] };
  data.feed.scholars = data.subscriptions.scholar;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let value;
    if (path === "/api/runtime-status") value = { sessionToken: "test-session" };
    else if (path === "/api/local-data") {
      if (request.method() === "PATCH") data = { ...data, ...request.postDataJSON().patch, revision: data.revision + 1 };
      value = data;
    } else if (path === "/api/local-settings") value = { version: 3, openAlexConfigured: false };
    else if (path === "/api/reminders/status") value = { config: { enabled: false }, credentialConfigured: false, tested: false };
    else if (path === "/api/feed") value = { ...data.feed, scholars: data.subscriptions.scholar };
    else throw new Error(`Unexpected browser-test API: ${path}`);
    await route.fulfill({ json: value });
  });
  await page.goto("http://127.0.0.1:4173");
  await page.locator(".subscription-name").first().waitFor();
  assert.equal(await page.locator(".subscription-name").count(), small ? 1 : 100);
  return { context, page, errors, data: () => data };
}

try {
  for (const [width, height] of [[1440,900], [1024,600], [1024,400], [819,600], [820,600], [821,600], [390,844], [1024,250]]) {
    const { context, page, errors } = await openFixture({ width, height });
    const sidebar = page.getByRole("complementary", { name: "关注与筛选" });
    const independent = width > 820 && height > 280;
    const geometry = await sidebar.evaluate((el) => ({
      top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom,
      height: el.clientHeight, scrollHeight: el.scrollHeight, overflow: getComputedStyle(el).overflowY,
    }));
    assert.equal(geometry.overflow, independent ? "auto" : "visible");
    if (independent) {
      assert.ok(geometry.bottom <= height, `sidebar bottom ${geometry.bottom} > ${height}`);
      assert.ok(geometry.scrollHeight > geometry.height);
      await sidebar.focus();
      const before = await page.evaluate(() => window.scrollY);
      await page.keyboard.press("PageDown");
      await page.waitForFunction(() => document.querySelector(".sidebar").scrollTop > 0);
      assert.equal(await page.evaluate(() => window.scrollY), before, "keyboard must scroll only sidebar");
      const box = await sidebar.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const initialScroll = await sidebar.evaluate((el) => el.scrollTop);
      await page.mouse.wheel(0, 300);
      await page.waitForFunction((previous) => document.querySelector(".sidebar").scrollTop > previous, initialScroll);
      assert.equal(await page.evaluate(() => window.scrollY), before, "wheel must scroll only sidebar");
    }
    const last = page.locator(".subscription-name").last();
    await last.focus();
    const lastBox = await last.boundingBox();
    assert.ok(lastBox.y >= 0 && lastBox.y + lastBox.height <= height + 1, "last item must be reachable");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    assert.equal(await sidebar.evaluate((el) => el.contains(document.activeElement)), false, "Tab must leave sidebar");
    await page.getByRole("button", { name: "添加关注项" }).focus();
    const addBox = await page.getByRole("button", { name: "添加关注项" }).boundingBox();
    assert.ok(addBox.y >= 0 && addBox.y + addBox.height <= height + 1);
    // Collapse then reopen the last group to exercise scroll-range changes.
    const summary = page.locator(".subscription-group summary").last();
    await summary.click();
    assert.equal(await page.locator(".subscription-name:visible").count(), 80);
    await summary.click();
    assert.equal(await page.locator(".subscription-name:visible").count(), 100);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal page overflow");
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector(".sidebar").scrollTop = 0; });
    await page.screenshot({ path: `outputs/v1.3.3-browser/sidebar-${width}x${height}.png` });
    assert.deepEqual(errors, []);
    results.push({ width, height, independent, result: "passed" });
    await context.close();
  }
  const small = await openFixture({ width: 1024, height: 600 }, false, true);
  assert.ok(await small.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.equal(await small.page.locator(".subscription-group").count(), 3);
  await small.context.close();
  results.push({ scenario: "one item and empty groups", result: "passed" });
  console.log(JSON.stringify({ browser: browser.version(), results }, null, 2));
} finally {
  await browser.close();
}
