# Current project snapshot

Last updated: 2026-09-23

This is the lightweight entry point for a new Codex task. Chat history is not
required. Read this file and `docs/work/ACTIVE.md` first, then follow the
document router below.

## Stable product

- Public version and immutable tag: `v1.3.2` at
  `f89936b8e4854928142fb028de869794639fed3d`.
- Targets: Windows x64, macOS arm64, and macOS x64 from one source tag.
- Main local-data schema: version 8.
- Reminder-state schema: version 2.
- Settings schema: version 3.
- User data stays in the extracted package's `data/` directory.
- Optional email reminders are local OS-scheduled jobs; there is no hosted
  account, database, or notification server.

## Non-negotiable product rules

- Scholars first, journals second, keyword families third.
- Keyword families highlight followed scholars' and journals' works; they do
  not create an unrestricted global keyword feed.
- Never merge scholars from a name, institution, topic, or coauthor alone.
- Preserve subscriptions, follow dates, article states, translations, caches,
  reminder ledgers, and settings during compatible migration.
- Never commit or package `data/`, credentials, personal paths, caches, build
  output, or scheduler state.
- Windows and both macOS builds remain one shared product and version.

## Active work

- v1.3.2 已完成实现和三平台发布；原生验证与发布后下载摘要核对通过。
  稳定公开版本仍为 [v1.3.2](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.3.2)。
- v1.3.3 A–D 已在本地合并；Slice D 让自动升级从同一个旧版文件夹
  保留邮件设置、发送记录和 Windows 加密授权码，并区分授权码缺失与无法读取。
  计划见
  [普通中文与左栏可用性](plans/v1.3.3-language-and-sidebar-usability.md)，交接见
  [升级时保留邮件提醒](handoffs/v1.3.3-slice-d.md)。
- Slice E 已在短期分支实现：更新后台提醒时只在 Windows 拒绝普通操作后提升任务小工具，
  保留原登录用户并继续以普通权限运行日常任务；同一身份重复更新不增加任务，来源不明的旧任务
  只提示不删除。lint、构建、57 项离线、26 项界面、12 个 Edge 合成场景和完整 Windows
  v1.3.3 临时包 smoke 均通过；见[计划](plans/v1.3.3-windows-reminder-task-migration.md)
  与[交接](handoffs/v1.3.3-slice-e.md)。
- 实际触摸/混合设备、macOS 浏览器、屏幕阅读器、真实高倍缩放及 macOS 钥匙串迁移
  仍待原生验收。目标版本为 v1.3.3，正式版本号仍待后续冻结；尚未合并、推送、打标签或发布。
- [v1.4.0 路线图](plans/v1.4.0-roadmap.md) 保持 `Proposed`，不与 v1.3.3 并行实施。
- 已发布标签和附件不可改写；本地试用包及候选包不是正式发布文件。

## Read only what the task needs

- Every task: `AGENTS.md`, this file, and `docs/work/ACTIVE.md`.
- Planning: the proposed plan plus only the domain document needed to judge it.
- App behavior, persistence, providers, or data migration:
  `docs/ARCHITECTURE.md`.
- Launchers, packaging, OS integration, or platform support:
  `docs/PLATFORMS.md`.
- Versioning, tags, CI artifacts, or publication: `docs/RELEASING.md`,
  `docs/PROJECT_STATE.md`, and the relevant `CHANGELOG.md` section.
- Day-to-day task mechanics and ready-to-copy prompts: `docs/WORKFLOW.md`.

Historical release detail remains in the longer project documents, but a new
implementation task must not read old conversations or all historical sections
unless the current work actually depends on them.
