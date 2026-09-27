import { copyFile, mkdir, open, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const MODULE_ROOT = dirname(fileURLToPath(import.meta.url));
export const REMINDER_STATE_VERSION = 2;
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
    for (const [key, baseline] of Object.entries(value.baselines)) {
      if (!baseline || typeof baseline !== "object") continue;
      const itemKeys = Array.isArray(baseline.itemKeys)
        ? baseline.itemKeys.map((item) => cleanString(item, 500)).filter(Boolean)
        : [];
      state.baselines[cleanString(key, 500)] = {
        followedAt: cleanString(baseline.followedAt, 80),
        itemKeys,
        ready: Boolean(baseline.ready),
      };
    }
  }
  if (value.items && typeof value.items === "object") {
    for (const [key, item] of Object.entries(value.items)) {
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
  const publishedAt = cleanString(value.publishedAt, 80);
  const publishedPrecision = ["day", "month", "year"].includes(
    value.publishedPrecision,
  )
    ? value.publishedPrecision
    : /^\d{4}-01-01(?:T|$)/.test(publishedAt)
      ? "year"
      : /^\d{4}-\d{1,2}$/.test(publishedAt)
        ? "month"
        : /^\d{4}/.test(publishedAt)
          ? "day"
          : "year";
  return {
    id,
    doi: cleanString(value.doi, 320).replace(/^https?:\/\/doi\.org\//i, "").toLowerCase(),
    title,
    authors: Array.isArray(value.authors)
      ? value.authors.slice(0, 30).map((author) => cleanString(author?.name || author, 240)).filter(Boolean)
      : [],
    venue: cleanString(value.venue, 500),
    publishedAt,
    publishedPrecision,
    url: cleanString(value.url, 1000),
    abstract: cleanString(value.abstract, 12000),
    keywords: Array.isArray(value.keywords)
      ? value.keywords.slice(0, 30).map((item) => cleanString(item, 160)).filter(Boolean)
      : [],
    matches: Array.isArray(value.matches)
      ? value.matches.slice(0, 20).map((match) => ({
          kind: ["journal", "scholar", "keyword"].includes(match?.kind) ? match.kind : "scholar",
          label: cleanString(match?.label, 300),
          subscriptionId: cleanString(match?.subscriptionId, 300),
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
    return cleanReminderState(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    try {
      return cleanReminderState(JSON.parse(await readFile(`${file}.backup`, "utf8")));
    } catch {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      return emptyReminderState();
    }
  }
}

export async function writeJsonAtomic(file, value) {
  return withDirectoryLock(join(dirname(file), ".migration-write.lock"), async () => {
    await assertMigrationReady(dirname(file));
    return writeJsonAtomicUnlocked(file, value);
  });
}

async function writeJsonAtomicUnlocked(file, value) {
  await mkdir(dirname(file), { recursive: true });
  try {
    JSON.parse(await readFile(file, "utf8"));
    await copyFile(file, `${file}.backup`);
  } catch {
    // Missing or corrupt primary files must not replace a known-good backup.
  }
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

const MIGRATION_JOURNAL = ".migration-recovery.json";

async function optionalBytes(file) {
  try { return await readFile(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function sameBytes(first, second) {
  return first === null || second === null ? first === second : first.equals(second);
}

export async function migrationRecoveryStatus(directory) {
  const bytes = await optionalBytes(join(directory, MIGRATION_JOURNAL));
  if (bytes === null) return { blocked: false, cleanupPending: false };
  try {
    const record = JSON.parse(bytes);
    const finished = ["committed", "restored"].includes(record.phase);
    return { blocked: !finished, cleanupPending: finished, phase: record.phase };
  } catch { return { blocked: true, cleanupPending: false, phase: "unknown" }; }
}

export async function assertMigrationReady(directory) {
  if ((await migrationRecoveryStatus(directory)).blocked) {
    const error = new Error("资料迁移恢复未完成，请保留当前及旧版文件夹和恢复材料，停止覆盖并人工处理。");
    error.code = "MIGRATION_RECOVERY_REQUIRED";
    throw error;
  }
}

async function durableBytes(file, bytes, exclusive = false) {
  const temporary = exclusive ? file : `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  if (!exclusive) await rename(temporary, file);
}

/** Shared by automatic migration and the portable manual importer. All regular
 * JSON writers use this same lock. The journal contains names, not file content;
 * incomplete transactions are never replayed or discarded on restart. */
export async function installFileTransaction(files, options = {}) {
  if (!files.length) return [];
  const directory = dirname(resolve(files[0].destination));
  if (files.some((file) => dirname(resolve(file.destination)) !== directory) ||
      new Set(files.map((file) => resolve(file.destination))).size !== files.length) {
    throw new Error("Migration destinations must be unique files in one directory");
  }
  await mkdir(directory, { recursive: true });
  return withDirectoryLock(join(directory, ".migration-write.lock"), async () => {
    await assertMigrationReady(directory);
    const journal = join(directory, MIGRATION_JOURNAL);
    // A completed journal may still name files whose cleanup failed. Keep it
    // intact for diagnosis instead of silently replacing the remaining record.
    if ((await migrationRecoveryStatus(directory)).cleanupPending) {
      const error = new Error("上次资料迁移已结束，但残留清理未完成，请先处理保留的记录。");
      error.code = "MIGRATION_CLEANUP_REQUIRED";
      throw error;
    }
    const prepared = [];
    for (const [index, file] of files.entries()) {
      const original = await optionalBytes(file.destination);
      if (Object.hasOwn(file, "expectedBytes") && !sameBytes(original, file.expectedBytes)) {
        throw new Error("Migration target changed before replacement");
      }
      const id = randomUUID();
      prepared.push({ ...file, original, index,
        temporary: `${file.destination}.migration-${id}`,
        backup: original === null ? "" : `${file.destination}.backup-migration-${id}.json`,
        restoreTemporary: `${file.destination}.restore-${id}`,
      });
    }
    const record = { phase: "prepared", files: prepared.map((file) => ({
      destination: basename(file.destination), temporary: basename(file.temporary),
      backup: file.backup ? basename(file.backup) : "", existed: file.original !== null,
      restoreTemporary: basename(file.restoreTemporary),
    })) };
    const checkpoint = options.checkpoint || (async () => {});
    const save = async (phase, exclusive = false) => {
      await durableBytes(journal, JSON.stringify({ ...record, phase }), exclusive);
      record.phase = phase;
    };
    await save("prepared", true); // Names are durable before the first temporary is created.
    let primary;
    let recovery = "restored";
    try {
      for (const file of prepared) {
        const handle = await (options.openFile || open)(file.temporary, "wx", 0o600);
        try {
          await checkpoint("write", file.index);
          await handle.writeFile(file.bytes);
          await checkpoint("sync", file.index);
          await handle.sync();
        } finally { await handle.close(); }
        await checkpoint("close", file.index);
        if (file.backup) {
          await checkpoint("backup", file.index);
          await durableBytes(file.backup, file.original, true);
          if (!sameBytes(await readFile(file.backup), file.original)) throw new Error("Backup did not verify");
        }
      }
      for (const file of prepared) {
        if (!sameBytes(await optionalBytes(file.destination), file.original)) throw new Error("Migration target changed during preparation");
        await checkpoint("replace", file.index);
        await (options.renameFile || rename)(file.temporary, file.destination);
        if (!sameBytes(await readFile(file.destination), file.bytes)) throw new Error("Replacement did not verify");
      }
      await save("committed");
    } catch (error) {
      primary = error;
      const failures = [];
      for (const file of [...prepared].reverse()) {
        try {
          const current = await optionalBytes(file.destination);
          if (sameBytes(current, file.original)) continue;
          if (!sameBytes(current, file.bytes)) throw new Error("Target changed outside migration; preserving recovery material");
          await checkpoint("restore", file.index);
          if (file.original === null) await rm(file.destination);
          else {
            const backup = await readFile(file.backup);
            if (!sameBytes(backup, file.original)) throw new Error("Recovery backup did not verify");
            await durableBytes(file.restoreTemporary, backup, true);
            await rename(file.restoreTemporary, file.destination);
          }
          if (!sameBytes(await optionalBytes(file.destination), file.original)) throw new Error("Restoration did not verify");
        } catch (failure) { failures.push(failure); }
      }
      if (failures.length) {
        error.recoveryErrors = failures;
        recovery = "incomplete";
        // The prepared journal is already durable even if this update fails.
        await save("recovery-required").catch(() => {});
      } else {
        try { await save("restored"); }
        catch (failure) { error.recoveryErrors = [failure]; recovery = "incomplete"; }
      }
    }
    let cleanupFailed = false;
    if (recovery !== "incomplete") {
      for (const file of prepared) {
        try {
          await checkpoint("cleanup", file.index);
          await rm(file.temporary, { force: true });
          await rm(file.restoreTemporary, { force: true });
          if (primary && file.backup) await rm(file.backup, { force: true });
        } catch { cleanupFailed = true; }
      }
      if (!cleanupFailed) {
        try { await rm(journal); } catch { cleanupFailed = true; }
      }
    }
    if (primary) {
      primary.recovery = recovery;
      primary.cleanupFailed = cleanupFailed;
      throw primary;
    }
    if (cleanupFailed) {
      const error = new Error("资料已迁移，但临时文件清理未完成，请保留恢复记录。");
      error.code = "MIGRATION_CLEANUP_REQUIRED";
      error.recovery = "committed";
      error.cleanupFailed = true;
      throw error;
    }
    return prepared.filter((file) => file.backup).map((file) => file.backup);
  });
}

export async function writeReminderState(root, value) {
  const state = cleanReminderState(value);
  await writeJsonAtomic(reminderStateFile(root), state);
  return state;
}

export async function withDirectoryLock(lock, callback, timeoutMs = 15000) {
  await mkdir(dirname(lock), { recursive: true });
  const started = Date.now();
  const owner = `${process.pid}:${randomUUID()}`;
  while (true) {
    try {
      await mkdir(lock);
      await writeFile(join(lock, "owner"), owner, "utf8");
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
  const heartbeat = setInterval(() => {
    const now = new Date();
    void utimes(lock, now, now).catch(() => undefined);
  }, 30_000);
  heartbeat.unref();
  try {
    return await callback();
  } finally {
    clearInterval(heartbeat);
    try {
      const currentOwner = await readFile(join(lock, "owner"), "utf8");
      if (currentOwner === owner) {
        await rm(lock, { recursive: true, force: true });
      }
    } catch {
      // A stale-lock recovery may already have removed or replaced this lock.
    }
  }
}

export async function withReminderLock(root, callback, timeoutMs = 15000) {
  return withDirectoryLock(reminderLockPath(root), callback, timeoutMs);
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
        const error = new Error(result.stderr.trim() || `${command} failed`);
        error.code = result.code;
        error.stdout = result.stdout;
        error.stderr = result.stderr;
        rejectProcess(error);
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

async function readWindowsSecret(secretRoot, helperRoot = secretRoot) {
  const raw = JSON.parse(await readFile(reminderSecretFile(secretRoot), "utf8"));
  if (raw?.version !== REMINDER_SECRET_VERSION) {
    throw new Error("Unsupported encrypted reminder secret version.");
  }
  const ciphertext = cleanString(raw.ciphertext, 2000);
  if (!ciphertext) throw new Error("Encrypted reminder secret is empty.");
  const helper = resolve(helperRoot, "tools", "dpapi-helper.ps1");
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
  await assertMigrationReady(resolve(root, "data"));
  if (!cleanString(secret, 500)) throw new Error("请输入邮箱授权码或应用专用密码。");
  if (process.platform === "win32") return storeWindowsSecret(root, secret);
  if (process.platform === "darwin") return storeMacSecret(root, config, secret);
  throw new Error("当前平台暂不支持安全保存邮箱凭据。");
}

export async function inspectReminderSecret(root, config, options = {}) {
  const platform = options.platform || process.platform;
  const secretRoot = options.secretRoot || root;
  const helperRoot = options.helperRoot || root;
  try {
    const secret = platform === "win32"
      ? await readWindowsSecret(secretRoot, helperRoot)
      : platform === "darwin"
        ? await readMacSecret(helperRoot, config)
        : "";
    if (platform !== "win32" && platform !== "darwin") {
      return { status: "unsupported", secret: "" };
    }
    return secret
      ? { status: "configured", secret }
      : { status: "unreadable", secret: "" };
  } catch (error) {
    if (platform === "win32" && error?.code === "ENOENT") {
      return { status: "missing", secret: "" };
    }
    if (
      platform === "darwin" &&
      /Keychain operation failed:\s*-25300\b/.test(String(error?.stderr || error?.message || ""))
    ) {
      return { status: "missing", secret: "" };
    }
    return { status: "unreadable", secret: "" };
  }
}

export async function readReminderSecret(root, config) {
  return (await inspectReminderSecret(root, config)).secret;
}

export async function deleteReminderSecret(root, config) {
  await assertMigrationReady(resolve(root, "data"));
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
