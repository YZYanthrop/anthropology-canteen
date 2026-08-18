import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const MODULE_ROOT = dirname(fileURLToPath(import.meta.url));
export const REMINDER_STATE_VERSION = 1;
export const REMINDER_SECRET_VERSION = 1;
export const REMINDER_SERVICE = "org.anthropology-canteen.smtp";

export function cleanString(value, max = 400) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function cleanEmail(value) {
  const email = cleanString(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export function normalizeProvider(value) {
  const provider = cleanString(value, 40).toLowerCase();
  return ["qq", "163", "126", "yeah", "gmail", "icloud", "custom"].includes(provider)
    ? provider
    : "custom";
}

export function cleanReminderConfig(value = {}) {
  const schedule = value?.schedule && typeof value.schedule === "object"
    ? value.schedule
    : {};
  const cadence = ["daily", "weekly", "monthly"].includes(schedule.cadence)
    ? schedule.cadence
    : "daily";
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)
    ? schedule.time
    : "08:00";
  const weekday = Number.isInteger(schedule.weekday) && schedule.weekday >= 0 && schedule.weekday <= 6
    ? schedule.weekday
    : 1;
  const monthDay = Number.isInteger(schedule.monthDay) && schedule.monthDay >= 1 && schedule.monthDay <= 28
    ? schedule.monthDay
    : 1;
  const format = value.format === "detailed" ? "detailed" : "concise";
  const host = cleanString(value.host, 240).toLowerCase();
  const port = Number.isInteger(value.port) && value.port >= 465 && value.port <= 587
    ? value.port
    : 465;
  const security = value.security === "starttls" ? "starttls" : "tls";
  const sender = cleanEmail(value.sender);
  const recipient = cleanEmail(value.recipient);
  const installationId = /^[a-z0-9-]{16,80}$/.test(cleanString(value.installationId, 80))
    ? cleanString(value.installationId, 80)
    : randomUUID();
  return {
    enabled: Boolean(value.enabled),
    installationId,
    provider: normalizeProvider(value.provider || "qq"),
    sender,
    recipient,
    host,
    port,
    security,
    username: cleanEmail(value.username) || sender,
    format,
    schedule: { cadence, time, weekday, monthDay },
    credentialRef: cleanString(value.credentialRef, 120) || installationId,
    testedConfigHash: cleanString(value.testedConfigHash, 128),
    schedulerPath: cleanString(value.schedulerPath, 1000),
    configuredAt: cleanString(value.configuredAt, 80),
  };
}

export function emptyReminderState() {
  return {
    version: REMINDER_STATE_VERSION,
    enabledAt: "",
    baselineComplete: false,
    baselines: {},
    items: {},
    pendingDigest: null,
    lastAttemptAt: "",
    lastCheckAt: "",
    lastSuccessfulCheckAt: "",
    lastSuccessfulSendAt: "",
    nextDueAt: "",
    lastError: "",
    lastResult: "",
  };
}

export function reminderStateFile(root = MODULE_ROOT) {
  return resolve(root, "data", "anthropology-canteen-reminder-state.json");
}

export function reminderLockPath(root = MODULE_ROOT) {
  return resolve(root, "data", ".anthropology-canteen-reminder.lock");
}

export function reminderSecretFile(root = MODULE_ROOT) {
  return resolve(root, "data", "anthropology-canteen-reminder-secret.json");
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function cleanReminderState(value) {
  const state = emptyReminderState();
  if (!value || typeof value !== "object") return state;
  state.enabledAt = cleanString(value.enabledAt, 80);
  state.baselineComplete = Boolean(value.baselineComplete);
  state.lastAttemptAt = cleanString(value.lastAttemptAt, 80);
  state.lastCheckAt = cleanString(value.lastCheckAt, 80);
  state.lastSuccessfulCheckAt = cleanString(value.lastSuccessfulCheckAt, 80);
  state.lastSuccessfulSendAt = cleanString(value.lastSuccessfulSendAt, 80);
  state.nextDueAt = cleanString(value.nextDueAt, 80);
  state.lastError = cleanString(value.lastError, 600);
  state.lastResult = cleanString(value.lastResult, 120);
  if (value.baselines && typeof value.baselines === "object") {
    for (const [key, baseline] of Object.entries(value.baselines).slice(0, 1000)) {
      if (!baseline || typeof baseline !== "object") continue;
      const itemKeys = Array.isArray(baseline.itemKeys)
        ? baseline.itemKeys.slice(0, 500).map((item) => cleanString(item, 500)).filter(Boolean)
        : [];
      state.baselines[cleanString(key, 500)] = {
        followedAt: cleanString(baseline.followedAt, 80),
        itemKeys,
        ready: Boolean(baseline.ready),
      };
    }
  }
  if (value.items && typeof value.items === "object") {
    for (const [key, item] of Object.entries(value.items).slice(0, 5000)) {
      if (!item || typeof item !== "object") continue;
      const itemKey = cleanString(key, 500);
      if (!itemKey) continue;
      state.items[itemKey] = {
        firstSeenAt: cleanString(item.firstSeenAt, 80),
        baseline: Boolean(item.baseline),
        sentAt: cleanString(item.sentAt, 80),
        article: item.article && typeof item.article === "object"
          ? sanitizeArticle(item.article)
          : null,
      };
    }
  }
  if (value.pendingDigest && typeof value.pendingDigest === "object") {
    state.pendingDigest = {
      digestId: cleanString(value.pendingDigest.digestId, 160),
      itemKeys: Array.isArray(value.pendingDigest.itemKeys)
        ? value.pendingDigest.itemKeys.slice(0, 200).map((item) => cleanString(item, 500)).filter(Boolean)
        : [],
      createdAt: cleanString(value.pendingDigest.createdAt, 80),
    };
  }
  return state;
}

export function sanitizeArticle(value) {
  const title = cleanString(value.title, 1000);
  const id = cleanString(value.id, 800) || title.toLowerCase();
  return {
    id,
    doi: cleanString(value.doi, 320).replace(/^https?:\/\/doi\.org\//i, "").toLowerCase(),
    title,
    authors: Array.isArray(value.authors)
      ? value.authors.slice(0, 30).map((author) => cleanString(author?.name || author, 240)).filter(Boolean)
      : [],
    venue: cleanString(value.venue, 500),
    publishedAt: cleanString(value.publishedAt, 80),
    url: cleanString(value.url, 1000),
    abstract: cleanString(value.abstract, 12000),
    keywords: Array.isArray(value.keywords)
      ? value.keywords.slice(0, 30).map((item) => cleanString(item, 160)).filter(Boolean)
      : [],
    matches: Array.isArray(value.matches)
      ? value.matches.slice(0, 20).map((match) => ({
          kind: ["journal", "scholar", "keyword"].includes(match?.kind) ? match.kind : "scholar",
          label: cleanString(match?.label, 300),
          terms: Array.isArray(match?.terms)
            ? match.terms.slice(0, 20).map((item) => cleanString(item, 120)).filter(Boolean)
            : [],
        }))
      : [],
  };
}

export async function readReminderState(root = MODULE_ROOT) {
  const file = reminderStateFile(root);
  try {
    return cleanReminderState(parseJson(await readFile(file, "utf8"), {}));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return emptyReminderState();
  }
}

export async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temp, "w");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, file);
}

