import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  cleanReminderConfig,
  emptyReminderState,
  readReminderState,
  withReminderLock,
  writeReminderState,
} from "../reminder-utils.mjs";
import { renderDigest, smtpConfig } from "../reminder-mail.mjs";

test("reminder configuration clamps schedule and enforces safe defaults", () => {
  const config = cleanReminderConfig({
    provider: "QQ",
    sender: "Small@Example.com",
    recipient: "Reader@Outlook.com",
    port: 25,
    schedule: { cadence: "monthly", time: "99:99", monthDay: 99 },
  });
  assert.equal(config.provider, "qq");
  assert.equal(config.sender, "small@example.com");
  assert.equal(config.recipient, "reader@outlook.com");
  assert.equal(config.port, 465);
  assert.equal(config.schedule.time, "08:00");
  assert.equal(config.schedule.monthDay, 1);
  assert.match(config.installationId, /^[a-z0-9-]{16,80}$/);
});

test("SMTP policy rejects insecure ports and mismatched auth address", () => {
  const base = {
    provider: "custom",
    sender: "small@example.com",
    recipient: "reader@outlook.com",
    username: "small@example.com",
    host: "smtp.example.com",
    port: 465,
    security: "tls",
  };
  assert.equal(smtpConfig(base, "app-password").secure, true);
  assert.throws(() => smtpConfig({ ...base, port: 25 }, "app-password"), /465 或 587/);
  assert.throws(() => smtpConfig({ ...base, port: 587, security: "tls" }, "app-password"), /STARTTLS/);
  assert.throws(() => smtpConfig({ ...base, username: "other@example.com" }, "app-password"), /认证邮箱一致/);
});

test("digest is scholar-first, static, escaped, and keeps abstracts optional", () => {
  const result = renderDigest({
    format: "detailed",
    items: [
      {
        title: "A <new> work",
        authors: ["Veena Das"],
        venue: "Ethos",
        publishedAt: "2026-01-02",
        url: "https://doi.org/10.1234/example",
        abstract: "A short abstract.",
        matches: [{ kind: "scholar", label: "Veena Das", terms: ["ethics"] }],
      },
      {
        title: "Journal item",
        authors: ["Author"],
        venue: "HAU",
        publishedAt: "2026-01-01",
        matches: [{ kind: "journal", label: "HAU", terms: [] }],
      },
      {
        title: "Unsafe link",
        authors: ["Author"],
        venue: "Ethnos",
        publishedAt: "2026-01-01",
        url: "javascript:alert(1)",
        matches: [{ kind: "journal", label: "Ethnos", terms: [] }],
      },
    ],
  });
  assert.match(result.subject, /1 位学者有 3 项/);
  assert.ok(result.text.indexOf("学者：Veena Das") < result.text.indexOf("期刊：HAU"));
  assert.match(result.text, /摘要：A short abstract/);
  assert.match(result.html, /A &lt;new&gt; work/);
  assert.doesNotMatch(result.html, /<script/i);
  assert.doesNotMatch(result.html, /javascript:/i);
});

test("reminder state writes atomically and survives a second read", async () => {
  const root = await mkdtemp(join(tmpdir(), "anthropology-canteen-reminder-"));
  try {
    const state = emptyReminderState();
    state.baselineComplete = true;
    state.lastResult = "no-updates";
    await withReminderLock(root, () => writeReminderState(root, state));
    const restored = await readReminderState(root);
    assert.equal(restored.version, 1);
    assert.equal(restored.baselineComplete, true);
    assert.equal(restored.lastResult, "no-updates");
    const disk = JSON.parse(await readFile(join(root, "data", "anthropology-canteen-reminder-state.json"), "utf8"));
    assert.equal(disk.version, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
