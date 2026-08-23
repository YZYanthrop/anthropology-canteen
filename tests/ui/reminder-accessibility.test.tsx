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
  tested: true,
  scheduler: {
    installed: true,
    stalePath: "C:\\Old Anthropology Canteen",
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
          message: "Windows 拒绝注册计划任务。请关闭所有 Anthropology Canteen 页面，等待约 10 秒，然后右键 start-local.cmd，选择‘以管理员身份运行’，再重新开启提醒。管理员权限仅用于首次注册或更新后的迁移，日常运行不需要。",
        }, 500);
      }
      status = {
        ...status,
        config: { ...status.config, enabled: true },
        scheduler: { ...status.scheduler, installed: true, stalePath: "" },
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
    expect(within(dialog).getByRole("button", { name: "迁移到当前文件夹" })).toBeDisabled();

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

  test("scheduler permission failure stays visibly disabled and shows the safe administrator hint", async () => {
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
    expect(alert).toHaveTextContent("右键 start-local.cmd");
    expect(alert).toHaveTextContent("日常运行不需要");
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
