import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import Home from "../../app/page";

const emptyLocalData = {
  version: 8,
  revision: 0,
  subscriptions: { journal: [], scholar: [], keyword: [] },
  states: {},
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
};

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}

describe("home page test harness", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/runtime-status") {
          return jsonResponse({ sessionToken: "test-session" });
        }
        if (url === "/api/local-data") return jsonResponse(emptyLocalData);
        if (url === "/api/local-settings") {
          return jsonResponse({
            version: 3,
            openAlexConfigured: false,
            semanticScholarConfigured: false,
          });
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
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("renders the main application shell from deterministic local data", async () => {
    render(<Home />);

    expect(
      await screen.findByRole("heading", { name: "学者动态" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "信息流筛选" })).toBeVisible();
    expect(screen.getByRole("button", { name: "搜索并添加学者" })).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(
      "/api/local-data",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
