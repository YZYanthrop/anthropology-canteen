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
  const testRoot = await mkdtemp(
    join(tmpdir(), "anthropology-canteen-v3-test-"),
  );
  const root = join(testRoot, "Anthropology-Canteen-v1.0.1");
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
    assert.equal(blank.version, 3);
    assert.deepEqual(blank.subscriptions.scholar, []);

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
    };
    const savedResponse = await fetch(`${baseUrl}/api/local-data`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(legacy),
    });
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json();
    assert.equal(saved.version, 3);
    assert.equal(saved.subscriptions.journal[0].label, "Ethos");
    assert.equal(saved.subscriptions.scholar[0].openAlexIds[0], "A123");
    assert.match(saved.subscriptions.scholar[0].subscriptionId, /^openalex:/);
    assert.equal(saved.feed.items[0].authors[0].name, "Cheryl Mattingly");
    assert.equal(saved.states["10.1234/example"].saved, true);
    assert.equal(
      saved.translations["10.1234/example"],
      "已保存的中文摘要",
    );

    const diskData = JSON.parse(
      await readFile(
        join(root, "data", "anthropology-canteen-data.json"),
        "utf8",
      ),
    );
    assert.equal(diskData.version, 3);
    assert.equal(diskData.feed.items[0].authors[1].name, "Jason Throop");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(testRoot, { recursive: true, force: true });
  }
});
