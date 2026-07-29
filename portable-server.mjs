import { createServer } from "node:http";
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

const root = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(root, "dist", "client");
const dataRoot = resolve(root, "data");
const dataFile = resolve(dataRoot, "anthropology-canteen-data.json");
const pidFile = resolve(dataRoot, "anthropology-canteen-server.pid");

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

function emptyLocalData() {
  return {
    version: 3,
    savedAt: new Date().toISOString(),
    subscriptions: { journal: [], scholar: [], keyword: [] },
    states: {},
    feed: null,
    translations: {},
  };
}

function cleanOrcid(value) {
  const id = clean(value, 160)
    .replace(/^https?:\/\/orcid\.org\//i, "")
    .toUpperCase();
  return /^\d{4}-\d{4}-\d{4}-[\dX]{4}$/.test(id) ? id : "";
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

function cleanKeywordGroup(value) {
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
  };
}

function cleanSubscriptions(value = {}) {
  const journal = Array.isArray(value.journal)
    ? value.journal
        .slice(0, 40)
        .map((item) => ({
          label: clean(item?.label, 180),
          issn: clean(item?.issn, 40),
        }))
        .filter((item) => item.label && item.issn)
    : [];
  const scholar = Array.isArray(value.scholar)
    ? value.scholar
        .slice(0, 60)
        .map((item) => {
          const candidate =
            typeof item === "string" ? { label: item } : item;
          const label = clean(candidate?.label, 180);
          if (!label) return null;
          const openAlexIds = Array.isArray(candidate?.openAlexIds)
            ? candidate.openAlexIds
                .map(cleanOpenAlexId)
                .filter(Boolean)
            : [];
          const semanticScholarIds = Array.isArray(candidate?.semanticScholarIds)
            ? candidate.semanticScholarIds
                .map((id) => clean(id, 160))
                .filter(Boolean)
            : [];
          const orcid = cleanOrcid(candidate?.orcid) || undefined;
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
                  .slice(0, 20)
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
          };
        })
        .filter(Boolean)
    : [];
  const keyword = Array.isArray(value.keyword)
    ? value.keyword
        .slice(0, 60)
        .map(cleanKeywordGroup)
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

function cleanSavedAt(value) {
  const savedAt = clean(value, 80);
  return Number.isFinite(Date.parse(savedAt)) ? savedAt : new Date().toISOString();
}

function cleanLocalData(value = {}, refreshSavedAt = false) {
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
    version: 3,
    savedAt: refreshSavedAt ? new Date().toISOString() : cleanSavedAt(value.savedAt),
    subscriptions: cleanSubscriptions(value.subscriptions),
    states,
    feed: cleanFeed(value.feed),
    translations,
  };
}

function hasLocalDataContent(data) {
  return Boolean(
    data.subscriptions.journal.length ||
      data.subscriptions.scholar.length ||
      data.subscriptions.keyword.length ||
      Object.keys(data.states).length ||
      Object.keys(data.translations).length ||
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
    return cleanLocalData(parseJson(text));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const data = (await findSiblingLocalData()) || emptyLocalData();
    await writeFile(dataFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    return data;
  }
}

async function writeLocalDataFile(value) {
  await ensureDataRoot();
  const data = cleanLocalData(value, true);
  await writeFile(dataFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return data;
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
    const data = await writeLocalDataFile(parseJson(textFromBody(body)));
    return jsonResponse(data);
  } catch {
    return jsonResponse(
      { message: "Anthropology Canteen could not read or write local data." },
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
        },
  );
}

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
            !shuttingDown
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
        response = handleRuntimeStatus(
          url,
          incoming.method || "GET",
          autoClose,
        );
      }
      if (!response) response = await serveAsset(request);
      if (response.status === 404) {
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
