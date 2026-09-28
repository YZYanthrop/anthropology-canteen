import {
  access,
  lstat,
  readFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_NAME = "anthropology-canteen-data.json";
const SETTINGS_NAME = "anthropology-canteen-settings.json";
const REMINDER_STATE_NAME = "anthropology-canteen-reminder-state.json";
const REMINDER_SECRET_NAME = "anthropology-canteen-reminder-secret.json";
const PID_NAME = "anthropology-canteen-server.pid";
const SETTINGS_FIELDS = new Set([
  "version",
  "openAlexApiKey",
  "semanticScholarApiKey",
  "reminders",
]);

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error("Usage: import-data.mjs --source <path> --target-root <portable-folder>");
    }
    values.set(key, value);
  }
  const source = values.get("--source");
  const targetRoot = values.get("--target-root");
  if (!source || !targetRoot || values.size !== 2) {
    throw new Error("Usage: import-data.mjs --source <path> --target-root <portable-folder>");
  }
  return { source: resolve(source), targetRoot: resolve(targetRoot) };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function resolveSource(input) {
  const info = await lstat(input);
  if (info.isDirectory()) {
    const dataFile = join(input, DATA_NAME);
    if (!(await exists(dataFile))) {
      throw new Error(`The selected folder does not contain ${DATA_NAME}.`);
    }
    return { dataFile, sourceDirectory: input };
  }
  if (!info.isFile() || basename(input).toLowerCase() !== DATA_NAME) {
    throw new Error(`Choose the old data folder or ${DATA_NAME}.`);
  }
  return { dataFile: input, sourceDirectory: dirname(input) };
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateDataSchema(value, label) {
  if (!Number.isInteger(value.version) || value.version < 2 || value.version > 8) {
    throw new Error(`${label} must use a supported data version from 2 through 8.`);
  }
  if (!isObject(value.subscriptions)) {
    throw new Error(`${label} must contain a subscriptions object.`);
  }
  for (const kind of ["journal", "scholar", "keyword"]) {
    if (!Array.isArray(value.subscriptions[kind])) {
      throw new Error(`${label} subscriptions.${kind} must be an array.`);
    }
  }
  if (!isObject(value.states)) {
    throw new Error(`${label} must contain a states object.`);
  }
}

function validateSettingsSchema(value, label) {
  if (value.version !== 2 && value.version !== 3) {
    throw new Error(`${label} must use settings version 2 or 3.`);
  }
  const unknown = Object.keys(value).filter((key) => !SETTINGS_FIELDS.has(key));
  if (unknown.length) {
    throw new Error(`${label} contains fields that Anthropology Canteen does not import.`);
  }
  for (const key of ["openAlexApiKey", "semanticScholarApiKey"]) {
    if (key in value && typeof value[key] !== "string") {
      throw new Error(`${label} ${key} must be a string.`);
    }
  }
}

function validateReminderStateSchema(value, label) {
  if (![1, 2].includes(value.version) || !isObject(value.items) || !isObject(value.baselines)) {
    throw new Error(`${label} must use reminder state version 1 or 2.`);
  }
}

function validateReminderSecretSchema(value, label) {
  if (value.version !== 1 || typeof value.ciphertext !== "string" || !value.ciphertext.trim()) {
    throw new Error(`${label} is not a valid encrypted reminder secret.`);
  }
}

async function validatedJson(path, label, kind) {
  const bytes = await readFile(path);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (!isObject(value)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  if (kind === "data") validateDataSchema(value, label);
  else if (kind === "settings") validateSettingsSchema(value, label);
  else if (kind === "reminder-state") validateReminderStateSchema(value, label);
  else if (kind === "reminder-secret") validateReminderSecretSchema(value, label);
  return bytes;
}

async function assertNoLiveServer(targetDirectory) {
  const pidFile = join(targetDirectory, PID_NAME);
  let text;
  try {
    text = await readFile(pidFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const storedPid = text.trim();
  if (!/^\d+$/.test(storedPid)) return;
  const pid = Number.parseInt(storedPid, 10);
  if (!Number.isSafeInteger(pid) || pid <= 0) return;

  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch (error) {
    if (error?.code === "EPERM") alive = true;
    else if (error?.code !== "ESRCH") throw error;
  }
  if (alive) {
    throw new Error(
      "Anthropology Canteen appears to be running. Close every app page, wait about 10 seconds, and retry the import.",
    );
  }
}

async function installValidatedFiles({ targetDirectory, files, transactionOptions }) {
  // The same existing utility is present at the product root in source and
  // portable archives. Launchers and archive layout do not change.
  const utilityUrl = new URL(basename(dirname(fileURLToPath(import.meta.url))) === "shared"
    ? "../../reminder-utils.mjs" : "../reminder-utils.mjs", import.meta.url);
  const { installFileTransaction } = await import(utilityUrl.href);
  return installFileTransaction(files.map((file) => ({
    destination: join(targetDirectory, file.name), bytes: file.bytes,
  })), transactionOptions);
}

export async function importPortableData({ source, targetRoot, transactionOptions }) {
  const { dataFile, sourceDirectory } = await resolveSource(resolve(source));
  const targetDirectory = join(resolve(targetRoot), "data");
  const destinationData = join(targetDirectory, DATA_NAME);
  if (resolve(dataFile) === resolve(destinationData)) {
    throw new Error("The source and destination data files are the same.");
  }

  const dataBytes = await validatedJson(dataFile, DATA_NAME, "data");
  const settingsFile = join(sourceDirectory, SETTINGS_NAME);
  const files = [{ name: DATA_NAME, source: dataFile, bytes: dataBytes }];
  if (await exists(settingsFile)) {
    const bytes = await validatedJson(settingsFile, SETTINGS_NAME, "settings");
    files.push({ name: SETTINGS_NAME, source: settingsFile, bytes });
  }
  const reminderStateFile = join(sourceDirectory, REMINDER_STATE_NAME);
  if (await exists(reminderStateFile)) {
    const bytes = await validatedJson(reminderStateFile, REMINDER_STATE_NAME, "reminder-state");
    files.push({ name: REMINDER_STATE_NAME, source: reminderStateFile, bytes });
  }
  const reminderSecretFile = join(sourceDirectory, REMINDER_SECRET_NAME);
  if (await exists(reminderSecretFile)) {
    const bytes = await validatedJson(reminderSecretFile, REMINDER_SECRET_NAME, "reminder-secret");
    files.push({ name: REMINDER_SECRET_NAME, source: reminderSecretFile, bytes });
  }

  await assertNoLiveServer(targetDirectory);
  const backups = await installValidatedFiles({ targetDirectory, files, transactionOptions });
  return {
    destinationData,
    importedSettings: files.some((file) => file.name === SETTINGS_NAME),
    importedReminderState: files.some((file) => file.name === REMINDER_STATE_NAME),
    importedReminderSecret: files.some((file) => file.name === REMINDER_SECRET_NAME),
    backups,
  };
}

async function main() {
  try {
    const result = await importPortableData(parseArguments(process.argv.slice(2)));
    console.log(`Data imported to: ${result.destinationData}`);
    console.log(
      result.importedSettings
        ? "Neighboring API and reminder settings were imported."
        : "No neighboring settings file was present; existing settings were left unchanged.",
    );
    if (result.importedReminderState) {
      console.log("The email-reminder delivery history was imported.");
    }
    if (result.importedReminderSecret) {
      console.log("The encrypted Windows email authorization code was imported.");
    }
    for (const backup of result.backups) console.log(`Backup created: ${backup}`);
  } catch (error) {
    console.error(error.recovery === "incomplete"
      ? "Import failed and recovery is incomplete. Keep both folders and all backups; do not retry or delete the recovery record."
      : error.recovery === "restored"
        ? `Import failed; current data was restored.${error.cleanupFailed ? " Temporary cleanup is incomplete; keep the recovery record." : ""}`
        : error.code === "MIGRATION_CLEANUP_REQUIRED" ? error.message : `Import failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
