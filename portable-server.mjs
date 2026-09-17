import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
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
  inspectReminderSecret,
  readReminderState,
  saveReminderSecret,
  withDirectoryLock,
  withReminderLock,
  writeJsonAtomic,
  writeReminderState,
} from "./reminder-utils.mjs";
import {
  getSchedulerStatus,
  installScheduler,
  uninstallScheduler,
  WINDOWS_SCHEDULER_PERMISSION_MESSAGE,
} from "./reminder-scheduler.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(root, "dist", "client");
const dataRoot = resolve(root, "data");
const dataFile = resolve(dataRoot, "anthropology-canteen-data.json");
const settingsFile = resolve(dataRoot, "anthropology-canteen-settings.json");
const reminderStateFile = resolve(dataRoot, "anthropology-canteen-reminder-state.json");
const reminderSecretFile = resolve(dataRoot, "anthropology-canteen-reminder-secret.json");
const pidFile = resolve(dataRoot, "anthropology-canteen-server.pid");
const runtimeSessionToken = randomUUID();
const LOCAL_DATA_VERSION = 8;
const LOCAL_SETTINGS_VERSION = 3;
const REMINDER_STATE_VERSION = 2;
const REMINDER_SECRET_VERSION = 1;
const MIGRATION_SETTINGS_FIELDS = new Set([
  "version",
  "openAlexApiKey",
  "semanticScholarApiKey",
  "reminders",
]);
const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;
let activeReminderJobs = 0;
let reminderMigration;
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
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    const error = new Error("Request body is too large.");
    error.code = "BODY_TOO_LARGE";
    throw error;
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_REQUEST_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
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

function cleanPublicationDate(value, explicitPrecision) {
  const raw = clean(value, 80);
  const match = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/.exec(raw);
  const fallback = { publishedAt: "1900-01-01", publishedPrecision: "year" };
  if (!match) return fallback;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : 1;
  const day = match[3] ? Number(match[3]) : 1;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    !Number.isInteger(year) ||
    year < 1000 ||
    year > 9999 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > maxDay
  ) {
    return fallback;
  }
  const storedPrecision = ["day", "month", "year"].includes(explicitPrecision)
    ? explicitPrecision
    : null;
  const inferredPrecision = /^\d{4}-01-01(?:T|$)/.test(raw)
    ? "year"
    : match[3]
      ? "day"
      : match[2]
        ? "month"
        : "year";
  return {
    publishedAt: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    publishedPrecision: storedPrecision || inferredPrecision,
  };
}

function emptyLocalData() {
  return {
    version: LOCAL_DATA_VERSION,
    revision: 0,
    savedAt: new Date().toISOString(),
    subscriptions: { journal: [], scholar: [], keyword: [] },
    states: {},
    articleArchive: {},
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
        .map((item) => ({
          label: clean(item?.label, 180),
          issn: clean(item?.issn, 40),
          followedAt: cleanTimestamp(item?.followedAt, migrationBaseline),
        }))
        .filter((item) => item.label && item.issn)
    : [];
  const scholar = Array.isArray(value.scholar)
    ? value.scholar
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
                  .map((area) => clean(area, 160))
                  .filter(Boolean)
              : undefined,
            verifiedWorkDois: Array.isArray(candidate?.verifiedWorkDois)
              ? candidate.verifiedWorkDois
                  .map((doi) =>
                    clean(doi, 300)
                      .replace(/^https?:\/\/doi\.org\//i, "")
                      .toLowerCase(),
                  )
                  .filter(Boolean)
              : undefined,
            sources: Array.isArray(candidate?.sources)
              ? candidate.sources
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
                  .map((item) => clean(item, 160))
                  .filter(Boolean)
              : [],
          };
        })
        .filter(Boolean)
    : [];
  const keyword = Array.isArray(value.keyword)
    ? value.keyword
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
          return {
            kind,
            label,
            subscriptionId: clean(item?.subscriptionId, 300) || undefined,
            terms,
          };
        })
        .filter(Boolean)
    : [];
}

