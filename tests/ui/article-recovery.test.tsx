import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import Home from "../../app/page";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}

function createArticle(id = "article-1") {
  return {
    id,
    title: "A recoverable article",
    authors: [{ name: "Test Scholar" }],
    venue: "Test Journal",
    publishedAt: "2026-08-20",
    publishedPrecision: "day",
    type: "期刊论文",
    url: `https://example.test/${id}`,
    matches: [{ kind: "journal", label: "Test Journal" }],
  };
}

function installApi(initialData: Record<string, unknown>) {
  let localData = structuredClone(initialData);
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/runtime-status") {
      return jsonResponse({ sessionToken: "test-session" });
    }
    if (url === "/api/local-data") {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body || "{}"));
        localData = {
          ...localData,
          ...(body.patch || {}),
          revision: Number(localData.revision || 0) + 1,
        };
      }
      return jsonResponse(localData);
    }
    if (url === "/api/local-settings") {
      return jsonResponse({ version: 3, openAlexConfigured: false });
    }
    if (url === "/api/reminders/status") {
      return jsonResponse({
        version: 1,
        sessionToken: "test-session",
        config: { enabled: false },
        credentialConfigured: false,
        tested: false,
      });
    }
    throw new Error(`Unexpected fetch in UI test: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, getLocalData: () => localData };
}

function localData(overrides: Record<string, unknown> = {}) {
  return {
    version: 8,
    revision: 0,
    subscriptions: { journal: [], scholar: [], keyword: [] },
    states: {},
    articleArchive: {},
    feed: {
      items: [],
      updatedAt: new Date().toISOString(),
      source: "live",
      scholars: [],
      warnings: [],
      coverage: [],
    },
    translations: {},
    scholarProfiles: {},
    ...overrides,
  };
}

describe("article recovery", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  test("shows an orphan ignored state and clears only ignored when restored", async () => {
    const user = userEvent.setup();
    const api = installApi(localData({
      states: {
        orphan: { saved: true, read: true, ignored: true },
      },
    }));
    render(<Home />);

    await user.click(await screen.findByRole("button", { name: /已忽略/ }));
    expect(screen.getByText("文章信息已不在本地缓存中")).toBeVisible();
    expect(screen.getByText("orphan")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "恢复文章状态" }));

    await user.click(screen.getByRole("button", { name: /已收藏/ }));
    expect(screen.getByText("文章信息已不在本地缓存中")).toBeVisible();
    expect(api.getLocalData().states).toEqual({
      orphan: { saved: true, read: true, ignored: false },
    });
  });

  test("archives an ignored article and offers immediate undo", async () => {
    const user = userEvent.setup();
    const article = createArticle();
    const api = installApi(localData({
      subscriptions: {
        journal: [{
          label: "Test Journal",
          issn: "0000-0000",
          followedAt: "2026-08-01T00:00:00.000Z",
        }],
        scholar: [],
        keyword: [],
      },
      feed: {
        items: [article],
        updatedAt: new Date().toISOString(),
        source: "live",
        scholars: [],
        warnings: [],
        coverage: [],
      },
      states: {
        [article.id]: { saved: true, read: true, ignored: false },
      },
      translations: { [article.id]: "已保存的译文" },
    }));
    render(<Home />);

    await user.click(await screen.findByRole("button", { name: "期刊更新" }));
    expect(screen.getByRole("heading", { name: article.title })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "× 忽略" }));
    expect(screen.queryByRole("heading", { name: article.title })).toBeNull();
    expect(api.getLocalData().articleArchive).toMatchObject({
      [article.id]: { title: article.title },
    });

    await user.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: article.title })).toBeVisible(),
    );
    expect(api.getLocalData().states).toMatchObject({
      [article.id]: { saved: true, read: true, ignored: false },
    });
    expect(api.getLocalData().translations).toEqual({
      [article.id]: "已保存的译文",
    });
    expect(api.getLocalData().articleArchive).toMatchObject({
      [article.id]: { title: article.title },
    });
  });

  test("restores an archived ignored article after the feed cache no longer has it", async () => {
    const user = userEvent.setup();
    const article = createArticle("archived");
    installApi(localData({
      states: {
        [article.id]: { saved: true, read: false, ignored: true },
      },
      articleArchive: { [article.id]: article },
    }));
    render(<Home />);

    await user.click(await screen.findByRole("button", { name: /已忽略/ }));
    expect(screen.getByRole("heading", { name: article.title })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "↶ 恢复" }));
    await user.click(screen.getByRole("button", { name: /已收藏/ }));
    expect(screen.getByRole("heading", { name: article.title })).toBeVisible();
  });
});
