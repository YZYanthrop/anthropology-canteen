# Current project snapshot

Last updated: 2026-10-08

This is the lightweight entry point for a new Codex task. Chat history is not
required. Read this file and `docs/work/ACTIVE.md` first, then follow the
document router below.

## Stable product

- Public version and preserved tag: `v1.3.4` at
  `bb78dd9431a61617c3198b087ac556759ef85333`; released with accepted limits, not fully Verified.
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

## Current work

[三平台统一重新发行 v1.3.4（r1）](plans/v1.3.4-three-platform-reissue.md)：**In progress，批准实施 yes，未 Verified**。
完整目标授权及限定产品修复批准保留；冻结产品S2=`9d17e4dd7480b571febbad52a2ef5db8a85930b1`，产品1.3.4/r1、格式8/2/3。
共享lint/build、Node186/UI39通过；两个Mac各73项及T4原包8阶段smoke/独立清理通过；Windows T5自动40项（含迁移32/32）及清理通过，原始报告已回收逐项核验。
[验收矩阵](handoffs/v1.3.4-r1-verification.md) / [完整执行与失败历史](handoffs/v1.3.4-r1-execution.md)。T4=49eb880、T5=e523256只修工具，三个原ZIP字节不变。
**剩余门槛：真实本地UAC新建取消、旧任务注册、更新取消和清理。** 唯一离线场景已准备、未弹窗，等待用户配合；门槛完成前不发布、不标Verified。
原Release/tag/六资产/main未改，双份[旧发行归档](handoffs/v1.3.4-original-release-archive.md)于2026-10-08再次完整核验；其他工作区和旧主目录未提交修改保留。

## Current release

v1.3.4 已发布，但未全部 Verified；用户明确接受本次验证例外。
按项目约定保留的标签 v1.3.4 指向 `bb78dd9431a61617c3198b087ac556759ef85333`，三个最终包的 release.json 同源。
[公开发布页](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.3.4)；[发布交接](handoffs/v1.3.4-release.md)。
最终 Windows 包及两个原生 Mac 包的结构、空白资料、隐私、服务启动、静态资源和合成状态重启持久化检查通过。
既有 691a749 的 lint/build、Node 132/132、UI 39/39 及已执行 Windows 原生结果保留，未重复整套回归。

macOS 版为实验性版本，尚未完成 v1.3.4 的 macOS 原生验收，后台提醒、资料迁移及失败恢复仍存在未验证风险。升级前请保留旧版文件夹和资料备份。

Windows 另一管理员身份、真实任务读取权限拒绝及已有任务取消场景仍未验证。
启动器人工交互与真实邮件/服务不在本次有限检查范围内，不声称完整原生验收。
格式保持 8/2/3；v1.4.0 仍为 Proposed、未批准实施。
原主目录两项修改和三项未跟踪文档保留在 codex/preserve-local-planning-v1.3.4，未覆盖或提交。

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

新包执行记录：[工具准备、冻结与验收进度](handoffs/v1.3.4-r1-execution.md)。
