import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanReminderConfig,
  readReminderState,
  readReminderSecret,
  sanitizeArticle,
  withReminderLock,
  writeReminderState,
} from "./reminder-utils.mjs";
import { renderDigest, sendMail } from "./reminder-mail.mjs";
import {
  fetchFeedForReminder,
  patchLocalDataFile,
  readLocalDataFile,
  readLocalSettingsFile,
} from "./portable-server.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

function nowIso() {
  return new Date().toISOString();
}

function articleKey(article) {
  const doi = String(article.doi || "").replace(/^https?:\/\/doi\.org\//i, "").trim().toLowerCase();
  if (doi) return `doi:${doi}`;
  const title = String(article.title || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const year = String(article.publishedAt || "").slice(0, 4);
  const author = String(article.authors?.[0]?.name || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!title) {
    const stable = String(article.id || "").trim();
    if (stable) return `id:${stable}`;
  }
  return `hash:${createHash("sha256").update(`${title}|${year}|${author}`).digest("hex")}`;
}

function legacyScopeKey(kind, label) {
  return `${kind}:${String(label || "").trim().toLowerCase()}`;
}

function subscriptionScopeKey(kind, item) {
  if (kind === "scholar") {
    return `scholar:${String(item.subscriptionId || "").trim() || String(item.label || "").trim().toLowerCase()}`;
  }
  if (kind === "journal") {
    return `journal:${String(item.issn || "").trim().toLowerCase() || String(item.label || "").trim().toLowerCase()}`;
  }
  return `keyword:${String(item.root || "").trim().toLowerCase()}`;
}

function subscriptionScopes(subscriptions) {
  return [
    ...(subscriptions?.scholar || []).map((item) => ({
      key: subscriptionScopeKey("scholar", item),
      legacyKey: legacyScopeKey("scholar", item.label),
      followedAt: item.followedAt,
    })),
    ...(subscriptions?.journal || []).map((item) => ({
      key: subscriptionScopeKey("journal", item),
      legacyKey: legacyScopeKey("journal", item.label),
      followedAt: item.followedAt,
    })),
    ...(subscriptions?.keyword || []).map((item) => ({
      key: subscriptionScopeKey("keyword", item),
      legacyKey: legacyScopeKey("keyword", item.root),
      followedAt: item.followedAt,
    })),
  ];
}

function articleScopes(article) {
  return (article.matches || [])
    .filter((match) => ["scholar", "journal", "keyword"].includes(match.kind))
    .map((match) => {
      const label = match.kind === "keyword"
        ? String(match.label || "").split(" /")[0]
        : match.label;
      if (match.subscriptionId) return `${match.kind}:${match.subscriptionId}`;
      return legacyScopeKey(match.kind, label);
    });
}

function nextDueAt(config, from = new Date()) {
  const [hour, minute] = config.schedule.time.split(":").map(Number);
  const candidate = new Date(from);
  candidate.setHours(hour, minute, 0, 0);
  if (candidate <= from) candidate.setDate(candidate.getDate() + 1);
  if (config.schedule.cadence === "weekly") {
    const offset = (config.schedule.weekday - candidate.getDay() + 7) % 7;
    candidate.setDate(candidate.getDate() + offset);
    if (candidate <= from) candidate.setDate(candidate.getDate() + 7);
  } else if (config.schedule.cadence === "monthly") {
    candidate.setDate(config.schedule.monthDay);
    if (candidate <= from) {
      candidate.setMonth(candidate.getMonth() + 1, config.schedule.monthDay);
    }
  }
  return candidate.toISOString();
}

function dueNow(config, state, force) {
  if (force) return true;
  if (!state.nextDueAt) return true;
  const due = Date.parse(state.nextDueAt);
  return !Number.isFinite(due) || Date.now() >= due;
}

function digestId(itemKeys) {
  return `ac-${createHash("sha256").update(itemKeys.join("|")).digest("hex").slice(0, 24)}`;
}

export function reconcileReminderState(state, subscriptions, feed, startedAt) {
  const scopes = subscriptionScopes(subscriptions);
  const scopeMap = new Map(scopes.map((scope) => [scope.key, scope]));
  const failedScopes = new Set(
    (feed.coverage || [])
      .filter((entry) => entry.status === "failed")
      .map((entry) => `${entry.kind}:${entry.subscriptionId}`),
  );
  const baselineItems = Array.isArray(feed.items)
    ? feed.items.map(sanitizeArticle)
    : [];
  const items = feed.source === "fallback" ? [] : baselineItems;

  for (const scope of scopes) {
    if (failedScopes.has(scope.key)) continue;
    if (!state.baselines[scope.key] && state.baselines[scope.legacyKey]) {
      state.baselines[scope.key] = state.baselines[scope.legacyKey];
      delete state.baselines[scope.legacyKey];
    }
    if (!state.baselines[scope.key]) {
      state.baselines[scope.key] = {
        followedAt: scope.followedAt || startedAt,
        itemKeys: [],
        ready: false,
      };
    }
    if (!state.baselines[scope.key].ready) {
      const baselineKeys = baselineItems
        .filter((item) => articleScopes(item).includes(scope.key))
        .map(articleKey);
      state.baselines[scope.key].itemKeys = [...new Set(baselineKeys)];
      state.baselines[scope.key].ready = true;
    }
  }

  const knownKeys = new Set(Object.keys(state.items));
  for (const article of items) {
    const key = articleKey(article);
    if (!key || knownKeys.has(key)) continue;
    const matchedScopes = articleScopes(article).filter(
      (scope) => scopeMap.has(scope) && !failedScopes.has(scope),
    );
    if (!matchedScopes.length) continue;
    const isBaseline = matchedScopes.some((scope) =>
      state.baselines[scope]?.itemKeys.includes(key),
    );
    state.items[key] = {
      firstSeenAt: startedAt,
      baseline: isBaseline,
      sentAt: isBaseline ? startedAt : "",
      article,
    };
    knownKeys.add(key);
  }

  state.baselineComplete = scopes.every(
    (scope) => Boolean(state.baselines[scope.key]?.ready),
  );
  return Object.entries(state.items)
    .filter(([, item]) => item && !item.baseline && !item.sentAt && item.article)
    .map(([key, item]) => ({ key, article: item.article }))
    .sort(
      (a, b) =>
        Date.parse(b.article.publishedAt || "") -
        Date.parse(a.article.publishedAt || ""),
    );
}

async function processReminder({ force = false, test = false } = {}) {
  const settings = await readLocalSettingsFile();
  const config = cleanReminderConfig(settings.reminders);
  if (test) {
    const password = await readReminderSecret(ROOT, config);
    if (!password) throw new Error("邮箱授权码未配置或无法从系统安全存储读取。");
    await sendMail({ root: ROOT, config, password, message: renderDigest({ items: [], test: true }) });
    return { sent: true, test: true };
  }
  if (!config.enabled) return { skipped: true, reason: "disabled" };

  return withReminderLock(ROOT, async () => {
    const state = await readReminderState(ROOT);
    if (!dueNow(config, state, force) && !state.pendingDigest) {
      return { skipped: true, reason: "not-due", nextDueAt: state.nextDueAt };
    }
    const startedAt = nowIso();
    state.lastAttemptAt = startedAt;
    const data = await readLocalDataFile();
    const feed = await fetchFeedForReminder(data.subscriptions);
    // Re-read immediately before writing so a browser save that happened
    // while providers were loading is preserved; the worker only replaces
    // the feed field.
    const mergedData = await patchLocalDataFile({ feed });
    const pending = reconcileReminderState(
      state,
      mergedData.subscriptions,
      feed,
      startedAt,
    );

    const warnings = Array.isArray(feed.warnings) ? feed.warnings.slice(0, 8) : [];
    const hasFailedCoverage = (feed.coverage || []).some(
      (entry) => entry.status === "failed",
    );
    if (!pending.length) {
      state.lastCheckAt = startedAt;
      if (!hasFailedCoverage) state.lastSuccessfulCheckAt = startedAt;
      state.lastResult = hasFailedCoverage ? "partial-failure" : "no-updates";
      state.lastError = warnings.length ? warnings.join("；") : "";
      state.nextDueAt = nextDueAt(config, new Date());
      await writeReminderState(ROOT, state);
      return { sent: false, count: 0, nextDueAt: state.nextDueAt, warnings };
    }

    const selected = pending.slice(0, 50);
    const omitted = pending.length - selected.length;
    const selectedKeys = selected.map((item) => item.key);
    const digest = state.pendingDigest?.digestId && state.pendingDigest.itemKeys.join("|") === selectedKeys.join("|")
      ? state.pendingDigest.digestId
      : digestId(selectedKeys);
    state.pendingDigest = { digestId: digest, itemKeys: selectedKeys, createdAt: startedAt };
    await writeReminderState(ROOT, state);
    const password = await readReminderSecret(ROOT, config);
    if (!password) throw new Error("邮箱授权码未配置或无法从系统安全存储读取。");
    try {
      await sendMail({
        root: ROOT,
        config,
        password,
        message: { ...renderDigest({ items: selected.map((item) => item.article), format: config.format, warnings, omitted }), messageId: `<${digest}@anthropology-canteen.local>` },
      });
    } catch (error) {
      state.lastError = String(error?.message || error).slice(0, 600);
      state.lastResult = "send-failed";
      state.lastCheckAt = startedAt;
      await writeReminderState(ROOT, state);
      throw error;
    }
    const sentAt = nowIso();
    for (const key of selectedKeys) {
      if (state.items[key]) state.items[key].sentAt = sentAt;
    }
    state.pendingDigest = null;
    state.lastCheckAt = startedAt;
    if (!hasFailedCoverage) state.lastSuccessfulCheckAt = sentAt;
    state.lastSuccessfulSendAt = sentAt;
    state.lastResult = `sent-${selected.length}`;
    state.lastError = warnings.length ? warnings.join("；") : "";
    state.nextDueAt = nextDueAt(config, new Date());
    await writeReminderState(ROOT, state);
    return { sent: true, count: selected.length, omitted, nextDueAt: state.nextDueAt, warnings };
  });
}

export async function runReminderOnce(options = {}) {
  return processReminder(options);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const force = process.argv.includes("--force");
  const test = process.argv.includes("--test");
  processReminder({ force, test })
    .then((result) => {
      if (result?.skipped) console.log(`Anthropology Canteen reminder skipped: ${result.reason}.`);
    })
    .catch((error) => {
      console.error(`Anthropology Canteen reminder failed: ${error?.message || error}`);
      process.exitCode = 1;
    });
}
