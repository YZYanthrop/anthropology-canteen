# Current project snapshot

Last updated: 2026-09-28

This is the lightweight entry point for a new Codex task. Chat history is not
required. Read this file and `docs/work/ACTIVE.md` first, then follow the
document router below.

## Stable product

- Public version and immutable tag: `v1.3.3` at
  `a853e712a84156b5cc5575a828d2295298b35beb`.
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

- [v1.3.4 提醒与迁移安全修复](plans/v1.3.4-reminder-and-migration-safety.md) Slice A–D
  已批准实施，状态 `In progress`，沿用隔离分支 `codex/v1.3.4-slice-a`，基线 `f88bc46`。
  A–D 实现、回归测试代码和文档已完成本地提交；B dd07d9d、C f15b63c、D 5ae4aee，静态审阅修正 08641db。
  统一验证修复提交 `691a749`：lint/build 通过，Node 132/132、UI 39/39 通过；Windows
  真实任务 31 项、真实 UAC 取消和临时文件权限/占用检查通过，详见[验证报告](handoffs/v1.3.4-validation.md)。
  收尾结论：**实现及本轮可执行验证完成**，本任务结束，既有通过结果保留。
  macOS 原生、另一管理员身份、真实任务读取权限拒绝及已有任务取消场景明确未验证；
  不标为全部 Verified 或可发布。不再安排追加验证、UAC、测试账户、虚拟机或 macOS/云端任务。
  原主目录未提交文档保留；不重复运行基础检查。
  允许本地提交；不合并、不推送、不打标签、不发布。
- v1.3.3 A–E 已从同一标签提交正式发布：[三个平台的便携包](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.3.3)。
  候选与标签运行的三平台原生检查均通过；公开附件重新下载后与同名校验文件一致。
- 升级可保留同一旧版文件夹中的邮件设置、发送记录和 Windows 加密授权码；Windows
  后台提醒任务在必要时只提升任务小工具。同一身份重复更新不增加任务，来源不明的旧任务不自动删除。
- 主数据格式 8、提醒状态 2、设置 3 不变。实际触摸/混合设备、屏幕阅读器和真实高倍缩放
  仍需后续人工验收；自动化通过不等于没有缺陷。
- [v1.4.0 路线图](plans/v1.4.0-roadmap.md) 仍为 `Proposed`，尚未批准实施。
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
