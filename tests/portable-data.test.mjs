import assert from "node:assert/strict";
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
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
    join(tmpdir(), "anthropology-canteen-v7-test-"),
  );
  const root = join(testRoot, "Anthropology-Canteen-v1.1.1");
  await mkdir(root);
  await cp(new URL("../dist", import.meta.url), join(root, "dist"), {
    recursive: true,
  });
  await copyFile(
    new URL("../portable-server.mjs", import.meta.url),
    join(root, "portable-server.mjs"),
  );
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
    const blank = await fetch(`${baseUrl}/api/local-data`).then((response) =>
      response.json(),
    );
    assert.equal(blank.version, 7);
    assert.deepEqual(blank.subscriptions.scholar, []);

    const blankSettings = await fetch(
      `${baseUrl}/api/local-settings`,
    ).then((response) => response.json());
    assert.equal(blankSettings.openAlexConfigured, false);
    assert.equal(blankSettings.semanticScholarConfigured, false);
    assert.equal("openAlexApiKey" in blankSettings, false);
    assert.equal("semanticScholarApiKey" in blankSettings, false);

    const savedSettings = await fetch(`${baseUrl}/api/local-settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
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
    const savedResponse = await fetch(`${baseUrl}/api/local-data`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(legacy),
    });
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json();
    assert.equal(saved.version, 7);
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

    const diskData = JSON.parse(
      await readFile(
        join(root, "data", "anthropology-canteen-data.json"),
        "utf8",
      ),
    );
    assert.equal(diskData.version, 7);
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
    const quarantined = await fetch(`${baseUrl}/api/local-data`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(riskyV6),
    }).then((response) => response.json());
    assert.equal(quarantined.version, 7);
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
