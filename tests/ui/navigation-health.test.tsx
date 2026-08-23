import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import Home from "../../app/page";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const scholars = [
  {
    subscriptionId: "openalex:A1",
    label: "Test Scholar",
    openAlexIds: ["A1"],
    semanticScholarIds: [],
    institution: "Test University",
    followedAt: "2026-08-01T00:00:00.000Z",
    trackingStatus: "verified",
  },
  {
    subscriptionId: "openalex:B1",
    label: "Second Scholar",
    openAlexIds: ["B1"],
    semanticScholarIds: [],
    institution: "Second University",
    followedAt: "2026-08-01T00:00:00.000Z",
    trackingStatus: "verified",
  },
];

function article(
  id: string,
  scholar = scholars[0],
  publishedAt = "2026-08-20",
) {
  return {
    id,
    title: `Article ${id}`,
    authors: [{ name: scholar.label }],
    venue: "Test Journal",
    publishedAt,
    publishedPrecision: "day",
    type: "期刊论文",
    url: `https://example.test/${id}`,
    matches: [{
      kind: "scholar",
      label: scholar.label,
      subscriptionId: scholar.subscriptionId,
    }],
  };
}

function createLocalData(overrides: Record<string, unknown> = {}) {
  return {
    version: 8,
    revision: 0,
    subscriptions: { journal: [], scholar: scholars, keyword: [] },
    states: {},
    articleArchive: {},
    feed: {
      items: [
        article("new-a"),
        article("old-a", scholars[0], "2026-07-20"),
        article("new-b", scholars[1]),
      ],
      updatedAt: new Date().toISOString(),
      source: "live",
      scholars,
      warnings: [],
      coverage: [],
    },
    translations: {},
    scholarProfiles: {},
    ...overrides,
  };
}

function installApi(
  initialData: Record<string, unknown>,
  options: {
    refresh?: () => Response;
  } = {},
) {
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
    if (url.startsWith("/api/scholar-profile?")) {
      return jsonResponse({
        candidate: scholars[0],
        works: [{
          id: "new-a",
          title: "Article new-a",
          year: 2026,
          venue: "Test Journal",
          url: "https://example.test/new-a",
        }],
      });
    }
    if (url === "/api/feed?refresh=1" && options.refresh) {
      return options.refresh();
    }
    throw new Error(`Unexpected fetch in UI test: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, getLocalData: () => localData };
}

describe("Slice B navigation and update health", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  test("scholar cards expose scoped new counts and batch read actions", async () => {
    const user = userEvent.setup();
    const api = installApi(createLocalData({
      states: {
        "new-b": { saved: false, read: false, ignored: false },
      },
    }));
    render(<Home />);

    const viewButton = await screen.findByRole("button", {
      name: "查看 Test Scholar 的全部发表",
    });
    const card = viewButton.closest("article");
    expect(card).not.toHaveAttribute("role");
    expect(card).not.toHaveAttribute("tabindex");
    expect(within(card!).getByText("1 篇关注后未读新文章")).toBeVisible();

    await user.click(screen.getByRole("button", {
      name: "将 Test Scholar 的 1 篇新文章全部标为已读",
    }));

    await waitFor(() =>
      expect(within(card!).getByText("暂无关注后未读新文章")).toBeVisible(),
    );
    expect(api.getLocalData().states).toMatchObject({
      "new-a": { read: true },
      "new-b": { saved: false, read: false, ignored: false },
    });
    expect(api.getLocalData().states).not.toHaveProperty("old-a");
  });

  test("the detail return control and logo share a complete overview reset", async () => {
    const user = userEvent.setup();
    installApi(createLocalData());
    render(<Home />);
    const search = await screen.findByRole("textbox", { name: "搜索文章" });

    await user.type(search, "Test Scholar");
    await user.click(screen.getByRole("button", {
      name: "查看 Test Scholar 的全部发表",
    }));
    await screen.findByRole("button", { name: "← 返回学者动态" });
    await user.click(screen.getByRole("button", { name: "← 返回学者动态" }));
    expect(screen.getByRole("heading", { name: "学者动态" })).toBeVisible();
    expect(search).toHaveValue("");
    expect(screen.getByRole("button", {
      name: "查看 Test Scholar 的全部发表",
    })).toBeVisible();

    await user.type(search, "Test Scholar");
    await user.click(screen.getByRole("button", {
      name: "查看 Test Scholar 的全部发表",
    }));
    await screen.findByRole("button", { name: "← 返回学者动态" });
    await user.click(document.querySelector<HTMLButtonElement>(".brand")!);
    expect(screen.getByRole("heading", { name: "学者动态" })).toBeVisible();
    expect(search).toHaveValue("");
  });

  test("all-provider failure preserves the saved feed and successful timestamp", async () => {
    const user = userEvent.setup();
    const successfulAt = new Date().toISOString();
    const initial = createLocalData({
      feed: {
        items: [article("cached")],
        updatedAt: successfulAt,
        source: "live",
        scholars,
        warnings: [],
        coverage: [
          {
            kind: "scholar",
            subscriptionId: "openalex:A1",
            label: "Test Scholar",
            status: "success",
            providers: [{ provider: "openalex", status: "success" }],
          },
          {
            kind: "journal",
            subscriptionId: "0091-2131",
            label: "Ethos",
            status: "partial",
            providers: [
              { provider: "openalex", status: "success" },
              { provider: "crossref", status: "failed" },
            ],
          },
          {
            kind: "scholar",
            subscriptionId: "semantic:S1",
            label: "Failed Scholar",
            status: "failed",
            providers: [{ provider: "semanticScholar", status: "failed" }],
          },
        ],
      },
    });
    const api = installApi(initial, {
      refresh: () => jsonResponse({
        items: [],
        updatedAt: "2099-01-01T00:00:00.000Z",
        source: "fallback",
        scholars,
        warnings: ["1 个关注项的数据来源未完整返回。"],
        coverage: [{
          kind: "journal",
          subscriptionId: "0091-2131",
          label: "Ethos",
          status: "failed",
          providers: [
            { provider: "openalex", status: "failed" },
            { provider: "crossref", status: "failed" },
          ],
        }],
      }, 503),
    });
    render(<Home />);

    const health = await screen.findByRole("region", { name: "更新健康摘要" });
    expect(within(health).getByText(/订阅：1 成功 · 1 部分失败 · 1 失败/)).toBeVisible();
    expect(within(health).getByText(/失败来源：Crossref、Semantic Scholar/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "检查更新" }));
    await waitFor(() =>
      expect(screen.getByText("暂时无法更新，正在显示上次保存的内容。")).toBeVisible(),
    );
    expect(within(health).getByText(/订阅：0 成功 · 0 部分失败 · 1 失败/)).toBeVisible();
    expect(within(health).getByText(/失败来源：OpenAlex、Crossref/)).toBeVisible();
    expect(api.getLocalData().feed).toMatchObject({
      updatedAt: successfulAt,
      items: [{ id: "cached" }],
    });
    expect(screen.queryByText("已检查最新出版记录")).toBeNull();
  });
});
