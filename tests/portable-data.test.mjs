import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

test("portable server upgrades version 2 data without losing saved content", async () => {
  const previousOpenAlexApiKey = process.env.OPENALEX_API_KEY;
  const previousSemanticScholarApiKey =
    process.env.SEMANTIC_SCHOLAR_API_KEY;
  const testRoot = await mkdtemp(
    join(tmpdir(), "anthropology-canteen-v8-test-"),
  );
  const root = join(testRoot, "Anthropology-Canteen-v1.3.1");
  await mkdir(root);
  await cp(new URL("../dist", import.meta.url), join(root, "dist"), {
    recursive: true,
  });
  await copyFile(
    new URL("../portable-server.mjs", import.meta.url),
    join(root, "portable-server.mjs"),
  );
  for (const file of [
    "reminder-utils.mjs",
    "reminder-mail.mjs",
    "reminder-worker.mjs",
    "reminder-scheduler.mjs",
  ]) {
    await copyFile(new URL(`../${file}`, import.meta.url), join(root, file));
  }
  const moduleUrl = pathToFileURL(join(root, "portable-server.mjs"));
  moduleUrl.searchParams.set("test", String(Date.now()));
  const { createAnthropologyServer } = await import(moduleUrl.href);
  const server = createAnthropologyServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const runtime = await fetch(`${baseUrl}/api/runtime-status`).then((response) =>
      response.json(),
    );
    const home = await fetch(`${baseUrl}/`);
    assert.match(home.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
    assert.equal(home.headers.get("x-content-type-options"), "nosniff");
    const sessionHeaders = {
      "content-type": "application/json",
      "x-anthropology-canteen-session": runtime.sessionToken,
    };
    const apiFetch = (path, init = {}) => fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...sessionHeaders, ...(init.headers || {}) },
    });
    const invalidHostStatus = await new Promise((resolve, reject) => {
      const request = httpRequest({
        hostname: "127.0.0.1",
        port: address.port,
        path: "/api/runtime-status",
        headers: { host: "attacker.example" },
      }, (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      });
      request.once("error", reject);
      request.end();
    });
    assert.equal(invalidHostStatus, 421);
    const invalidOrigin = await fetch(`${baseUrl}/api/local-data`, {
      method: "PATCH",
      headers: { ...sessionHeaders, origin: "https://attacker.example" },
      body: JSON.stringify({ patch: { states: {} } }),
    });
    assert.equal(invalidOrigin.status, 403);
    const missingSession = await fetch(`${baseUrl}/api/local-data`);
    assert.equal(missingSession.status, 403);
    const blank = await apiFetch("/api/local-data").then((response) =>
      response.json(),
    );
    assert.equal(blank.version, 8);
    assert.equal(blank.revision, 0);
    assert.deepEqual(blank.subscriptions.scholar, []);

    const blankSettings = await apiFetch(
      "/api/local-settings",
    ).then((response) => response.json());
    assert.equal(blankSettings.openAlexConfigured, false);
    assert.equal(blankSettings.semanticScholarConfigured, false);
    assert.equal("openAlexApiKey" in blankSettings, false);
    assert.equal("semanticScholarApiKey" in blankSettings, false);

    const savedSettings = await apiFetch("/api/local-settings", {
      method: "PUT",
      body: JSON.stringify({
        openAlexApiKey: "test-openalex-key-5678",
        semanticScholarApiKey: "test-semantic-key-2468",
      }),
    }).then((response) => response.json());
    assert.equal(savedSettings.openAlexConfigured, true);
    assert.equal(savedSettings.openAlexKeyHint, "••••5678");
    assert.equal("openAlexApiKey" in savedSettings, false);
    assert.equal(savedSettings.semanticScholarConfigured, true);
    assert.equal(savedSettings.semanticScholarKeyHint, "••••2468");
    assert.equal("semanticScholarApiKey" in savedSettings, false);
    assert.equal(process.env.OPENALEX_API_KEY, "test-openalex-key-5678");
    assert.equal(
      process.env.SEMANTIC_SCHOLAR_API_KEY,
      "test-semantic-key-2468",
    );
    const settingsOnDisk = JSON.parse(
      await readFile(
        join(root, "data", "anthropology-canteen-settings.json"),
        "utf8",
      ),
    );
    assert.equal(
      settingsOnDisk.openAlexApiKey,
      "test-openalex-key-5678",
    );
    assert.equal(
      settingsOnDisk.semanticScholarApiKey,
      "test-semantic-key-2468",
    );

    const legacy = {
      version: 2,
      subscriptions: {
        journal: [{ label: "Ethos", issn: "0091-2131" }],
        scholar: [
          {
            label: "Cheryl Mattingly",
            openAlexIds: ["https://openalex.org/A123"],
            institution: "University of Southern California",
          },
          "Legacy Scholar",
        ],
        keyword: [{ root: "ethic", variants: ["ethic", "ethics", "ethical"] }],
      },
      states: {
        "10.1234/example": { saved: true, read: true, ignored: false },
      },
      feed: {
        items: [
          {
            id: "10.1234/example",
            title: "An Article",
            authors: ["Cheryl Mattingly", "Jason Throop"],
            venue: "Ethos",
            publishedAt: "2025-01-02",
            type: "期刊论文",
            url: "https://doi.org/10.1234/example",
            matches: [{ kind: "scholar", label: "Cheryl Mattingly" }],
          },
        ],
        updatedAt: "2026-07-28T00:00:00.000Z",
        source: "live",
      },
      translations: {
        "10.1234/example": "已保存的中文摘要",
      },
      scholarProfiles: {
        "openalex:A123": {
          candidate: {
            candidateId: "openalex:A123",
            value: "A123",
            label: "Cheryl Mattingly",
            openAlexIds: ["A123"],
            institution: "University of Southern California",
            representativeWorks: [
              {
                id: "10.1234/example",
                doi: "10.1234/example",
                title: "An Article",
                year: 2025,
                abstract: "A cached abstract.",
              },
            ],
          },
          works: [
            {
              id: "10.1234/example",
              doi: "10.1234/example",
              title: "An Article",
              year: 2025,
              abstract: "A cached abstract.",
            },
          ],
          updatedAt: "2026-07-29T12:00:00.000Z",
          complete: true,
        },
      },
    };
    const savedResponse = await apiFetch("/api/local-data", {
      method: "PUT",
      body: JSON.stringify(legacy),
    });
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json();
    assert.equal(saved.version, 8);
    assert.equal(saved.revision, 1);
    assert.equal(saved.subscriptions.journal[0].label, "Ethos");
    assert.equal(saved.subscriptions.scholar[0].openAlexIds[0], "A123");
    assert.match(saved.subscriptions.scholar[0].subscriptionId, /^openalex:/);
    assert.ok(
      Number.isFinite(
        Date.parse(saved.subscriptions.scholar[0].followedAt),
      ),
    );
    assert.equal(saved.feed.items[0].authors[0].name, "Cheryl Mattingly");
    assert.equal(saved.states["10.1234/example"].saved, true);
    assert.equal(
      saved.translations["10.1234/example"],
      "已保存的中文摘要",
    );
    assert.equal(
      saved.scholarProfiles["openalex:A123"].works[0].title,
      "An Article",
    );
    assert.equal(
      saved.scholarProfiles["openalex:A123"].works[0].abstract,
      "A cached abstract.",
    );
    assert.equal(
      saved.scholarProfiles["openalex:A123"].complete,
      true,
    );

    const expandedSubscriptions = {
      journal: Array.from({ length: 45 }, (_, index) => ({
        label: `Journal ${index}`,
        issn: `0000-${String(index).padStart(4, "0")}`,
      })),
      scholar: Array.from({ length: 65 }, (_, index) => ({
        label: `Scholar ${index}`,
        subscriptionId: `manual:scholar-${index}`,
        institution: "Test University",
      })),
      keyword: Array.from({ length: 65 }, (_, index) => ({
        root: `term${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
        variants: [],
      })),
    };
    const patchedSubscriptions = await apiFetch("/api/local-data", {
      method: "PATCH",
      body: JSON.stringify({ patch: { subscriptions: expandedSubscriptions } }),
    }).then((response) => response.json());
    assert.equal(patchedSubscriptions.subscriptions.journal.length, 45);
    assert.equal(patchedSubscriptions.subscriptions.scholar.length, 65);
    assert.equal(patchedSubscriptions.subscriptions.keyword.length, 65);

    const manyStates = Object.fromEntries(
      Array.from({ length: 2105 }, (_, index) => [
        `state-${index}`,
        { saved: index % 2 === 0, read: false, ignored: false },
      ]),
    );
    const patchedStates = await apiFetch("/api/local-data", {
      method: "PATCH",
      body: JSON.stringify({ patch: { states: manyStates } }),
    }).then((response) => response.json());
    assert.equal(Object.keys(patchedStates.states).length, 2105);
    assert.equal(patchedStates.feed.items[0].title, "An Article");

    const patchedTranslations = await apiFetch("/api/local-data", {
      method: "PATCH",
      body: JSON.stringify({
        patch: {
          translations: Object.fromEntries(
            Array.from({ length: 1005 }, (_, index) => [
              `translation-${index}`,
              `译文 ${index}`,
            ]),
          ),
        },
      }),
    }).then((response) => response.json());
    assert.equal(Object.keys(patchedTranslations.translations).length, 1005);
    assert.equal(Object.keys(patchedTranslations.states).length, 2105);
    await apiFetch("/api/local-data", {
      method: "PATCH",
      body: JSON.stringify({ patch: { translations: patchedTranslations.translations } }),
    });
    const primaryDataFile = join(
      root,
      "data",
      "anthropology-canteen-data.json",
    );
    await writeFile(primaryDataFile, "not-json", "utf8");
    const recovered = await apiFetch("/api/local-data").then((response) =>
      response.json(),
    );
    assert.equal(Object.keys(recovered.translations).length, 1005);
    assert.equal(Object.keys(recovered.states).length, 2105);

    const diskData = JSON.parse(
      await readFile(
        primaryDataFile,
        "utf8",
      ),
    );
    assert.equal(diskData.version, 8);
    assert.equal(diskData.feed.items[0].authors[1].name, "Jason Throop");
    assert.ok(diskData.scholarProfiles["openalex:A123"]);

    const riskyV6 = {
      ...saved,
      version: 6,
      subscriptions: {
        ...saved.subscriptions,
        scholar: [
          {
            ...saved.subscriptions.scholar[0],
            label: "cheryl mattingly",
            orcid: "0009-0004-0182-5319",
            openAlexIds: ["A123", "A999"],
            mergedRecordCount: 2,
          },
        ],
      },
    };
    const quarantined = await apiFetch("/api/local-data", {
      method: "PUT",
      body: JSON.stringify(riskyV6),
    }).then((response) => response.json());
    assert.equal(quarantined.version, 8);
    assert.equal(
      quarantined.subscriptions.scholar[0].label,
      "Cheryl Mattingly",
    );
    assert.deepEqual(quarantined.subscriptions.scholar[0].openAlexIds, []);
    assert.deepEqual(
      quarantined.subscriptions.scholar[0].quarantinedOpenAlexIds,
      ["A123", "A999"],
    );
    assert.equal(
      quarantined.subscriptions.scholar[0].identityNeedsReview,
      true,
    );
    assert.equal(quarantined.feed, null);
    assert.deepEqual(quarantined.scholarProfiles, {});
    assert.equal(
      quarantined.states["10.1234/example"].saved,
      true,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousOpenAlexApiKey) {
      process.env.OPENALEX_API_KEY = previousOpenAlexApiKey;
    } else {
      delete process.env.OPENALEX_API_KEY;
    }
    if (previousSemanticScholarApiKey) {
      process.env.SEMANTIC_SCHOLAR_API_KEY =
        previousSemanticScholarApiKey;
    } else {
      delete process.env.SEMANTIC_SCHOLAR_API_KEY;
    }
    await rm(testRoot, { recursive: true, force: true });
  }
});