function cleanArticle(value) {
  const id = clean(value?.id, 500);
  const title = clean(value?.title, 1000);
  const matches = cleanMatches(value?.matches);
  if (!id || !title || matches.length === 0) return null;
  const publication = cleanPublicationDate(
    value?.publishedAt,
    value?.publishedPrecision,
  );
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
    ...publication,
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
    coverage: Array.isArray(value.coverage)
      ? value.coverage.map((item) => ({
          subscriptionId: clean(item?.subscriptionId, 300),
          kind: ["journal", "scholar"].includes(item?.kind)
            ? item.kind
            : "scholar",
          label: clean(item?.label, 300),
          status: ["success", "partial", "failed"].includes(item?.status)
            ? item.status
            : "success",
          providers: Array.isArray(item?.providers)
            ? item.providers
                .map((provider) => ({
                  provider: [
                    "openalex",
                    "semanticScholar",
                    "crossref",
                  ].includes(provider?.provider)
                    ? provider.provider
                    : "",
                  status:
                    provider?.status === "failed" ? "failed" : "success",
                }))
                .filter((provider) => provider.provider)
            : [],
        })).filter((item) => item.subscriptionId && item.label)
      : [],
  };
}

function cleanArticleArchive(value, states, feed) {
  const stored = {};
  if (value && typeof value === "object") {
    for (const rawArticle of Object.values(value)) {
      const article = cleanArticle(rawArticle);
      if (article) stored[article.id] = article;
    }
  }
  const live = Object.fromEntries(
    (feed?.items || []).map((article) => [article.id, article]),
  );
  const archive = {};
  for (const [id, state] of Object.entries(states)) {
    if (!state.saved && !state.ignored) continue;
    const article = live[id] || stored[id];
    if (article) archive[id] = article;
  }
  return archive;
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
          .map((item) => clean(item, 500))
          .filter(Boolean)
      : [],
    scoreReasons: Array.isArray(value.scoreReasons)
      ? value.scoreReasons
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
  for (const [storedKey, profile] of Object.entries(value)) {
    const key = clean(storedKey, 300);
    if (!key || !profile || typeof profile !== "object") continue;
    const candidate = cleanScholarProfileCandidate(profile.candidate);
    if (!candidate) continue;
    const works = Array.isArray(profile.works)
      ? profile.works.map(cleanScholarWork).filter(Boolean)
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
    for (const [id, state] of Object.entries(value.states)) {
      const key = clean(id, 500);
      if (key) states[key] = cleanArticleState(state);
    }
  }

  const translations = {};
  if (value.translations && typeof value.translations === "object") {
    for (const [id, translation] of Object.entries(value.translations)) {
      const key = clean(id, 500);
      const text = clean(translation, 12000);
      if (key && text) translations[key] = text;
    }
  }

  const feed = quarantineLegacyIdentity ? null : cleanFeed(value.feed);

  return {
    version: LOCAL_DATA_VERSION,
    revision:
      Number.isSafeInteger(value.revision) && value.revision >= 0
        ? value.revision
        : 0,
    savedAt,
    subscriptions: cleanSubscriptions(
      value.subscriptions,
      migrationBaseline,
      quarantineLegacyIdentity,
    ),
    states,
    articleArchive: cleanArticleArchive(
      quarantineLegacyIdentity ? null : value.articleArchive,
      states,
      feed,
    ),
    feed,
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
      Object.keys(data.articleArchive).length ||
      Object.keys(data.translations).length ||
      Object.keys(data.scholarProfiles).length ||
      data.feed?.items.length,
  );
}

async function ensureDataRoot() {
  await mkdir(dataRoot, { recursive: true });
}

async function readJsonWithBackup(file) {
  try {
    return parseJson(await readFile(file, "utf8"));
  } catch (primaryError) {
    if (primaryError?.code === "ENOENT") throw primaryError;
    try {
      const recovered = parseJson(await readFile(`${file}.backup`, "utf8"));
      await writeJsonAtomic(file, recovered);
      return recovered;
    } catch {
      throw primaryError;
    }
  }
}

