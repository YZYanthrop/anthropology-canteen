import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import Home from "../../app/page";
import { browserFixture } from "../browser/fixture.mjs";

function installApi(initial = browserFixture()) {
  let data = structuredClone(initial);
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push(url);
    let value: unknown;
    if (url === "/api/runtime-status") value = { sessionToken: "test-session" };
    else if (url === "/api/local-data") {
      if (init?.method === "PATCH") data = { ...data, ...JSON.parse(String(init.body)).patch, revision: data.revision + 1 };
      value = data;
    } else if (url === "/api/local-settings") value = { version: 3, openAlexConfigured: false };
    else if (url === "/api/reminders/status") value = { config: { enabled: false } };
    else if (url === "/api/feed") value = { ...data.feed, scholars: JSON.parse(String(init?.body)).subscriptions.scholar };
    else throw new Error(`Unexpected API ${url}`);
    return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  }));
  return { data: () => data, requests };
}

afterEach(() => vi.unstubAllGlobals());

test("100 follows: cancel only the selected stable identity, keep state and move focus", async () => {
  const initial = browserFixture();
  initial.subscriptions.scholar[1].label = initial.subscriptions.scholar[0].label;
  initial.subscriptions.scholar[0].institution = "独立机构甲";
  initial.subscriptions.scholar[1].institution = "独立机构乙";
  const api = installApi(initial);
  const user = userEvent.setup();
  render(<Home />);
  const sidebar = screen.getByRole("complementary", { name: "关注与筛选" });
  const duplicateButtons = await within(sidebar).findAllByRole("button", { name: `取消关注 ${initial.subscriptions.scholar[0].label}` });
  expect(sidebar.querySelectorAll(".subscription-name")).toHaveLength(100);
  expect(screen.getByText("独立机构甲")).toBeVisible();
  expect(screen.getByText("独立机构乙")).toBeVisible();
  await user.click(duplicateButtons[0]);
  await waitFor(() => expect(api.data().subscriptions.scholar).toHaveLength(59));
  expect(api.data().subscriptions.scholar[0].subscriptionId).toBe("openalex:A2");
  expect(sidebar.querySelector(".subscription-name")).toHaveFocus();
  const nextName = initial.subscriptions.scholar[30].label;
  await user.click(within(sidebar).getByRole("button", { name: `取消关注 ${initial.subscriptions.scholar[29].label}` }));
  expect(within(sidebar).getByRole("button", { name: nextName, exact: true })).toHaveFocus();
  await user.click(sidebar.querySelector<HTMLButtonElement>(".subscription-group:last-child li:last-child .subscription-remove")!);
  expect(document.activeElement).toHaveTextContent("测试关键词 19");
  await waitFor(() => expect(api.data().subscriptions.keyword).toHaveLength(19));
  expect(api.data().states).toEqual(initial.states);
  expect(api.data().translations).toEqual(initial.translations);
  expect(api.data().subscriptions.scholar[0].followedAt).toBe(initial.subscriptions.scholar[1].followedAt);
  expect(api.requests.some((url) => url.startsWith("/api/scholar-profile"))).toBe(false);
});

test("cancel the only item returns keyboard focus to its group summary", async () => {
  const initial = browserFixture();
  initial.subscriptions = { scholar: [], journal: initial.subscriptions.journal.slice(0, 1), keyword: [] };
  initial.feed.scholars = [];
  const api = installApi(initial);
  const user = userEvent.setup();
  render(<Home />);
  const cancel = await screen.findByRole("button", { name: "取消关注 测试期刊 1", exact: true });
  const summary = cancel.closest("details")!.querySelector("summary");
  cancel.focus();
  await user.keyboard("{Enter}");
  expect(summary).toHaveFocus();
  await waitFor(() => expect(api.data().subscriptions.journal).toHaveLength(0));
  expect(api.data().states).toEqual(initial.states);
});
