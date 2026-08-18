import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./dist/server/index.js";
import {
  cleanReminderConfig,
  deleteReminderSecret,
  readReminderSecret,
  readReminderState,
  saveReminderSecret,
  withReminderLock,
  writeJsonAtomic,
} from "./reminder-utils.mjs";
import {
  getSchedulerStatus,
  installScheduler,
  uninstallScheduler,
} from "./reminder-scheduler.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(root, "dist", "client");
const dataRoot = resolve(root, "data");
const dataFile = resolve(dataRoot, "anthropology-canteen-data.json");
const settingsFile = resolve(dataRoot, "anthropology-canteen-settings.json");
const pidFile = resolve(dataRoot, "anthropology-canteen-server.pid");
const runtimeSessionToken = randomUUID();
let activeReminderJobs = 0;
const reminderRequestTimes = new Map();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function serveAsset(input) {
  const request = input instanceof Request ? input : new Request(input);
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const relative = pathname.replace(/^\/+/, "");
  const filePath = resolve(clientRoot, relative);
  if (
    filePath !== clientRoot &&
    !filePath.startsWith(`${clientRoot}${sep}`)
  ) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    const body = await readFile(filePath);
    return new Response(request.method === "HEAD" ? null : body, {
      headers: {
        "content-length": String(body.length),
        "content-type":
          contentTypes[extname(filePath).toLowerCase()] ||
          "application/octet-stream",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function readRequestBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

function clean(value, max = 2000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanTimestamp(value, fallback = new Date().toISOString()) {
  const timestamp = clean(value, 80);
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : fallback;
}

function emptyLocalData() {
  return {
    version: 7,
    savedAt: new Date().toISOString(),
    subscriptions: { journal: [], scholar: [], keyword: [] },
    states: {},
    feed: null,
    translations: {},
    scholarProfiles: {},
  };
}

function cleanOrcid(value) {
  const id = clean(value, 160)
    .replace(/^https?:\/\/orcid\.org\//i, "")
    .toUpperCase();
  return /^\d{4}-\d{4}-\d{4}-[\dX]{4}$/.test(id) ? id : "";
}

function cleanPersonName(value) {
  const source = clean(value, 180).replace(/\s+/g, " ");
  if (!source || /\p{Script=Han}/u.test(source)) return source;
  const letters = source.replace(/[^A-Za-z]/g, "");
  if (
    letters &&
    letters !== letters.toLowerCase() &&
    letters !== letters.toUpperCase()
  ) {
    return source;
  }
  return source
    .toLowerCase()
    .replace(/(^|[\s\-‐‑‒–—'’])([a-z])/g, (_match, separator, letter) =>
      `${separator}${letter.toUpperCase()}`,
    )
    .replace(/\b([A-Z])\b(?!\.)/g, "$1.");
}

function cleanOpenAlexId(value) {
  const id = clean(value, 100).split("/").filter(Boolean).at(-1) || "";
  return /^A\d+$/.test(id) ? id : "";
}

function scholarSubscriptionId(item, label, openAlexIds, semanticScholarIds, orcid) {
  const stored = clean(item?.subscriptionId, 220);
  return (
    stored ||
    (orcid && `orcid:${orcid}`) ||
    (openAlexIds[0] && `openalex:${openAlexIds[0]}`) ||
    (semanticScholarIds[0] && `semantic:${semanticScholarIds[0]}`) ||
    `legacy:${label.toLowerCase()}:${clean(item?.institution, 240).toLowerCase()}`
  );
}

function cleanArticleState(value) {
  return {
    saved: Boolean(value?.saved),
    read: Boolean(value?.read),
    ignored: Boolean(value?.ignored),
  };
}

function parseJson(text) {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

function textFromBody(body) {
  return body?.toString("utf8").replace(/^\uFEFF/, "") || "{}";
}

function canonicalKeywordRoot(input) {
  const value = clean(input, 80).toLowerCase().replace(/\s+/g, " ");
  if (!/^[a-z]+$/.test(value)) return value;
  if (value.endsWith("ically") && value.length > 7) return value.slice(0, -4);
  if (value.endsWith("ical") && value.length > 6) return value.slice(0, -2);
  if (value.endsWith("ies") && value.length > 4) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.endsWith("ics") && value.length > 5) return value.slice(0, -1);
  if (value.endsWith("s") && value.length > 4 && !value.endsWith("ss")) {
    return value.slice(0, -1);
  }
  return value;
}

function generatedKeywordVariants(root) {
  if (!/^[a-z]+$/.test(root)) return [root];
  if (root.endsWith("ic")) {
    return [root, `${root}s`, `${root}al`, `${root}ally`];
  }
  if (root.endsWith("y") && root.length > 3) {
    const stem = root.slice(0, -1);
    return [root, `${stem}ies`, `${stem}ical`, `${stem}ically`];
  }
  if (root.endsWith("e") && root.length > 3) {
    const stem = root.slice(0, -1);
    return [root, `${root}s`, `${root}d`, `${stem}ing`, `${root}ful`];
  }
  return [root, `${root}s`, `${root}ed`, `${root}ing`, `${root}al`];
}

function cleanKeywordGroup(value, followedAt = new Date().toISOString()) {
  const candidate =
    typeof value === "string"
      ? { root: value, variants: [value] }
      : value && typeof value === "object"
        ? value
        : null;
  if (!candidate) return null;
  const root = canonicalKeywordRoot(candidate.root);
  if (!root) return null;
  const variants = Array.isArray(candidate.variants)
    ? candidate.variants.map((item) => clean(item, 80).toLowerCase()).filter(Boolean)
    : [];
  return {
    root,
    variants: [
      ...new Set([root, ...variants, ...generatedKeywordVariants(root)]),
    ].slice(0, 10),
    followedAt: cleanTimestamp(candidate.followedAt, followedAt),
  };
}

function cleanSubscriptions(
  value = {},
  migrationBaseline = new Date().toISOString(),
  quarantineLegacyIdentity = false,
) {
  const journal = Array.isArray(value.journal)
    ? value.journal
        .slice(0, 40)
        .map((item) => ({
          label: clean(item?.label, 180),
          issn: clean(item?.issn, 40),
          followedAt: cleanTimestamp(item?.followedAt, migrationBaseline),
        }))
        .filter((item) => item.label && item.issn)
    : [];
  const scholar = Array.isArray(value.scholar)
    ? value.scholar
        .slice(0, 60)
        .map((item) => {
          const candidate =
            typeof item === "string" ? { label: item } : item;
          const label = cleanPersonName(candidate?.label);
          if (!label) return null;
          const storedOpenAlexIds = Array.isArray(candidate?.openAlexIds)
            ? candidate.openAlexIds
                .map(cleanOpenAlexId)
                .filter(Boolean)
            : [];
          const storedSemanticScholarIds = Array.isArray(
            candidate?.semanticScholarIds,
          )
            ? candidate.semanticScholarIds
                .map((id) => clean(id, 160))
                .filter(Boolean)
            : [];
          const orcid = cleanOrcid(candidate?.orcid) || undefined;
          const identityNeedsReview =
            quarantineLegacyIdentity &&
            (storedOpenAlexIds.length > 1 ||
              storedSemanticScholarIds.length > 1);
          const openAlexIds = identityNeedsReview
            ? []
            : storedOpenAlexIds;
          const semanticScholarIds = identityNeedsReview
            ? []
            : storedSemanticScholarIds;
          const institutions = Array.isArray(candidate?.institutions)
            ? candidate.institutions
                .slice(0, 12)
                .map((value) => clean(value, 240))
                .filter(Boolean)
            : [];
          const institution =
            clean(candidate?.institution, 240) ||
            institutions[0] ||
            "单位待确认";
          return {
            subscriptionId: scholarSubscriptionId(
              candidate,
              label,
              openAlexIds,
              semanticScholarIds,
              orcid,
            ),
            label,
            aliases: Array.isArray(candidate?.aliases)
              ? candidate.aliases
                  .slice(0, 16)
                  .map((value) => clean(value, 180))
                  .filter(Boolean)
              : [],
            openAlexIds,
            semanticScholarIds,
            quarantinedOpenAlexIds: identityNeedsReview
              ? storedOpenAlexIds
              : Array.isArray(candidate?.quarantinedOpenAlexIds)
                ? candidate.quarantinedOpenAlexIds
                    .map(cleanOpenAlexId)
                    .filter(Boolean)
                : [],
            quarantinedSemanticScholarIds: identityNeedsReview
              ? storedSemanticScholarIds
              : Array.isArray(candidate?.quarantinedSemanticScholarIds)
                ? candidate.quarantinedSemanticScholarIds
                    .map((id) => clean(id, 160))
                    .filter(Boolean)
                : [],
            identityNeedsReview:
              identityNeedsReview || Boolean(candidate?.identityNeedsReview),
            institution,
            institutions: [
              ...new Set([institution, ...institutions].filter(Boolean)),
            ],
            profileUrl: clean(candidate?.profileUrl, 500) || undefined,
            profileUrls: Array.isArray(candidate?.profileUrls)
              ? candidate.profileUrls
                  .slice(0, 12)
                  .map((value) => clean(value, 800))
                  .filter(Boolean)
              : undefined,
            institutionalProfileUrl:
              clean(candidate?.institutionalProfileUrl, 1000) || undefined,
            institutionalProfileVerifiedAt:
              clean(candidate?.institutionalProfileVerifiedAt, 80) &&
              Number.isFinite(
                Date.parse(
                  clean(candidate?.institutionalProfileVerifiedAt, 80),
                ),
              )
                ? clean(candidate?.institutionalProfileVerifiedAt, 80)
                : undefined,
            institutionalEvidence: Array.isArray(
              candidate?.institutionalEvidence,
            )
              ? candidate.institutionalEvidence
                  .slice(0, 12)
                  .map((item) => clean(item, 200))
                  .filter(Boolean)
              : [],
            orcid,
            worksCount:
              typeof candidate?.worksCount === "number"
                ? candidate.worksCount
                : undefined,
            researchAreas: Array.isArray(candidate?.researchAreas)
              ? candidate.researchAreas
                  .slice(0, 8)
                  .map((area) => clean(area, 160))
                  .filter(Boolean)
              : undefined,
            verifiedWorkDois: Array.isArray(candidate?.verifiedWorkDois)
              ? candidate.verifiedWorkDois
                  .slice(0, 120)
                  .map((doi) =>
                    clean(doi, 300)
                      .replace(/^https?:\/\/doi\.org\//i, "")
                      .toLowerCase(),
                  )
                  .filter(Boolean)
              : undefined,
            sources: Array.isArray(candidate?.sources)
              ? candidate.sources
                  .slice(0, 8)
                  .map((source) => clean(source, 80))
                  .filter(Boolean)
              : undefined,
            trackingStatus:
              openAlexIds.length || semanticScholarIds.length || orcid
                ? "verified"
                : "limited",
            followedAt: cleanTimestamp(
              candidate?.followedAt,
              migrationBaseline,
            ),
            identityCheckedAt: identityNeedsReview
              ? undefined
              :
              clean(candidate?.identityCheckedAt, 80) &&
              Number.isFinite(
                Date.parse(clean(candidate?.identityCheckedAt, 80)),
              )
                ? clean(candidate?.identityCheckedAt, 80)
                : undefined,
            mergedRecordCount:
              typeof candidate?.mergedRecordCount === "number"
                ? Math.max(1, Math.floor(candidate.mergedRecordCount))
                : 1,
            mergeConfidence: identityNeedsReview
              ? "unconfirmed"
              :
              ["verified", "high", "unconfirmed"].includes(
                candidate?.mergeConfidence,
              )
                ? candidate.mergeConfidence
                : orcid
                  ? "verified"
                  : openAlexIds.length || semanticScholarIds.length
                    ? "high"
                    : "unconfirmed",
            mergeEvidence: identityNeedsReview
              ? [
                  "旧版自动合并记录已隔离，需通过 ORCID、代表作或机构主页重新核验",
                ]
              : Array.isArray(candidate?.mergeEvidence)
              ? candidate.mergeEvidence
                  .slice(0, 20)
                  .map((item) => clean(item, 160))
                  .filter(Boolean)
              : [],
          };
        })
        .filter(Boolean)
    : [];
  const keyword = Array.isArray(value.keyword)
    ? value.keyword
        .slice(0, 60)
        .map((item) => cleanKeywordGroup(item, migrationBaseline))
        .filter(Boolean)
        .filter(
          (item, index, all) =>
            all.findIndex((candidate) => candidate.root === item.root) === index,
        )
    : [];
  return { journal, scholar, keyword };
}

function cleanMatches(value) {
  return Array.isArray(value)
    ? value
        .slice(0, 20)
        .map((item) => {
          const kind = item?.kind;
          const label = clean(item?.label, 180);
          if (!["journal", "scholar", "keyword"].includes(kind) || !label) {
            return null;
          }
          const terms = Array.isArray(item?.terms)
            ? item.terms
                .slice(0, 12)
                .map((term) => clean(term, 80))
                .filter(Boolean)
            : undefined;
          return { kind, label, terms };
        })
        .filter(Boolean)
    : [];
}

function cleanArticle(value) {
  const id = clean(value?.id, 500);
  const title = clean(value?.title, 1000);
  const matches = cleanMatches(value?.matches);
  if (!id || !title || matches.length === 0) return null;
  return {
    id,
    doi: clean(value?.doi, 300) || undefined,
    title,
    authors: Array.isArray(value?.authors)
      ? value.authors
          .slice(0, 40)
          .map((item) => {
            const candidate =
              typeof item === "string" ? { name: item } : item;
            const name = clean(candidate?.name, 220);
            if (!name) return null;
            return {
              name,
              openAlexId: cleanOpenAlexId(candidate?.openAlexId) || undefined,
              semanticScholarId:
                clean(candidate?.semanticScholarId, 160) || undefined,
              orcid: cleanOrcid(candidate?.orcid) || undefined,
            };
          })
          .filter(Boolean)
      : [],
    venue: clean(value?.venue, 400),
    publisher: clean(value?.publisher, 400) || undefined,
    publishedAt: clean(value?.publishedAt, 40) || "1900-01-01",
    type: clean(value?.type, 120) || "学术成果",
    url: clean(value?.url, 1000) || "https://openalex.org",
    abstract: clean(value?.abstract, 12000) || undefined,
    keywords: Array.isArray(value?.keywords)
      ? value.keywords
          .slice(0, 24)
          .map((item) => clean(item, 220))
          .filter(Boolean)
      : undefined,
    matches,
  };
}

function cleanFeed(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.items)) {
    return null;
  }
  return {
    items: value.items.slice(0, 250).map(cleanArticle).filter(Boolean),
    updatedAt: clean(value.updatedAt, 80) || new Date().toISOString(),
    source: value.source === "fallback" ? "fallback" : "live",
    historyScholar: clean(value.historyScholar, 180) || undefined,
    scholars: Array.isArray(value.scholars)
      ? cleanSubscriptions({ scholar: value.scholars }).scholar
      : [],
    warnings: Array.isArray(value.warnings)
      ? value.warnings.slice(0, 20).map((item) => clean(item, 500)).filter(Boolean)
      : [],
  };
}

function emptyLocalSettings() {
  return {
    version: 3,
    openAlexApiKey: "",
    semanticScholarApiKey: "",
    reminders: cleanReminderConfig({}),
  };
}

function cleanApiKey(value) {
  const key = clean(value, 240);
  return key.length >= 8 && !/\s/.test(key) ? key : "";
}

function cleanLocalSettings(value = {}) {
  return {
    version: 3,
    openAlexApiKey: cleanApiKey(value.openAlexApiKey),
    semanticScholarApiKey: cleanApiKey(value.semanticScholarApiKey),
    reminders: cleanReminderConfig(value.reminders || {}),
  };
}

function publicLocalSettings(settings) {
  const openAlexKey = cleanApiKey(settings?.openAlexApiKey);
  const semanticScholarKey = cleanApiKey(
    settings?.semanticScholarApiKey,
  );
  return {
    version: 3,
    openAlexConfigured: Boolean(openAlexKey),
    openAlexKeyHint: openAlexKey ? `••••${openAlexKey.slice(-4)}` : "",
    semanticScholarConfigured: Boolean(semanticScholarKey),
    semanticScholarKeyHint: semanticScholarKey
      ? `••••${semanticScholarKey.slice(-4)}`
      : "",
    remindersConfigured: Boolean(
      settings?.reminders?.sender && settings?.reminders?.recipient,
    ),
    remindersEnabled: Boolean(settings?.reminders?.enabled),
  };
}

function cleanScholarWork(value) {
  const title = clean(value?.title, 1000);
  const id = clean(value?.id, 1000) || title.toLowerCase();
  if (!title || !id) return null;
  const year =
    typeof value?.year === "number" &&
    Number.isFinite(value.year) &&
    value.year > 1000 &&
    value.year < 3000
      ? Math.floor(value.year)
      : undefined;
  return {
    id,
    doi:
      clean(value?.doi, 320)
        .replace(/^https?:\/\/doi\.org\//i, "")
        .toLowerCase() || undefined,
    title,
    year,
    venue: clean(value?.venue, 500) || undefined,
    url: clean(value?.url, 1000) || undefined,
    abstract: clean(value?.abstract, 12_000) || undefined,
    familyIds: Array.isArray(value?.familyIds)
      ? value.familyIds
          .slice(0, 20)
          .map((item) => clean(item, 320))
          .filter(Boolean)
      : undefined,
  };
}

function cleanScholarProfileCandidate(value) {
  if (!value || typeof value !== "object") return null;
  const subscription = cleanSubscriptions({
    journal: [],
    scholar: [value],
    keyword: [],
  }).scholar[0];
  if (!subscription) return null;
  const representativeWorks = Array.isArray(value.representativeWorks)
    ? value.representativeWorks
        .slice(0, 100)
        .map(cleanScholarWork)
        .filter(Boolean)
    : [];
  return {
    ...subscription,
    candidateId:
      clean(value.candidateId, 300) || subscription.subscriptionId,
    value:
      clean(value.value, 500) ||
      subscription.openAlexIds[0] ||
      subscription.semanticScholarIds?.[0] ||
      subscription.orcid ||
      subscription.subscriptionId,
    representativeWorks,
    externalIds: {
      openAlex:
        cleanOpenAlexId(value.externalIds?.openAlex) ||
        subscription.openAlexIds[0] ||
        undefined,
      semanticScholar:
        clean(value.externalIds?.semanticScholar, 160) ||
        subscription.semanticScholarIds?.[0] ||
        undefined,
      orcid:
        cleanOrcid(value.externalIds?.orcid) ||
        subscription.orcid ||
        undefined,
    },
    identityWarnings: Array.isArray(value.identityWarnings)
      ? value.identityWarnings
          .slice(0, 12)
          .map((item) => clean(item, 500))
          .filter(Boolean)
      : [],
    scoreReasons: Array.isArray(value.scoreReasons)
      ? value.scoreReasons
          .slice(0, 12)
          .map((item) => clean(item, 200))
          .filter(Boolean)
      : [],
    score:
      typeof value.score === "number" && Number.isFinite(value.score)
        ? value.score
        : 0,
  };
}

function cleanScholarProfiles(value) {
  const profiles = {};
  if (!value || typeof value !== "object") return profiles;
  for (const [storedKey, profile] of Object.entries(value).slice(0, 60)) {
    const key = clean(storedKey, 300);
    if (!key || !profile || typeof profile !== "object") continue;
    const candidate = cleanScholarProfileCandidate(profile.candidate);
    if (!candidate) continue;
    const works = Array.isArray(profile.works)
      ? profile.works.slice(0, 1000).map(cleanScholarWork).filter(Boolean)
      : candidate.representativeWorks;
    profiles[key] = {
      candidate,
      works,
      updatedAt: cleanTimestamp(profile.updatedAt),
      complete: Boolean(profile.complete),
    };
  }
  return profiles;
}

function cleanSavedAt(value) {
  const savedAt = clean(value, 80);
  return Number.isFinite(Date.parse(savedAt)) ? savedAt : new Date().toISOString();
}

function cleanLocalData(value = {}, refreshSavedAt = false) {
  const now = new Date().toISOString();
  const savedAt = refreshSavedAt ? now : cleanSavedAt(value.savedAt);
  const migrationBaseline = Number(value.version) >= 4 ? savedAt : now;
  const quarantineLegacyIdentity = [5, 6].includes(Number(value.version));
  const states = {};
  if (value.states && typeof value.states === "object") {
    for (const [id, state] of Object.entries(value.states).slice(0, 2000)) {
      const key = clean(id, 500);
      if (key) states[key] = cleanArticleState(state);
    }
  }

  const translations = {};
  if (value.translations && typeof value.translations === "object") {
    for (const [id, translation] of Object.entries(value.translations).slice(0, 1000)) {
      const key = clean(id, 500);
      const text = clean(translation, 12000);
      if (key && text) translations[key] = text;
    }
  }

  return {
    version: 7,
    savedAt,
    subscriptions: cleanSubscriptions(
      value.subscriptions,
      migrationBaseline,
      quarantineLegacyIdentity,
    ),
    states,
    feed: quarantineLegacyIdentity ? null : cleanFeed(value.feed),
    translations,
    scholarProfiles: quarantineLegacyIdentity
      ? {}
      : cleanScholarProfiles(value.scholarProfiles),
  };
}

function hasLocalDataContent(data) {
  return Boolean(
    data.subscriptions.journal.length ||
      data.subscriptions.scholar.length ||
      data.subscriptions.keyword.length ||
      Object.keys(data.states).length ||
      Object.keys(data.translations).length ||
      Object.keys(data.scholarProfiles).length ||
      data.feed?.items.length,
  );
}

async function ensureDataRoot() {
  await mkdir(dataRoot, { recursive: true });
}

async function findSiblingLocalData() {
  const parentRoot = dirname(root);
  let entries = [];
  try {
    entries = await readdir(parentRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const siblingRoot = resolve(parentRoot, entry.name);
    if (siblingRoot === root || !siblingRoot.startsWith(`${parentRoot}${sep}`)) {
      continue;
    }
    const candidate = resolve(
      siblingRoot,
      "data",
      "anthropology-canteen-data.json",
    );
    try {
      const info = await stat(candidate);
      if (!info.isFile()) continue;
      const data = cleanLocalData(parseJson(await readFile(candidate, "utf8")));
      if (hasLocalDataContent(data)) {
        const savedAtMs = Date.parse(data.savedAt || "");
        candidates.push({
          data,
          mtimeMs: Number.isFinite(savedAtMs) ? savedAtMs : info.mtimeMs,
        });
      }
    } catch {
      // Ignore unrelated folders and unreadable old copies.
    }
  }

  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.data || null;
}

async function readLocalDataFile() {
  await ensureDataRoot();
  try {
    const text = await readFile(dataFile, "utf8");
    const data = cleanLocalData(parseJson(text));
    // A first launch may have created an empty file before the user places the
    // new portable folder beside the old version. Keep retrying neighboring
    // migration while the current file is still genuinely empty.
    if (!hasLocalDataContent(data)) {
      const siblingData = await findSiblingLocalData();
      if (siblingData) {
        await writeJsonAtomic(dataFile, siblingData);
        return siblingData;
      }
    }
    return data;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const data = (await findSiblingLocalData()) || emptyLocalData();
    await writeJsonAtomic(dataFile, data);
    return data;
  }
}

async function writeLocalDataFile(value) {
  await ensureDataRoot();
  const data = cleanLocalData(value, true);
  await writeJsonAtomic(dataFile, data);
  return data;
}

async function findSiblingLocalSettings() {
  const parentRoot = dirname(root);
  let entries = [];
  try {
    entries = await readdir(parentRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const siblingRoot = resolve(parentRoot, entry.name);
    if (siblingRoot === root || !siblingRoot.startsWith(`${parentRoot}${sep}`)) {
      continue;
    }
    const candidate = resolve(
      siblingRoot,
      "data",
      "anthropology-canteen-settings.json",
    );
    try {
      const info = await stat(candidate);
      if (!info.isFile()) continue;
      const raw = parseJson(await readFile(candidate, "utf8"));
      const settings = cleanLocalSettings(raw);
      const rawReminders = raw?.reminders;
      if (
        settings.openAlexApiKey ||
        settings.semanticScholarApiKey ||
        rawReminders?.sender ||
        rawReminders?.enabled ||
        rawReminders?.installationId
      ) {
        candidates.push({ settings, mtimeMs: info.mtimeMs });
      }
    } catch {
      // Ignore unreadable or unrelated sibling settings.
    }
  }
  return (
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.settings || null
  );
}

async function readLocalSettingsFile() {
  await ensureDataRoot();
  try {
    return cleanLocalSettings(
      parseJson(await readFile(settingsFile, "utf8")),
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const settings =
      (await findSiblingLocalSettings()) || emptyLocalSettings();
    if (
      settings.openAlexApiKey ||
      settings.semanticScholarApiKey ||
      settings.reminders?.sender ||
      settings.reminders?.enabled ||
      settings.reminders?.installationId
    ) {
      await writeJsonAtomic(settingsFile, settings);
    }
    return settings;
  }
}

async function writeLocalSettingsFile(value) {
  await ensureDataRoot();
  const settings = cleanLocalSettings(value);
  await writeJsonAtomic(settingsFile, settings);
  applyRuntimeSettings(settings);
  return settings;
}

function applyRuntimeSettings(settings) {
  const openAlexKey = cleanApiKey(settings?.openAlexApiKey);
  const semanticScholarKey = cleanApiKey(
    settings?.semanticScholarApiKey,
  );
  if (openAlexKey) process.env.OPENALEX_API_KEY = openAlexKey;
  else delete process.env.OPENALEX_API_KEY;
  if (semanticScholarKey) {
    process.env.SEMANTIC_SCHOLAR_API_KEY = semanticScholarKey;
  } else {
    delete process.env.SEMANTIC_SCHOLAR_API_KEY;
  }
}

async function refreshRuntimeSettings() {
  const settings = await readLocalSettingsFile();
  applyRuntimeSettings(settings);
  return settings;
}

function reminderConfigHash(config) {
  const value = {
    provider: config.provider,
    sender: config.sender,
    recipient: config.recipient,
    host: config.host,
    port: config.port,
    security: config.security,
    username: config.username,
    format: config.format,
    schedule: config.schedule,
  };
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function reminderPublicConfig(config) {
  return {
    enabled: Boolean(config.enabled),
    installationId: config.installationId,
    provider: config.provider,
    sender: config.sender,
    recipient: config.recipient,
    host: config.host,
    port: config.port,
    security: config.security,
    username: config.username,
    format: config.format,
    schedule: config.schedule,
    schedulerPath: config.schedulerPath,
  };
}

function reminderRequestAuthorized(headers) {
  const token = headers?.["x-anthropology-canteen-session"];
  const origin = headers?.origin;
  const host = headers?.host || "";
  if (token !== runtimeSessionToken) return false;
  if (!origin) return true;
  return origin === `http://${host}` || origin === `http://localhost:${host.split(":").pop()}`;
}

function reminderRequestAllowed(headers, pathname) {
  const token = headers?.["x-anthropology-canteen-session"] || "unknown";
  const key = `${token}:${pathname}`;
  const now = Date.now();
  const recent = (reminderRequestTimes.get(key) || []).filter(
    (timestamp) => now - timestamp < 60_000,
  );
  if (recent.length >= 12) {
    reminderRequestTimes.set(key, recent);
    return false;
  }
  recent.push(now);
  reminderRequestTimes.set(key, recent);
  return true;
}

async function readReminderStatus() {
  const settings = await readLocalSettingsFile();
  const config = cleanReminderConfig(settings.reminders);
  const state = await readReminderState(root);
  const scheduler = await getSchedulerStatus(root, config);
  const secret = await readReminderSecret(root, config);
  return {
    version: 1,
    platform: process.platform,
    config: reminderPublicConfig(config),
    credentialConfigured: Boolean(secret),
    tested: Boolean(config.testedConfigHash && config.testedConfigHash === reminderConfigHash(config)),
    scheduler,
    state: {
      baselineComplete: state.baselineComplete,
      lastAttemptAt: state.lastAttemptAt,
      lastCheckAt: state.lastCheckAt,
      lastSuccessfulCheckAt: state.lastSuccessfulCheckAt,
      lastSuccessfulSendAt: state.lastSuccessfulSendAt,
      nextDueAt: state.nextDueAt,
      lastError: state.lastError,
      lastResult: state.lastResult,
    },
    sessionToken: runtimeSessionToken,
  };
}

async function runReminderJob(options = {}) {
  activeReminderJobs += 1;
  try {
    const reminderModule = await import("./reminder-worker.mjs");
    return await reminderModule.runReminderOnce(options);
  } finally {
    activeReminderJobs = Math.max(0, activeReminderJobs - 1);
  }
}

async function handleReminders(url, method, body, headers) {
  if (url.pathname !== "/api/reminders/status" && !url.pathname.startsWith("/api/reminders/")) {
    return undefined;
  }
  if (method === "GET" && url.pathname === "/api/reminders/status") {
    try {
      return jsonResponse(await readReminderStatus());
    } catch {
      return jsonResponse({ message: "无法读取邮件提醒状态。" }, { status: 500 });
    }
  }
  if (!reminderRequestAuthorized(headers)) {
    return jsonResponse({ message: "邮件提醒请求未通过本地会话验证。" }, { status: 403 });
  }
  if (!reminderRequestAllowed(headers, url.pathname)) {
    return jsonResponse(
      { message: "邮件提醒操作过于频繁，请稍后再试。" },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }
  try {
    const settings = await readLocalSettingsFile();
    const current = cleanReminderConfig(settings.reminders);
    if (url.pathname === "/api/reminders/config" && method === "PUT") {
      const input = parseJson(textFromBody(body), {});
      if (Object.prototype.hasOwnProperty.call(input || {}, "port") && ![465, 587].includes(Number(input.port))) {
        return jsonResponse({ message: "SMTP 只允许 465（TLS）或 587（STARTTLS），禁止 25 端口。" }, { status: 400 });
      }
      const next = cleanReminderConfig({ ...current, ...(input || {}), enabled: false, testedConfigHash: "", schedulerPath: "" });
      if (!next.sender || !next.recipient) {
        return jsonResponse({ message: "请填写有效的发件邮箱和收件邮箱。" }, { status: 400 });
      }
      if (next.provider === "custom" && (!next.host || ![465, 587].includes(next.port))) {
        return jsonResponse({ message: "自定义 SMTP 只允许 465 或 587 端口。" }, { status: 400 });
      }
      if ((next.port === 465 && next.security !== "tls") || (next.port === 587 && next.security !== "starttls")) {
        return jsonResponse({ message: "465 必须使用 TLS，587 必须使用 STARTTLS。" }, { status: 400 });
      }
      if (next.username !== next.sender) {
        return jsonResponse({ message: "发件地址必须与 SMTP 认证邮箱一致。" }, { status: 400 });
      }
      if (current.enabled || current.schedulerPath) await uninstallScheduler(root, current);
      await withReminderLock(root, () =>
        writeLocalSettingsFile({ ...settings, reminders: next }),
      );
      return jsonResponse(await readReminderStatus());
    }
    if (url.pathname === "/api/reminders/credential" && method === "POST") {
      const input = parseJson(textFromBody(body), {});
      if (current.enabled || current.schedulerPath) await uninstallScheduler(root, current);
      await withReminderLock(root, async () => {
        await saveReminderSecret(root, current, clean(input?.secret, 500));
      });
      const next = { ...current, testedConfigHash: "", enabled: false, schedulerPath: "", configuredAt: new Date().toISOString() };
      await withReminderLock(root, () =>
        writeLocalSettingsFile({ ...settings, reminders: next }),
      );
      return jsonResponse(await readReminderStatus());
    }
    if (url.pathname === "/api/reminders/credential" && method === "DELETE") {
      await uninstallScheduler(root, current);
      await withReminderLock(root, async () => {
        await deleteReminderSecret(root, current);
      });
      const next = { ...current, enabled: false, testedConfigHash: "", schedulerPath: "" };
      await withReminderLock(root, () =>
        writeLocalSettingsFile({ ...settings, reminders: next }),
      );
      return jsonResponse(await readReminderStatus());
    }
    if (url.pathname === "/api/reminders/test" && method === "POST") {
      await runReminderJob({ test: true });
      const next = { ...current, testedConfigHash: reminderConfigHash(current) };
      await withReminderLock(root, () =>
        writeLocalSettingsFile({ ...settings, reminders: next }),
      );
      return jsonResponse(await readReminderStatus());
    }
    if (url.pathname === "/api/reminders/enable" && method === "POST") {
      if (!current.sender || !current.recipient || !current.testedConfigHash || current.testedConfigHash !== reminderConfigHash(current)) {
        return jsonResponse({ message: "请先保存配置并发送测试邮件。" }, { status: 400 });
      }
      const wasEnabled = current.enabled;
      const next = { ...current, enabled: true, enabledAt: current.enabledAt || new Date().toISOString() };
      await withReminderLock(root, () =>
        writeLocalSettingsFile({ ...settings, reminders: next }),
      );
      try {
        if (!wasEnabled) await runReminderJob({ force: true });
        const scheduler = await installScheduler(root, next);
        await withReminderLock(root, () =>
          writeLocalSettingsFile({
            ...settings,
            reminders: {
              ...next,
              schedulerPath: scheduler.plist || scheduler.taskName || root,
            },
          }),
        );
        return jsonResponse({ ...(await readReminderStatus()), scheduler });
      } catch (error) {
        await withReminderLock(root, () =>
          writeLocalSettingsFile({ ...settings, reminders: { ...next, enabled: false } }),
        );
        throw error;
      }
    }
    if (url.pathname === "/api/reminders/run-now" && method === "POST") {
      const result = await runReminderJob({ force: true });
      return jsonResponse({ ...(await readReminderStatus()), result });
    }
    if (url.pathname === "/api/reminders/disable" && method === "POST") {
      await uninstallScheduler(root, current);
      const next = { ...current, enabled: false, schedulerPath: "" };
      await withReminderLock(root, () =>
        writeLocalSettingsFile({ ...settings, reminders: next }),
      );
      return jsonResponse(await readReminderStatus());
    }
    return jsonResponse({ message: "Unsupported reminder operation." }, { status: 405 });
  } catch (error) {
    return jsonResponse({ message: String(error?.message || "邮件提醒操作失败").slice(0, 600) }, { status: 500 });
  }
}

async function handleLocalData(url, method, body) {
  if (url.pathname !== "/api/local-data") return undefined;
  try {
    if (method === "GET" || method === "HEAD") {
      const data = await readLocalDataFile();
      return jsonResponse(method === "HEAD" ? null : data);
    }
    if (method !== "PUT") {
      return jsonResponse(
        { message: "Only GET and PUT are supported." },
        { status: 405, headers: { allow: "GET, PUT" } },
      );
    }
    const data = await withReminderLock(root, () =>
      writeLocalDataFile(parseJson(textFromBody(body))),
    );
    return jsonResponse(data);
  } catch {
    return jsonResponse(
      { message: "Anthropology Canteen could not read or write local data." },
      { status: 500 },
    );
  }
}

async function handleLocalSettings(url, method, body) {
  if (url.pathname !== "/api/local-settings") return undefined;
  try {
    if (method === "GET" || method === "HEAD") {
      const settings = await refreshRuntimeSettings();
      return jsonResponse(
        method === "HEAD" ? null : publicLocalSettings(settings),
      );
    }
    if (method !== "PUT") {
      return jsonResponse(
        { message: "Only GET and PUT are supported." },
        { status: 405, headers: { allow: "GET, PUT" } },
      );
    }
    const input = parseJson(textFromBody(body));
    const current = await readLocalSettingsFile();
    const hasOpenAlexKey = Object.prototype.hasOwnProperty.call(
      input || {},
      "openAlexApiKey",
    );
    const hasSemanticScholarKey = Object.prototype.hasOwnProperty.call(
      input || {},
      "semanticScholarApiKey",
    );
    const rawOpenAlexKey = hasOpenAlexKey
      ? clean(input?.openAlexApiKey, 240)
      : current.openAlexApiKey;
    const rawSemanticScholarKey = hasSemanticScholarKey
      ? clean(input?.semanticScholarApiKey, 240)
      : current.semanticScholarApiKey;
    if (rawOpenAlexKey && !cleanApiKey(rawOpenAlexKey)) {
      return jsonResponse(
        { message: "The OpenAlex API key format is invalid." },
        { status: 400 },
      );
    }
    if (rawSemanticScholarKey && !cleanApiKey(rawSemanticScholarKey)) {
      return jsonResponse(
        { message: "The Semantic Scholar API key format is invalid." },
        { status: 400 },
      );
    }
    const settings = await withReminderLock(root, () =>
      writeLocalSettingsFile({
        openAlexApiKey: rawOpenAlexKey,
        semanticScholarApiKey: rawSemanticScholarKey,
        reminders: current.reminders,
      }),
    );
    return jsonResponse(publicLocalSettings(settings));
  } catch {
    return jsonResponse(
      { message: "Anthropology Canteen could not save local settings." },
      { status: 500 },
    );
  }
}

function handleRuntimeStatus(url, method, autoClose) {
  if (url.pathname !== "/api/runtime-status") return undefined;
  if (method !== "GET" && method !== "HEAD") {
    return jsonResponse(
      { message: "Only GET is supported." },
      { status: 405, headers: { allow: "GET" } },
    );
  }
  return jsonResponse(
    method === "HEAD"
      ? null
      : {
          app: "anthropology-canteen",
          mode: "portable",
          autoClose,
          packageRoot: root,
          sessionToken: runtimeSessionToken,
        },
  );
}

export async function fetchFeedForReminder(subscriptions) {
  await refreshRuntimeSettings();
  const request = new Request("http://anthropology-canteen.localhost/api/feed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscriptions }),
  });
  const response = await worker.fetch(
    request,
    { ASSETS: { fetch: serveAsset } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  if (!response.ok) {
    throw new Error(`学术数据刷新失败（HTTP ${response.status}）。`);
  }
  return response.json();
}

export {
  dataRoot,
  emptyLocalData,
  readLocalDataFile,
  readLocalSettingsFile,
  writeLocalDataFile,
  writeLocalSettingsFile,
};

export function createAnthropologyServer({ autoClose = false } = {}) {
  const browserSessions = new Set();
  let browserSessionSeen = false;
  let closeTimer;
  let startupTimer;
  let shuttingDown = false;

  const clearCloseTimer = () => {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = undefined;
  };

  const server = createServer(async (incoming, outgoing) => {
    try {
      const host = incoming.headers.host || "127.0.0.1:3000";
      const url = new URL(incoming.url || "/", `http://${host}`);

      if (
        url.pathname === "/api/browser-session" &&
        incoming.method === "GET"
      ) {
        browserSessionSeen = true;
        clearCloseTimer();
        if (startupTimer) clearTimeout(startupTimer);
        startupTimer = undefined;

        const session = { incoming, outgoing };
        browserSessions.add(session);
        outgoing.writeHead(200, {
          "cache-control": "no-cache, no-store",
          connection: "keep-alive",
          "content-type": "text/event-stream; charset=utf-8",
          "x-accel-buffering": "no",
        });
        outgoing.write(
          `event: ready\ndata: ${JSON.stringify({ app: "anthropology-canteen" })}\n\n`,
        );
        const heartbeat = setInterval(() => {
          if (!outgoing.destroyed) outgoing.write(": keep-alive\n\n");
        }, 15_000);
        heartbeat.unref();

        let cleaned = false;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          clearInterval(heartbeat);
          browserSessions.delete(session);
          if (
            autoClose &&
            browserSessionSeen &&
            browserSessions.size === 0 &&
            !shuttingDown &&
            activeReminderJobs === 0
          ) {
            clearCloseTimer();
            closeTimer = setTimeout(
              () => void shutdown("last browser page closed"),
              8_000,
            );
            closeTimer.unref();
          }
        };
        incoming.once("aborted", cleanup);
        outgoing.once("close", cleanup);
        return;
      }

      const body = await readRequestBody(incoming);
      const request = new Request(url, {
        method: incoming.method,
        headers: incoming.headers,
        body,
      });
      let response =
        await handleLocalData(url, incoming.method || "GET", body);
      if (!response) {
        response = await handleReminders(
          url,
          incoming.method || "GET",
          body,
          incoming.headers,
        );
      }
      if (!response) {
        response = await handleLocalSettings(
          url,
          incoming.method || "GET",
          body,
        );
      }
      if (!response) {
        response = handleRuntimeStatus(
          url,
          incoming.method || "GET",
          autoClose,
        );
      }
      if (!response) response = await serveAsset(request);
      if (response.status === 404) {
        await refreshRuntimeSettings();
        response = await worker.fetch(
          request,
          { ASSETS: { fetch: serveAsset } },
          {
            waitUntil() {},
            passThroughOnException() {},
          },
        );
      }

      outgoing.statusCode = response.status;
      response.headers.forEach((value, key) => outgoing.setHeader(key, value));
      const responseType = response.headers.get("content-type") || "";
      if (responseType.startsWith("text/html")) {
        // Every portable version uses the same friendly localhost origin.
        // Never let an older HTML shell point at removed hashed assets.
        outgoing.setHeader("cache-control", "no-cache, no-store, must-revalidate");
        outgoing.setHeader("pragma", "no-cache");
        outgoing.setHeader("expires", "0");
      } else if (url.pathname.startsWith("/assets/")) {
        outgoing.setHeader("cache-control", "public, max-age=31536000, immutable");
      }
      if (incoming.method === "HEAD" || !response.body) {
        outgoing.end();
        return;
      }
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error(error);
      outgoing.statusCode = 500;
      outgoing.setHeader("content-type", "text/plain; charset=utf-8");
      outgoing.end("Anthropology Canteen could not complete this request.");
    }
  });

  async function shutdown(reason = "shutdown requested") {
    if (shuttingDown) return;
    shuttingDown = true;
    clearCloseTimer();
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = undefined;
    try {
      await unlink(pidFile);
    } catch (error) {
      if (error?.code !== "ENOENT") console.error(error);
    }
    console.log(`Anthropology Canteen: ${reason}.`);
    server.closeIdleConnections?.();
    server.close(() => {
      if (process.argv[1]) process.exit(0);
    });
    const forceExit = setTimeout(() => {
      if (process.argv[1]) process.exit(0);
    }, 5_000);
    forceExit.unref();
  }

  server.shutdown = shutdown;
  server.on("listening", () => {
    if (!autoClose) return;
    startupTimer = setTimeout(() => {
      if (!browserSessionSeen && !shuttingDown) {
        void shutdown("browser did not open");
      }
    }, 90_000);
    startupTimer.unref();
  });

  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  const autoClose = process.argv.includes("--auto-close");
  const server = createAnthropologyServer({ autoClose });
  server.once("error", (error) => {
    console.error(
      error?.code === "EADDRINUSE"
        ? `Port ${port} is already in use.`
        : error,
    );
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", async () => {
    await ensureDataRoot();
    await refreshRuntimeSettings();
    await writeFile(pidFile, String(process.pid), "utf8");
    console.log("");
    console.log("Anthropology Canteen is ready.");
    console.log(`Open: http://anthropology-canteen.localhost:${port}`);
    console.log(`Backup: http://localhost:${port}`);
    console.log("");
    console.log(
      autoClose
        ? "The server will stop after the last Anthropology Canteen page closes."
        : "Press Ctrl+C to stop.",
    );
  });
  process.once("SIGINT", () => void server.shutdown("received SIGINT"));
  process.once("SIGTERM", () => void server.shutdown("received SIGTERM"));
}