function migrationLockPath() {
  return resolve(dataRoot, ".anthropology-canteen-migration.lock");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateMigrationData(value) {
  if (!Number.isInteger(value?.version) || value.version < 2 || value.version > LOCAL_DATA_VERSION) {
    throw new Error("unsupported-data");
  }
  if (!isPlainObject(value.subscriptions) || !isPlainObject(value.states)) {
    throw new Error("invalid-data");
  }
  for (const kind of ["journal", "scholar", "keyword"]) {
    if (!Array.isArray(value.subscriptions[kind])) throw new Error("invalid-data");
  }
}

function validateMigrationSettings(value) {
  if (![2, LOCAL_SETTINGS_VERSION].includes(value?.version)) {
    throw new Error("unsupported-settings");
  }
  if (Object.keys(value).some((key) => !MIGRATION_SETTINGS_FIELDS.has(key))) {
    throw new Error("invalid-settings");
  }
  for (const key of ["openAlexApiKey", "semanticScholarApiKey"]) {
    if (key in value && typeof value[key] !== "string") throw new Error("invalid-settings");
  }
  if ("reminders" in value && !isPlainObject(value.reminders)) {
    throw new Error("invalid-settings");
  }
}

function validateMigrationReminderState(value) {
  if (
    ![1, REMINDER_STATE_VERSION].includes(value?.version) ||
    !isPlainObject(value.items) ||
    !isPlainObject(value.baselines)
  ) {
    throw new Error("invalid-reminder-state");
  }
}

function validateMigrationReminderSecret(value) {
  if (
    value?.version !== REMINDER_SECRET_VERSION ||
    typeof value.ciphertext !== "string" ||
    !value.ciphertext.trim()
  ) {
    throw new Error("invalid-reminder-secret");
  }
}

async function readMigrationJson(file, validate) {
  try {
    const bytes = await readFile(file);
    const value = parseJson(bytes.toString("utf8"));
    if (!isPlainObject(value)) throw new Error("invalid-json-object");
    validate(value);
    return { exists: true, bytes, value };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false };
    throw error;
  }
}

async function readMigrationTarget(file, validate) {
  try {
    return await readMigrationJson(file, validate);
  } catch (error) {
    return { exists: true, error };
  }
}

function isBlankLocalSettings(value) {
  const settings = cleanLocalSettings(value);
  const reminders = settings.reminders;
  return Boolean(
    !settings.openAlexApiKey &&
      !settings.semanticScholarApiKey &&
      !reminders.enabled &&
      !reminders.sender &&
      !reminders.recipient &&
      !reminders.host &&
      reminders.port === 465 &&
      reminders.security === "tls" &&
      !reminders.username &&
      reminders.format === "concise" &&
      reminders.schedule.cadence === "daily" &&
      reminders.schedule.time === "08:00" &&
      reminders.schedule.weekday === 1 &&
      reminders.schedule.monthDay === 1 &&
      !reminders.testedConfigHash &&
      !reminders.schedulerPath &&
      !reminders.configuredAt
  );
}

function isBlankReminderState(value) {
  return Boolean(
    !value.baselineComplete &&
      !Object.keys(value.baselines || {}).length &&
      !Object.keys(value.items || {}).length &&
      !value.pendingDigest &&
      !value.enabledAt &&
      !value.lastAttemptAt &&
      !value.lastCheckAt &&
      !value.lastSuccessfulCheckAt &&
      !value.lastSuccessfulSendAt &&
      !value.nextDueAt &&
      !value.lastError &&
      !value.lastResult
  );
}

function reminderIdentity(settings) {
  const reminders = cleanLocalSettings(settings).reminders;
  if (!reminders.installationId || !reminders.credentialRef || !reminders.sender) return "";
  return JSON.stringify({
    installationId: reminders.installationId,
    credentialRef: reminders.credentialRef,
    sender: reminders.sender,
    username: reminders.username,
  });
}

async function findSiblingMigrationCandidates() {
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
      const source = await readMigrationJson(candidate, validateMigrationData);
      const data = cleanLocalData(source.value);
      if (hasLocalDataContent(data)) {
        const savedAtMs = Date.parse(data.savedAt || "");
        candidates.push({
          root: siblingRoot,
          dataFile: candidate,
          data,
          mtimeMs: Number.isFinite(savedAtMs) ? savedAtMs : info.mtimeMs,
        });
      }
    } catch {
      // Ignore unrelated folders and unreadable old copies.
    }
  }

  return candidates.sort((a, b) =>
    b.mtimeMs - a.mtimeMs || a.root.localeCompare(b.root),
  );
}

