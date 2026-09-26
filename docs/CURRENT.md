# Current project snapshot

Last updated: 2026-09-26

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
- v1.3.3 A–E 已纳入同一发布候选；版本号和发布日期已冻结。Slice D 保留升级时的邮件资料；
  Slice E 让 Windows 后台提醒任务更新在必要时只提升任务小工具，不增加同一身份的任务。
  实施证据见[升级提醒交接](handoffs/v1.3.3-slice-d.md)与
  [Windows 任务交接](handoffs/v1.3.3-slice-e.md)。
- 三平台候选原生验证、正式标签构建与 GitHub Release 尚待完成；完成前公开稳定版本仍为 v1.3.2。
  实际触摸/混合设备、屏幕阅读器和真实高倍缩放等仍需后续人工验收。
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