export async function writeReminderState(root, value) {
  const state = cleanReminderState(value);
  await writeJsonAtomic(reminderStateFile(root), state);
  return state;
}

export async function withReminderLock(root, callback, timeoutMs = 15000) {
  const lock = reminderLockPath(root);
  await mkdir(dirname(lock), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      await mkdir(lock);
      await writeFile(join(lock, "pid"), String(process.pid), "utf8");
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const info = await stat(lock);
        if (Date.now() - info.mtimeMs > 10 * 60 * 1000) {
          await rm(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        // The lock disappeared between stat and retry.
      }
      if (Date.now() - started >= timeoutMs) {
        throw new Error("Anthropology Canteen reminder data is busy.");
      }
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 150));
    }
  }
  try {
    return await callback();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

function runProcess(command, args, input = "") {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", rejectProcess);
    child.once("close", (code) => {
      const result = { code: code ?? 1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
      if (result.code !== 0) {
        rejectProcess(new Error(result.stderr.trim() || `${command} failed`));
      } else {
        resolveProcess(result.stdout.trim());
      }
    });
    child.stdin.end(input);
  });
}

async function storeWindowsSecret(root, secret) {
  const helper = resolve(root, "tools", "dpapi-helper.ps1");
  const encrypted = await runProcess("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    helper,
    "-Mode",
    "protect",
  ], secret);
  await writeJsonAtomic(reminderSecretFile(root), {
    version: REMINDER_SECRET_VERSION,
    ciphertext: encrypted,
  });
}

async function readWindowsSecret(root) {
  const raw = parseJson(await readFile(reminderSecretFile(root), "utf8"), {});
  const ciphertext = cleanString(raw.ciphertext, 2000);
  if (!ciphertext) return "";
  const helper = resolve(root, "tools", "dpapi-helper.ps1");
  return runProcess("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    helper,
    "-Mode",
    "unprotect",
  ], ciphertext);
}

function keychainHelper(root) {
  return resolve(root, "tools", "anthropology-canteen-keychain");
}

async function storeMacSecret(root, config, secret) {
  const helper = keychainHelper(root);
  return runProcess(helper, ["set", REMINDER_SERVICE, config.credentialRef], secret);
}

async function readMacSecret(root, config) {
  const helper = keychainHelper(root);
  return runProcess(helper, ["get", REMINDER_SERVICE, config.credentialRef]);
}

export async function saveReminderSecret(root, config, secret) {
  if (!cleanString(secret, 500)) throw new Error("请输入邮箱授权码或应用专用密码。");
  if (process.platform === "win32") return storeWindowsSecret(root, secret);
  if (process.platform === "darwin") return storeMacSecret(root, config, secret);
  throw new Error("当前平台暂不支持安全保存邮箱凭据。");
}

export async function readReminderSecret(root, config) {
  try {
    if (process.platform === "win32") return await readWindowsSecret(root);
    if (process.platform === "darwin") return await readMacSecret(root, config);
  } catch {
    return "";
  }
  return "";
}

export async function deleteReminderSecret(root, config) {
  if (process.platform === "win32") {
    await rm(reminderSecretFile(root), { force: true });
    return;
  }
  if (process.platform === "darwin") {
    try {
      await runProcess(keychainHelper(root), ["delete", REMINDER_SERVICE, config.credentialRef]);
    } catch {
      // Deleting an already-missing key is idempotent.
    }
  }
}

export function reminderModuleRoot() {
  return MODULE_ROOT;
}

export function moduleUrl(path) {
  return pathToFileURL(path).href;
}