function migrationBackupPath(destination) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  return destination.replace(/\.json$/i, `.backup-migration-${stamp}-${randomUUID()}.json`);
}

async function pathExists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function installMigrationFiles(files, options = {}) {
  const renameFile = options.renameFile || rename;
  const prepared = [];
  for (const file of files) await mkdir(dirname(file.destination), { recursive: true });
  try {
    for (const [index, file] of files.entries()) {
      const temporary = `${file.destination}.migration-${process.pid}-${randomUUID()}`;
      const handle = await open(temporary, "w");
      try {
        await handle.writeFile(file.bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      prepared.push({
        ...file,
        temporary,
        backup: (await pathExists(file.destination))
          ? migrationBackupPath(file.destination)
          : "",
        backedUp: false,
        installed: false,
        index,
      });
    }

    for (const file of prepared) {
      if (file.backup) {
        await renameFile(file.destination, file.backup);
        file.backedUp = true;
      }
      await renameFile(file.temporary, file.destination);
      file.installed = true;
    }
  } catch (error) {
    for (const file of prepared.reverse()) {
      if (file.installed) await rm(file.destination, { force: true }).catch(() => undefined);
      if (file.backedUp && await pathExists(file.backup)) {
        await rename(file.backup, file.destination).catch(() => undefined);
      }
      await rm(file.temporary, { force: true }).catch(() => undefined);
    }
    throw error;
  }
  return prepared.filter((file) => file.backup).map((file) => file.backup);
}

function recordReminderMigration(outcome, reason = "") {
  reminderMigration = { outcome };
  if (reason) reminderMigration.reason = reason;
}

async function loadSourceReminderFiles(candidate) {
  const sourceDataRoot = resolve(candidate.root, "data");
  const settings = await readMigrationJson(
    resolve(sourceDataRoot, "anthropology-canteen-settings.json"),
    validateMigrationSettings,
  );
  const state = await readMigrationJson(
    resolve(sourceDataRoot, "anthropology-canteen-reminder-state.json"),
    validateMigrationReminderState,
  );
  const secret = await readMigrationJson(
    resolve(sourceDataRoot, "anthropology-canteen-reminder-secret.json"),
    validateMigrationReminderSecret,
  );
  return { settings, state, secret };
}

async function ensureSiblingMigration() {
  if (reminderMigration?.outcome === "restored") return;
  await ensureDataRoot();
  await withDirectoryLock(migrationLockPath(), async () => {
    if (reminderMigration?.outcome === "restored") return;
    const [targetData, targetSettings, targetState, targetSecret, candidates] = await Promise.all([
      readMigrationTarget(dataFile, validateMigrationData),
      readMigrationTarget(settingsFile, validateMigrationSettings),
      readMigrationTarget(reminderStateFile, validateMigrationReminderState),
      readMigrationTarget(reminderSecretFile, validateMigrationReminderSecret),
      findSiblingMigrationCandidates(),
    ]);
    if (!candidates.length) return;

    const targetDataIsEmpty = !targetData.exists || (
      targetData.value && !hasLocalDataContent(cleanLocalData(targetData.value))
    );
    const targetSettingsAreBlank = !targetSettings.exists || (
      targetSettings.value && isBlankLocalSettings(targetSettings.value)
    );
    const targetStateIsBlank = !targetState.exists || (
      targetState.value && isBlankReminderState(targetState.value)
    );
    const targetSecretIsMissing = !targetSecret.exists;

    let candidate;
    let backfill = false;
    if (targetDataIsEmpty) {
      candidate = candidates[0];
    } else {
      if (
        !targetSettings.value ||
        isBlankLocalSettings(targetSettings.value) ||
        (!targetStateIsBlank && !targetSecretIsMissing)
      ) {
        return;
      }
      const identity = reminderIdentity(targetSettings.value);
      if (!identity) return;
      const matches = [];
      for (const possible of candidates) {
        try {
          const sourceSettings = await readMigrationJson(
            resolve(possible.root, "data", "anthropology-canteen-settings.json"),
            validateMigrationSettings,
          );
          if (sourceSettings.exists && reminderIdentity(sourceSettings.value) === identity) {
            matches.push(possible);
          }
        } catch {
          // A damaged candidate cannot establish a unique identity.
        }
      }
      if (matches.length !== 1) {
        recordReminderMigration("manual-import-required", matches.length > 1 ? "ambiguous-source" : "source-not-found");
        return;
      }
      [candidate] = matches;
      backfill = true;
    }

    let source;
    try {
      source = await loadSourceReminderFiles(candidate);
    } catch {
      recordReminderMigration("manual-import-required", "source-invalid");
      return;
    }

    const sourceSettings = source.settings.exists
      ? cleanLocalSettings(source.settings.value)
      : null;
    let sourceCredential = { status: "missing", secret: "" };
    if (source.secret.exists && process.platform === "win32") {
      sourceCredential = await inspectReminderSecret(root, sourceSettings?.reminders || cleanReminderConfig({}), {
        platform: "win32",
        secretRoot: candidate.root,
        helperRoot: root,
      });
      if (sourceCredential.status !== "configured") {
        recordReminderMigration("manual-import-required", "credential-unreadable");
        return;
      }
    }

    const sourceIdentity = sourceSettings ? reminderIdentity(sourceSettings) : "";
    const targetIdentity = targetSettings.value ? reminderIdentity(targetSettings.value) : "";
    const canUseSourceReminder = Boolean(
      sourceSettings &&
      (targetSettingsAreBlank || sourceIdentity === targetIdentity),
    );
    const files = [];
    if (!backfill && targetDataIsEmpty) {
      files.push({
        destination: dataFile,
        bytes: Buffer.from(`${JSON.stringify(candidate.data, null, 2)}\n`, "utf8"),
      });
    }
    if (sourceSettings && targetSettingsAreBlank) {
      files.push({
        destination: settingsFile,
        bytes: Buffer.from(`${JSON.stringify(sourceSettings, null, 2)}\n`, "utf8"),
      });
    }
    if (source.state.exists && targetStateIsBlank && canUseSourceReminder) {
      files.push({ destination: reminderStateFile, bytes: source.state.bytes });
    }
    if (
      process.platform === "win32" &&
      source.secret.exists &&
      targetSecretIsMissing &&
      canUseSourceReminder
    ) {
      files.push({ destination: reminderSecretFile, bytes: source.secret.bytes });
    }

    if (!files.length) {
      if (sourceSettings?.reminders?.sender && !canUseSourceReminder) {
        recordReminderMigration("manual-import-required", "target-settings-present");
      }
      return;
    }

    try {
      await installMigrationFiles(files);
    } catch {
      recordReminderMigration("manual-import-required", "write-failed");
      return;
    }

    if (sourceSettings?.reminders?.sender) {
      const finalSettings = targetSettingsAreBlank
        ? sourceSettings
        : cleanLocalSettings(targetSettings.value);
      const credential = await inspectReminderSecret(root, finalSettings.reminders);
      if (credential.status === "configured") {
        recordReminderMigration("restored");
      } else {
        recordReminderMigration(
          "manual-import-required",
          credential.status === "unreadable" ? "credential-unreadable" : "credential-missing",
        );
      }
    }
  });
}

async function readLocalDataFile() {
  await ensureSiblingMigration();
  try {
    return cleanLocalData(await readJsonWithBackup(dataFile));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const data = emptyLocalData();
    await writeJsonAtomic(dataFile, data);
    return data;
  }
}

async function writeLocalDataFile(value) {
  await ensureDataRoot();
  const data = cleanLocalData(value, true);
  data.revision = Math.max(0, data.revision) + 1;
  await writeJsonAtomic(dataFile, data);
  return data;
}

function localDataLockPath() {
  return resolve(dataRoot, ".anthropology-canteen-local-data.lock");
}

function localSettingsLockPath() {
  return resolve(dataRoot, ".anthropology-canteen-local-settings.lock");
}

async function patchLocalDataFile(patch) {
  return withDirectoryLock(localDataLockPath(), async () => {
    const current = await readLocalDataFile();
    const allowed = {};
    for (const key of [
      "subscriptions",
      "states",
      "articleArchive",
      "feed",
      "translations",
      "scholarProfiles",
    ]) {
      if (Object.prototype.hasOwnProperty.call(patch || {}, key)) {
        allowed[key] = patch[key];
      }
    }
    return writeLocalDataFile({ ...current, ...allowed, revision: current.revision });
  });
}

async function readLocalSettingsFile() {
  await ensureSiblingMigration();
  try {
    return cleanLocalSettings(
      await readJsonWithBackup(settingsFile),
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return emptyLocalSettings();
  }
}

async function writeLocalSettingsFile(value) {
  await ensureDataRoot();
  const settings = cleanLocalSettings(value);
  await writeJsonAtomic(settingsFile, settings);
  applyRuntimeSettings(settings);
  return settings;
}

async function patchLocalSettingsFile(patch) {
  return withDirectoryLock(localSettingsLockPath(), async () => {
    const current = await readLocalSettingsFile();
    return writeLocalSettingsFile({ ...current, ...(patch || {}) });
  });
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

function allowedLocalHostname(value) {
  const hostname = String(value || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  return [
    "localhost",
    "127.0.0.1",
    "::1",
    "anthropology-canteen.localhost",
  ].includes(hostname);
}

function parsedLocalHost(host) {
  try {
    const parsed = new URL(`http://${host}`);
    return allowedLocalHostname(parsed.hostname) ? parsed : null;
  } catch {
    return null;
  }
}

function localRequestAuthorized(headers) {
  const token = headers?.["x-anthropology-canteen-session"];
  const origin = headers?.origin;
  const host = headers?.host || "";
  if (token !== runtimeSessionToken) return false;
  if (!origin) return true;
  try {
    const parsedOrigin = new URL(origin);
    const parsedHost = parsedLocalHost(host);
    return Boolean(
      parsedHost &&
      parsedOrigin.protocol === "http:" &&
      allowedLocalHostname(parsedOrigin.hostname) &&
      parsedOrigin.port === parsedHost.port,
    );
  } catch {
    return false;
  }
}

function localOriginAllowed(headers) {
  const origin = headers?.origin;
  if (!origin) return true;
  const host = headers?.host || "";
  try {
    const parsedOrigin = new URL(origin);
    const parsedHost = parsedLocalHost(host);
    return Boolean(
      parsedHost &&
      parsedOrigin.protocol === "http:" &&
      allowedLocalHostname(parsedOrigin.hostname) &&
      parsedOrigin.port === parsedHost.port,
    );
  } catch {
    return false;
  }
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
  const credential = await inspectReminderSecret(root, config);
  const publicScheduler = {
    ...scheduler,
    needsMigration: Boolean(config.enabled && !scheduler.installed),
  };
  return {
    version: 1,
    platform: process.platform,
    config: reminderPublicConfig(config),
    credentialConfigured: credential.status === "configured",
    credentialStatus: credential.status,
    tested: Boolean(config.testedConfigHash && config.testedConfigHash === reminderConfigHash(config)),
    scheduler: publicScheduler,
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
    ...(reminderMigration ? { reminderMigration } : {}),
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

function schedulerReference(scheduler, fallback) {
  return scheduler?.plist || scheduler?.taskName || scheduler?.path || fallback;
}

export function publicReminderErrorMessage(error) {
  const preferred = typeof error?.userMessage === "string"
    ? error.userMessage.trim()
    : "";
  const raw = String(preferred || error?.message || error || "邮件提醒操作失败");
  if (
    /(ANTHROPOLOGY_CANTEEN_SCHEDULER_PERMISSION_DENIED|PermissionDenied|Access\s+is\s+denied|HRESULT\s*0x80070005|0x80070005|UnauthorizedAccess)/i.test(raw)
  ) {
    return WINDOWS_SCHEDULER_PERMISSION_MESSAGE;
  }
  let summary = raw.replaceAll("\0", "").split(/\r?\n/)[0].trim();
  if (!summary || /\uFFFD/.test(summary)) return "邮件提醒操作失败，请重试。";
  summary = summary
    .replace(/[A-Za-z]:\\[^\r\n]*/g, "[本机路径]")
    .replace(/\/(?:Users|home)\/[^\r\n]*/gi, "[本机路径]")
    .replace(/file:\/\/\/[^\s]+/gi, "[本机路径]")
    .slice(0, 600);
  return summary || "邮件提醒操作失败，请重试。";
}

export async function enableReminderTransaction({
  current,
  rootPath,
  install,
  uninstall,
  persist,
  runInitialCheck,
  snapshotLedger,
  restoreLedger,
  now = () => new Date().toISOString(),
}) {
  const wasEnabled = Boolean(current.enabled);
  const activating = {
    ...current,
    enabled: true,
    enabledAt: current.enabledAt || now(),
  };
  const ledgerSnapshot = wasEnabled ? undefined : await snapshotLedger();
  const scheduler = await install(activating);
  const activated = {
    ...activating,
    schedulerPath: schedulerReference(scheduler, rootPath),
  };
  try {
    await persist(activated);
    if (!wasEnabled) await runInitialCheck();
    return { config: activated, scheduler };
  } catch (primaryError) {
    const rollbackErrors = [];
    try {
      await persist(current);
    } catch (error) {
      rollbackErrors.push(error);
    }
    try {
      await uninstall(activated);
    } catch (error) {
      rollbackErrors.push(error);
    }
    if (!wasEnabled) {
      try {
        await restoreLedger(ledgerSnapshot);
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    if (rollbackErrors.length) {
      primaryError.userMessage =
        `${publicReminderErrorMessage(primaryError)} 提醒未继续启用，但自动回滚未完全成功；请关闭应用后重试停用。`;
    }
    throw primaryError;
  }
}

async function handleReminders(url, method, body, headers) {
  if (url.pathname !== "/api/reminders/status" && !url.pathname.startsWith("/api/reminders/")) {
    return undefined;
  }
  if (!localRequestAuthorized(headers)) {
    return jsonResponse({ message: "邮件提醒请求未通过本地会话验证。" }, { status: 403 });
  }
  if (method === "GET" && url.pathname === "/api/reminders/status") {
    try {
      return jsonResponse(await readReminderStatus());
    } catch {
      return jsonResponse({ message: "无法读取邮件提醒状态。" }, { status: 500 });
    }
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
      await patchLocalSettingsFile({ reminders: next });
      return jsonResponse(await readReminderStatus());
    }
    if (url.pathname === "/api/reminders/credential" && method === "POST") {
      const input = parseJson(textFromBody(body), {});
      if (current.enabled || current.schedulerPath) await uninstallScheduler(root, current);
      await withReminderLock(root, async () => {
        await saveReminderSecret(root, current, clean(input?.secret, 500));
      });
      const next = { ...current, testedConfigHash: "", enabled: false, schedulerPath: "", configuredAt: new Date().toISOString() };
      await patchLocalSettingsFile({ reminders: next });
      return jsonResponse(await readReminderStatus());
    }
    if (url.pathname === "/api/reminders/credential" && method === "DELETE") {
      await uninstallScheduler(root, current);
      await withReminderLock(root, async () => {
        await deleteReminderSecret(root, current);
      });
      const next = { ...current, enabled: false, testedConfigHash: "", schedulerPath: "" };
      await patchLocalSettingsFile({ reminders: next });
      return jsonResponse(await readReminderStatus());
    }
    if (url.pathname === "/api/reminders/test" && method === "POST") {
      await runReminderJob({ test: true });
      const next = { ...current, testedConfigHash: reminderConfigHash(current) };
      await patchLocalSettingsFile({ reminders: next });
      return jsonResponse(await readReminderStatus());
    }
    if (url.pathname === "/api/reminders/enable" && method === "POST") {
      if (!current.sender || !current.recipient || !current.testedConfigHash || current.testedConfigHash !== reminderConfigHash(current)) {
        return jsonResponse({ message: "请先保存配置并发送测试邮件。" }, { status: 400 });
      }
      const { scheduler } = await enableReminderTransaction({
        current,
        rootPath: root,
        install: (config) => installScheduler(root, config),
        uninstall: (config) => uninstallScheduler(root, config),
        persist: (config) => patchLocalSettingsFile({ reminders: config }),
        runInitialCheck: () => runReminderJob({ force: true }),
        snapshotLedger: () => readReminderState(root),
        restoreLedger: (state) => withReminderLock(
          root,
          () => writeReminderState(root, state),
        ),
      });
      return jsonResponse({ ...(await readReminderStatus()), scheduler });
    }
    if (url.pathname === "/api/reminders/run-now" && method === "POST") {
      const result = await runReminderJob({ force: true });
      return jsonResponse({ ...(await readReminderStatus()), result });
    }
    if (url.pathname === "/api/reminders/disable" && method === "POST") {
      await uninstallScheduler(root, current);
      const next = { ...current, enabled: false, schedulerPath: "" };
      await patchLocalSettingsFile({ reminders: next });
      return jsonResponse(await readReminderStatus());
    }
    return jsonResponse({ message: "Unsupported reminder operation." }, { status: 405 });
  } catch (error) {
    return jsonResponse({ message: publicReminderErrorMessage(error) }, { status: 500 });
  }
}

async function handleLocalData(url, method, body, headers) {
  if (url.pathname !== "/api/local-data") return undefined;
  if (!localRequestAuthorized(headers)) {
    return jsonResponse({ message: "本地数据请求未通过会话验证。" }, { status: 403 });
  }
  try {
    if (method === "GET" || method === "HEAD") {
      const data = await readLocalDataFile();
      return jsonResponse(method === "HEAD" ? null : data);
    }
    if (!["PUT", "PATCH"].includes(method)) {
      return jsonResponse(
        { message: "Only GET, PUT and PATCH are supported." },
        { status: 405, headers: { allow: "GET, PUT, PATCH" } },
      );
    }
    const input = parseJson(textFromBody(body));
    const data = method === "PATCH"
      ? await patchLocalDataFile(input?.patch || {})
      : await withDirectoryLock(localDataLockPath(), () =>
          writeLocalDataFile(input),
        );
    return jsonResponse(data);
  } catch {
    return jsonResponse(
      { message: "Anthropology Canteen could not read or write local data." },
      { status: 500 },
    );
  }
}

async function handleLocalSettings(url, method, body, headers) {
  if (url.pathname !== "/api/local-settings") return undefined;
  if (!localRequestAuthorized(headers)) {
    return jsonResponse({ message: "本地设置请求未通过会话验证。" }, { status: 403 });
  }
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
    const settings = await patchLocalSettingsFile({
      openAlexApiKey: rawOpenAlexKey,
      semanticScholarApiKey: rawSemanticScholarKey,
    });
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
  patchLocalDataFile,
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
      const host = incoming.headers.host || "";
      if (!parsedLocalHost(host)) {
        outgoing.writeHead(421, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        outgoing.end(JSON.stringify({ message: "Invalid local host." }));
        return;
      }
      const url = new URL(incoming.url || "/", `http://${host}`);
      if (
        url.pathname.startsWith("/api/") &&
        url.pathname !== "/api/runtime-status" &&
        !localOriginAllowed(incoming.headers)
      ) {
        outgoing.writeHead(403, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        outgoing.end(JSON.stringify({ message: "Invalid local origin." }));
        return;
      }

      if (
        url.pathname === "/api/browser-session" &&
        incoming.method === "GET"
      ) {
        if (!localOriginAllowed(incoming.headers)) {
          outgoing.writeHead(403, { "cache-control": "no-store" });
          outgoing.end();
          return;
        }
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
        await handleLocalData(
          url,
          incoming.method || "GET",
          body,
          incoming.headers,
        );
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
          incoming.headers,
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
      outgoing.setHeader("x-content-type-options", "nosniff");
      outgoing.setHeader("referrer-policy", "no-referrer");
      outgoing.setHeader("cross-origin-resource-policy", "same-origin");
      outgoing.setHeader("content-security-policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
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
      if (error?.code === "BODY_TOO_LARGE") {
        outgoing.writeHead(413, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        outgoing.end(JSON.stringify({ message: "Request body is too large." }));
        return;
      }
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
