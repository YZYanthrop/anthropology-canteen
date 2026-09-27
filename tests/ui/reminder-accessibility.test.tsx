import { readFileSync } from "node:fs";

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

const savedReminderStatus = {
  version: 1,
  platform: "win32",
  sessionToken: "test-session",
  config: {
    enabled: true,
    provider: "qq",
    sender: "saved@qq.com",
    recipient: "reader@example.com",
    host: "smtp.qq.com",
    port: 465,
    security: "tls",
    username: "saved@qq.com",
    format: "concise",
    schedule: {
      cadence: "daily",
      time: "08:00",
      weekday: 1,
      monthDay: 1,
    },
  },
  credentialConfigured: true,
  credentialStatus: "configured" as const,
  tested: true,
  scheduler: {
    installed: true,
    needsMigration: false,
    status: "current" as "current" | "recovery-required",
    stalePath: "C:\\Old Anthropology Canteen",
    ambiguousTaskCount: 0,
    ambiguousTaskIds: [] as string[],
  },
  reminderMigration: undefined as undefined | {
    outcome: "restored" | "manual-import-required";
    reason?: string;
  },
  state: {},
};

function article() {
  return {
    id: "article-1",
    title: "A semantic match label",
    authors: [{ name: "Test Author" }],
    venue: "Test Journal",
    publishedAt: "2026-08-20",
    publishedPrecision: "day",
    type: "期刊论文",
    url: "https://example.test/article-1",
    matches: [{ kind: "journal", label: "Test Journal" }],
  };
}

function localData(withArticle = false) {
  return {
    version: 8,
    revision: 0,
    subscriptions: {
      journal: withArticle
        ? [{
            label: "Test Journal",
            issn: "1111-2222",
            followedAt: "2026-08-01T00:00:00.000Z",
          }]
        : [],
      scholar: [],
      keyword: [],
    },
    states: {},
    articleArchive: {},
    feed: {
      items: withArticle ? [article()] : [],
      updatedAt: new Date().toISOString(),
      source: "live",
      scholars: [],
      warnings: [],
      coverage: [],
    },
    translations: {},
    scholarProfiles: {},
  };
}

