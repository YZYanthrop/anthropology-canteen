import {
  access,
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_NAME = "anthropology-canteen-data.json";
const SETTINGS_NAME = "anthropology-canteen-settings.json";
const PID_NAME = "anthropology-canteen-server.pid";
const SETTINGS_FIELDS = new Set([
  "version",
  "openAlexApiKey",
  "semanticScholarApiKey",
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
  } catch {
    return false;
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
  if (!Number.isInteger(value.version) || value.version < 2 || value.version > 7) {
    throw new Error(`${label} must use a supported data version from 2 through 7.`);
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
  if (value.version !== 2) {
    throw new Error(`${label} must use settings version 2.`);
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
  else validateSettingsSchema(value, label);
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

function backupName(filename, stamp) {
  return filename.replace(/\.json$/i, `.backup-${stamp}.json`);
}

async function nextBackupPath(directory, filename, stamp) {
  let candidate = join(directory, backupName(filename, stamp));
  let counter = 2;
  while (await exists(candidate)) {
    candidate = join(
      directory,
      backupName(filename, `${stamp}-${counter}`),
    );
    counter += 1;
  }
  return candidate;
}

async function installValidatedFiles({ targetDirectory, files }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  const prepared = [];
  const installed = [];
  await mkdir(targetDirectory, { recursive: true });

  try {
    for (const file of files) {
      const destination = join(targetDirectory, file.name);
      const temporary = join(
        targetDirectory,
        `.${file.name}.import-${process.pid}-${prepared.length}`,
      );
      await copyFile(file.source, temporary);
      const backup = (await exists(destination))
        ? await nextBackupPath(targetDirectory, file.name, stamp)
        : null;
      prepared.push({ ...file, destination, temporary, backup });
    }

    for (const file of prepared) {
      if (file.backup) await rename(file.destination, file.backup);
      try {
        await rename(file.temporary, file.destination);
        installed.push(file);
      } catch (error) {
        if (file.backup && !(await exists(file.destination))) {
          await rename(file.backup, file.destination);
        }
        throw error;
      }
    }
  } catch (error) {
    for (const file of installed.reverse()) {
      await rm(file.destination, { force: true });
      if (file.backup && (await exists(file.backup))) {
        await copyFile(file.backup, file.destination);
      }
    }
    for (const file of prepared) await rm(file.temporary, { force: true });
    throw error;
  }

  return prepared.filter((file) => file.backup).map((file) => file.backup);
}

export async function importPortableData({ source, targetRoot }) {
  const { dataFile, sourceDirectory } = await resolveSource(resolve(source));
  const targetDirectory = join(resolve(targetRoot), "data");
  const destinationData = join(targetDirectory, DATA_NAME);
  if (resolve(dataFile) === resolve(destinationData)) {
    throw new Error("The source and destination data files are the same.");
  }

  await validatedJson(dataFile, DATA_NAME, "data");
  const settingsFile = join(sourceDirectory, SETTINGS_NAME);
  const files = [{ name: DATA_NAME, source: dataFile }];
  if (await exists(settingsFile)) {
    await validatedJson(settingsFile, SETTINGS_NAME, "settings");
    files.push({ name: SETTINGS_NAME, source: settingsFile });
  }

  await assertNoLiveServer(targetDirectory);
  const backups = await installValidatedFiles({ targetDirectory, files });
  return { destinationData, importedSettings: files.length === 2, backups };
}

async function main() {
  try {
    const result = await importPortableData(parseArguments(process.argv.slice(2)));
    console.log(`Data imported to: ${result.destinationData}`);
    console.log(
      result.importedSettings
        ? "Neighboring API settings were imported."
        : "No neighboring settings file was present; existing settings were left unchanged.",
    );
    for (const backup of result.backups) console.log(`Backup created: ${backup}`);
  } catch (error) {
    console.error(`Import failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
