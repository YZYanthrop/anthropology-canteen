import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PRESETS = {
  qq: { host: "smtp.qq.com", port: 465, security: "tls" },
  "163": { host: "smtp.163.com", port: 465, security: "tls" },
  "126": { host: "smtp.126.com", port: 465, security: "tls" },
  yeah: { host: "smtp.yeah.net", port: 465, security: "tls" },
  gmail: { host: "smtp.gmail.com", port: 465, security: "tls" },
  icloud: { host: "smtp.mail.me.com", port: 587, security: "starttls" },
};

let nodemailerPromise;

async function loadNodemailer(root) {
  if (!nodemailerPromise) {
    const bundled = resolve(root, "tools", "nodemailer", "lib", "nodemailer.js");
    nodemailerPromise = existsSync(bundled)
      ? import(pathToFileURL(bundled).href)
      : import("nodemailer");
  }
  const loaded = await nodemailerPromise;
  return loaded.default || loaded;
}

export function smtpConfig(config, password) {
  const preset = PRESETS[config.provider];
  const host = preset?.host || config.host;
  const port = preset?.port || config.port;
  const security = preset?.security || config.security;
  if (!host || ![465, 587].includes(port)) {
    throw new Error("SMTP 主机或端口无效；只允许 465 或 587。");
  }
  if ((port === 465 && security !== "tls") || (port === 587 && security !== "starttls")) {
    throw new Error("SMTP 安全模式不匹配：465 必须使用 TLS，587 必须使用 STARTTLS。");
  }
  if (!password) throw new Error("邮箱授权码未配置。");
  if (!config.sender || !config.recipient) {
    throw new Error("请填写有效的发件邮箱和收件邮箱。");
  }
  if ((config.username || config.sender).toLowerCase() !== config.sender.toLowerCase()) {
    throw new Error("发件地址必须与 SMTP 认证邮箱一致。");
  }
  return {
    host,
    port,
    secure: security === "tls",
    requireTLS: security === "starttls",
    auth: { user: config.username || config.sender, pass: password },
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 45_000,
  };
}

export function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shortAbstract(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 400 ? `${text.slice(0, 397)}…` : text;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value || "日期未知"
    : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function safeLink(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function groupItems(items) {
  const groups = new Map();
  for (const item of items) {
    const scholar = item.matches?.find((match) => match.kind === "scholar")?.label;
    const journal = item.matches?.find((match) => match.kind === "journal")?.label || item.venue || "其他来源";
    const kind = scholar ? "scholar" : "journal";
    const label = scholar || journal;
    const key = `${kind}:${label}`;
    if (!groups.has(key)) groups.set(key, { kind, label, items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()].sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "scholar" ? -1 : 1));
}

function renderItemText(item, detailed) {
  const authors = (item.authors || []).join(", ") || "作者未知";
  const reason = (item.matches || []).map((match) => match.label).filter(Boolean).join("；");
  const keywords = (item.matches || []).flatMap((match) => match.terms || []).filter(Boolean);
  const lines = [
    `- ${item.title}`,
    `  作者：${authors}`,
    `  来源：${item.venue || "未知"} · ${formatDate(item.publishedAt)}`,
    reason ? `  收录原因：${reason}` : "",
    keywords.length ? `  关键词：${[...new Set(keywords)].join("、")}` : "",
    safeLink(item.url) ? `  链接：${safeLink(item.url)}` : "",
  ].filter(Boolean);
  if (detailed && item.abstract) lines.push(`  摘要：${shortAbstract(item.abstract)}`);
  return lines.join("\n");
}

export function renderDigest({ items, format = "concise", warnings = [], omitted = 0, test = false }) {
  const detailed = format === "detailed";
  const groups = groupItems(items);
  const scholarCount = groups.filter((group) => group.kind === "scholar").length;
  const title = test
    ? "[Anthropology Canteen] 邮件提醒测试"
    : `[Anthropology Canteen] ${scholarCount ? `${scholarCount} 位学者` : "关注内容"}有 ${items.length} 项新发表`;
  const textSections = groups.map((group) => [
    `${group.kind === "scholar" ? "学者" : "期刊"}：${group.label}`,
    ...group.items.map((item) => renderItemText(item, detailed)),
  ].join("\n"));
  const text = [
    "Anthropology Canteen",
    test ? "这是一封测试邮件，说明邮件提醒配置可以正常发信。" : "以下是本次检查发现的新发表：",
    "",
    ...textSections,
    omitted ? `\n另有 ${omitted} 项更新未在邮件中完整展开，请打开 Anthropology Canteen 查看。` : "",
    warnings.length ? `\n部分数据源暂不可用：${warnings.join("；")}` : "",
  ].filter(Boolean).join("\n\n");

  const htmlGroups = groups.map((group) => `<section><h2>${escapeHtml(group.kind === "scholar" ? "学者" : "期刊")}：${escapeHtml(group.label)}</h2>${group.items.map((item) => {
    const authors = (item.authors || []).join(", ") || "作者未知";
    const reason = (item.matches || []).map((match) => match.label).filter(Boolean).join("；");
    const keywords = [...new Set((item.matches || []).flatMap((match) => match.terms || []).filter(Boolean))];
    const link = safeLink(item.url);
    return `<article><h3>${link ? `<a href="${escapeHtml(link)}">${escapeHtml(item.title)}</a>` : escapeHtml(item.title)}</h3><p>${escapeHtml(authors)}<br>${escapeHtml(item.venue || "未知")} · ${escapeHtml(formatDate(item.publishedAt))}</p>${reason ? `<p>收录原因：${escapeHtml(reason)}</p>` : ""}${keywords.length ? `<p>关键词：${keywords.map((keyword) => `<mark>${escapeHtml(keyword)}</mark>`).join("、")}</p>` : ""}${detailed && item.abstract ? `<p>${escapeHtml(shortAbstract(item.abstract))}</p>` : ""}</article>`;
  }).join("")}</section>`).join("");
  const html = `<!doctype html><html><body style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#28231d;line-height:1.55"><h1>Anthropology Canteen</h1><p>${escapeHtml(test ? "这是一封测试邮件，说明邮件提醒配置可以正常发信。" : `本次发现 ${items.length} 项新发表。`)}</p>${htmlGroups}${omitted ? `<p>另有 ${omitted} 项更新未完整展开，请打开 Anthropology Canteen 查看。</p>` : ""}${warnings.length ? `<p>部分数据源暂不可用：${escapeHtml(warnings.join("；"))}</p>` : ""}</body></html>`;
  return { subject: title, text, html };
}

export async function sendMail({ root, config, password, message }) {
  const nodemailer = await loadNodemailer(root);
  const transport = nodemailer.createTransport(smtpConfig(config, password));
  try {
    await transport.verify();
    return await transport.sendMail({
      from: config.sender,
      to: config.recipient,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: message.messageId ? { "Message-ID": message.messageId } : undefined,
    });
  } catch (error) {
    const raw = String(error?.message || error || "SMTP 发信失败");
    const safe = password ? raw.replaceAll(password, "[已隐藏]") : raw;
    throw new Error(safe.slice(0, 600));
  } finally {
    transport.close();
  }
}

export function providerPresets() {
  return PRESETS;
}