function installApi(options: {
  reminderStatus?: typeof savedReminderStatus;
  failTest?: boolean;
  failEnable?: boolean;
  failEnableMessage?: string;
  withArticle?: boolean;
} = {}) {
  let status = structuredClone(options.reminderStatus || savedReminderStatus);
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/runtime-status") {
      return jsonResponse({ sessionToken: "test-session" });
    }
    if (url === "/api/local-data") {
      return jsonResponse(localData(options.withArticle));
    }
    if (url === "/api/local-settings") {
      return jsonResponse({ version: 3, openAlexConfigured: false });
    }
    if (url === "/api/reminders/status") return jsonResponse(status);
    if (url === "/api/reminders/config" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body || "{}"));
      status = {
        ...status,
        config: {
          ...body,
          enabled: status.config.enabled,
        },
        tested: false,
      };
      return jsonResponse(status);
    }
    if (url === "/api/reminders/test" && init?.method === "POST") {
      if (options.failTest) {
        return jsonResponse({ message: "测试邮箱暂时不可用" }, 503);
      }
      status = { ...status, tested: true };
      return jsonResponse(status);
    }
    if (url === "/api/reminders/enable" && init?.method === "POST") {
      if (options.failEnable) {
        return jsonResponse({
          message: options.failEnableMessage || "Windows 没有允许更新后台提醒任务。请重试并确认一次 Windows 权限提示；只提升任务小工具，应用和日常提醒仍以普通权限运行。",
        }, 500);
      }
      status = {
        ...status,
        config: { ...status.config, enabled: true },
        scheduler: { ...status.scheduler, installed: true, needsMigration: false, status: "current", stalePath: "" },
      };
      return jsonResponse(status);
    }
    throw new Error(`Unexpected fetch in Slice C UI test: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, getStatus: () => status };
}

describe("Slice C reminder state, accessibility, and narrow layout", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  test("dirty reminder edits are not presented as saved, tested, or active", async () => {
    const user = userEvent.setup();
    installApi();
    render(<Home />);

    const opener = await screen.findByRole("button", { name: "邮件提醒已开" });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "邮件提醒设置" });
    const provider = within(dialog).getByRole("combobox", {
      name: "小号邮箱类型",
    });
    await waitFor(() => expect(provider).toHaveFocus());
    expect(within(dialog).getByText("已保存")).toBeVisible();
    expect(within(dialog).getByText("测试成功")).toBeVisible();
    expect(within(dialog).getByText("运行中")).toBeVisible();

    const recipient = within(dialog).getByRole("textbox", {
      name: "收件邮箱（常用邮箱）",
    });
    await user.clear(recipient);
    await user.type(recipient, "edited@example.com");

    expect(within(dialog).getByText("未保存")).toBeVisible();
    expect(within(dialog).getByText("当前修改待重测")).toBeVisible();
    expect(within(dialog).getByText("旧配置运行中")).toBeVisible();
    expect(within(dialog).getByText(/后台提醒仍按已保存配置运行/)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "发送测试邮件" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "更新后台提醒到当前文件夹" })).toBeDisabled();

    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    await user.keyboard("{Escape}");
    expect(confirm).toHaveBeenCalledWith("放弃尚未保存或测试的邮件提醒修改？");
    expect(dialog).toBeVisible();

    confirm.mockReturnValueOnce(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());

    await user.click(opener);
    expect(await screen.findByRole("textbox", {
      name: "收件邮箱（常用邮箱）",
    })).toHaveValue("reader@example.com");
    const secret = screen.getByLabelText("授权码／应用专用密码");
    await user.type(secret, "pending-credential");
    expect(screen.getByText("新授权码尚未保存")).toBeVisible();
    expect(screen.getByRole("button", { name: "发送测试邮件" })).toBeDisabled();
    confirm.mockReturnValueOnce(true);
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", {
        name: "邮件提醒设置",
      })).not.toBeInTheDocument(),
    );
  });

  test("scheduler permission failure stays visibly disabled and explains the one-time helper prompt", async () => {
    const user = userEvent.setup();
    const inactiveStatus = structuredClone(savedReminderStatus);
    inactiveStatus.config.enabled = false;
    inactiveStatus.scheduler.installed = false;
    inactiveStatus.scheduler.stalePath = "";
    installApi({ reminderStatus: inactiveStatus, failEnable: true });
    render(<Home />);

    const opener = await screen.findByRole("button", { name: "邮件提醒" });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "邮件提醒设置" });
    expect(within(dialog).queryByText("后台提醒已开启")).not.toBeInTheDocument();
    expect(within(dialog).getByText("开启提醒").closest("li")).not.toHaveClass("is-complete");

    await user.click(within(dialog).getByRole("button", {
      name: "开启自动邮件提醒",
    }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("确认一次 Windows 权限提示");
    expect(alert).toHaveTextContent("日常提醒仍以普通权限运行");
    expect(alert).not.toHaveTextContent(/Access is denied|PermissionDenied|0x80070005|C:\\Users/i);
    expect(within(dialog).queryByText("后台提醒已开启")).not.toBeInTheDocument();
    expect(opener).toHaveAccessibleName("邮件提醒");
  });

  test("add and reminder dialogs trap focus, close on Escape, and return focus", async () => {
    const user = userEvent.setup();
    installApi();
    render(<Home />);

    const addTrigger = await screen.findByRole("button", {
      name: "搜索并添加学者",
    });
    await user.click(addTrigger);
    const addDialog = await screen.findByRole("dialog", { name: "添加关注" });
    const addSearch = within(addDialog).getByPlaceholderText(
      "接受中文和拼音，但尽量使用英文",
    );
    await waitFor(() => expect(addSearch).toHaveFocus());

    const focusable = [...addDialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )];
    focusable.at(-1)?.focus();
    await user.tab();
    expect(focusable[0]).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(addDialog).not.toBeInTheDocument());
    await waitFor(() => expect(addTrigger).toHaveFocus());

    const reminderTrigger = screen.getByRole("button", { name: "邮件提醒已开" });
    await user.click(reminderTrigger);
    const reminderDialog = await screen.findByRole("dialog", {
      name: "邮件提醒设置",
    });
    await waitFor(() =>
      expect(within(reminderDialog).getByRole("combobox", {
        name: "小号邮箱类型",
      })).toHaveFocus(),
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(reminderDialog).not.toBeInTheDocument());
    await waitFor(() => expect(reminderTrigger).toHaveFocus());
  });

  test("successful notices are polite and reminder failures are alerts", async () => {
    const user = userEvent.setup();
    installApi({ failTest: true });
    render(<Home />);

    await user.click(await screen.findByRole("button", { name: "邮件提醒已开" }));
    const recipient = await screen.findByRole("textbox", {
      name: "收件邮箱（常用邮箱）",
    });
    await user.clear(recipient);
    await user.type(recipient, "new@example.com");
    await user.click(screen.getByRole("button", { name: "保存第 1 步" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "邮件提醒配置已保存到当前文件夹",
    );

    const testButton = screen.getByRole("button", { name: "发送测试邮件" });
    await waitFor(() => expect(testButton).toBeEnabled());
    await user.click(testButton);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "测试邮箱暂时不可用",
    );
  });

  test("restored, missing, unreadable, and ambiguous reminder migration states use clear guidance", async () => {
    const restored = structuredClone(savedReminderStatus);
    restored.reminderMigration = { outcome: "restored" };
    installApi({ reminderStatus: restored });
    const first = render(<Home />);
    expect(await screen.findByRole("status")).toHaveTextContent("邮件设置和授权码已保留");
    first.unmount();
    vi.unstubAllGlobals();

    const unreadable = structuredClone(savedReminderStatus);
    unreadable.config.enabled = false;
    unreadable.scheduler.installed = false;
    unreadable.scheduler.stalePath = "";
    unreadable.credentialConfigured = false;
    unreadable.credentialStatus = "unreadable";
    unreadable.tested = false;
    installApi({ reminderStatus: unreadable });
    const second = render(<Home />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "邮件提醒" }));
    const dialog = await screen.findByRole("dialog", { name: "邮件提醒设置" });
    expect(within(dialog).getByText("已找到，但当前账户无法读取")).toBeVisible();
    expect(within(dialog).getByText(/原文件仍保留/)).toBeVisible();
    expect(within(dialog).queryByText(/重新申请/)).not.toBeInTheDocument();
    second.unmount();
    vi.unstubAllGlobals();

    const missing = structuredClone(savedReminderStatus);
    missing.config.enabled = false;
    missing.scheduler.installed = false;
    missing.scheduler.stalePath = "";
    missing.credentialConfigured = false;
    missing.credentialStatus = "missing";
    missing.tested = false;
    missing.reminderMigration = {
      outcome: "manual-import-required",
      reason: "credential-missing",
    };
    installApi({ reminderStatus: missing });
    const third = render(<Home />);
    await user.click(await screen.findByRole("button", { name: "邮件提醒" }));
    const missingDialog = await screen.findByRole("dialog", { name: "邮件提醒设置" });
    expect(within(missingDialog).getByText("未找到原授权码")).toBeVisible();
    expect(within(missingDialog).getByText(/重新填写已有授权码/)).toBeVisible();
    expect(within(missingDialog).queryByText(/重新申请/)).not.toBeInTheDocument();
    third.unmount();
    vi.unstubAllGlobals();

    const ambiguous = structuredClone(savedReminderStatus);
    ambiguous.reminderMigration = {
      outcome: "manual-import-required",
      reason: "ambiguous-source",
    };
    installApi({ reminderStatus: ambiguous });
    render(<Home />);
    expect(await screen.findByRole("alert")).toHaveTextContent("从旧版本导入数据");
  });

  test("preserved settings with an old background task reuse the migration action", async () => {
    const user = userEvent.setup();
    const needsMigration = structuredClone(savedReminderStatus);
    needsMigration.config.enabled = true;
    needsMigration.scheduler.installed = false;
    needsMigration.scheduler.needsMigration = true;
    needsMigration.scheduler.stalePath = "";
    const { fetchMock } = installApi({ reminderStatus: needsMigration });
    render(<Home />);

    await user.click(await screen.findByRole("button", { name: "邮件提醒" }));
    const dialog = await screen.findByRole("dialog", { name: "邮件提醒设置" });
    expect(within(dialog).getByText(/设置已保留。更新时 Windows 可能要求确认一次权限/)).toBeVisible();
    const migrate = within(dialog).getByRole("button", { name: "更新后台提醒到当前文件夹" });
    expect(migrate).toBeEnabled();
    await user.click(migrate);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reminders/enable",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ operation: "update" }) }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("后台提醒已更新到当前文件夹");
  });

  test("ambiguous old Windows tasks are reported without a delete action", async () => {
    const user = userEvent.setup();
    const ambiguous = structuredClone(savedReminderStatus);
    ambiguous.scheduler.ambiguousTaskCount = 2;
    ambiguous.scheduler.ambiguousTaskIds = ["old-task-a", "old-task-b"];
    installApi({ reminderStatus: ambiguous });
    render(<Home />);

    await user.click(await screen.findByRole("button", { name: "邮件提醒已开" }));
    const dialog = await screen.findByRole("dialog", { name: "邮件提醒设置" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("程序没有删除");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("old-task-a、old-task-b");
    expect(within(dialog).queryByRole("button", { name: /删除.*旧后台任务/ })).not.toBeInTheDocument();
  });

  test("cancelling the Windows permission prompt does not claim that restoration succeeded", async () => {
    const user = userEvent.setup();
    const needsMigration = structuredClone(savedReminderStatus);
    needsMigration.config.enabled = true;
    needsMigration.scheduler.installed = false;
    needsMigration.scheduler.needsMigration = true;
    needsMigration.scheduler.stalePath = "";
    installApi({
      reminderStatus: needsMigration,
      failEnable: true,
      failEnableMessage: "你已取消 Windows 权限确认，后台提醒更新未完成。",
    });
    render(<Home />);

    await user.click(await screen.findByRole("button", { name: "邮件提醒" }));
    await user.click(await screen.findByRole("button", { name: "更新后台提醒到当前文件夹" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("你已取消 Windows 权限确认");
    expect(screen.getByRole("alert")).not.toHaveTextContent(/没有更改|已恢复/);
  });

  test("incomplete update recovery prevents a blind retry and remains visibly inactive", async () => {
    const user = userEvent.setup();
    const failed = structuredClone(savedReminderStatus);
    failed.scheduler.installed = false;
    failed.scheduler.needsMigration = true;
    failed.scheduler.status = "recovery-required";
    failed.scheduler.stalePath = "";
    const { fetchMock } = installApi({ reminderStatus: failed });
    render(<Home />);
    await user.click(await screen.findByRole("button", { name: "邮件提醒" }));
    const dialog = await screen.findByRole("dialog", { name: "邮件提醒设置" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("恢复未完成");
    expect(within(dialog).queryByText("后台提醒已开启")).not.toBeInTheDocument();
    const retry = within(dialog).getByRole("button", { name: "更新后台提醒到当前文件夹" });
    expect(retry).toBeDisabled();
    await user.click(retry);
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/reminders/enable")).toBe(false);
  });

  test.each(["write-failed", "recovery-incomplete", "cleanup-failed"])("migration %s does not claim complete restoration", async (reason) => {
    const user = userEvent.setup();
    const status = structuredClone(savedReminderStatus);
    status.reminderMigration = { outcome: "manual-import-required", reason };
    installApi({ reminderStatus: status });
    render(<Home />);
    await user.click(await screen.findByRole("button", { name: "邮件提醒已开" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent("当前资料已恢复");
  });

  test("match labels are semantic text and narrow search remains a full row", async () => {
    const user = userEvent.setup();
    installApi({ withArticle: true });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 800,
    });
    render(<Home />);

    const search = await screen.findByRole("textbox", { name: "搜索文章" });
    expect(search.closest("label")).toHaveClass("search");
    await user.click(screen.getByRole("button", { name: "期刊更新" }));
    const matchLabel = await screen.findByText("Test Journal", {
      selector: ".match-chip",
    });
    expect(matchLabel.tagName).toBe("SPAN");
    expect(matchLabel.closest(".match-row")?.querySelector("button")).toBeNull();

    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.search \{[\s\S]*?width: 100%;[\s\S]*?display: flex;[\s\S]*?grid-row: 2;[\s\S]*?grid-column: 1 \/ -1;/,
    );
    expect(css).not.toMatch(
      /font-size:\s*(?:8(?:\.5)?|9(?:\.5)?|10(?:\.5)?)px/,
    );
    expect(css).toContain(".app-shell.app-shell label > span");
    expect(css).toContain("font-size: 12px;");
  });
});
