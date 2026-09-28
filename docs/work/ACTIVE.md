# Active work packet

Last updated: 2026-09-28

- Status: `In progress`
- Approved for implementation: yes — Slice A–D
- Target version: `v1.3.4`
- Plan: [提醒与迁移安全修复](../plans/v1.3.4-reminder-and-migration-safety.md)
- Implementation branch: `codex/v1.3.4-slice-a`
- Implementation commits: A `0809a1b` / `c8d68db`; B `dd07d9d`; C `f15b63c`; D `5ae4aee`; review fixes `08641db`
- Base commit: `f88bc46ea8ad2e1cfa9d0cbd446bd1d50422d3e8`
- Verification fix commit: `691a7499e8fd4701b011b5e53ef0a86b1a03a635`
- Current step: 实现及本轮可执行验证完成；按用户收尾要求结束本任务，未验证项保留，不标全部 Verified
- Task disposition: closed — 不再安排追加验证或人工操作；版本状态 In progress 仅表示未满足全部验证门槛
- Handoff: [统一验证报告](../handoffs/v1.3.4-validation.md)；[原清单](../handoffs/v1.3.4-unified-verification.md)
- Stable public version: `v1.3.3`
- Immutable release commit: `a853e712a84156b5cc5575a828d2295298b35beb`

## 已完成的发布

v1.3.3 A–E 已纳入同一标签。Windows x64、macOS Apple Silicon arm64、macOS Intel x64
通过候选与正式标签原生验证，公开 ZIP 重新下载后与校验文件一致。详见
[版本记录](../../CHANGELOG.md)和[正式下载页](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.3.3)。

## 下一步边界

用户最新收尾决定优先于此前补齐验证的安排：保留既有结果，不重复基础检查，不追加原生验证，
不请求 UAC，不创建测试账户或虚拟机，不安排 macOS 或云端验证。本轮只提交收尾文档并结束。
macOS、另一管理员身份、真实任务读取权限拒绝及已有任务取消场景均明确为未验证，
这些限制作为交接事实保留，不作为本任务继续执行或增加人工操作的事项。

实施完整 A–D 工作包，不扩大到 v1.4.0。允许本地提交，不合并、不推送、不打标签、不发布。
2026-09-28 已按新批准完成当前可执行项：lint/build、Node 132 项、UI 39 项均通过。
Windows 真实任务 31 项、真实 UAC 取消、临时文件占用和目录权限检查通过。
macOS 原生、另一管理员身份及报告中标明的真实权限/取消组合仍待验证；不标 Verified。
保持格式 8/2/3，使用合成资料及唯一临时任务，不读取个人授权码或发送邮件。
A 的历史 Windows 原生回滚与归属保护结果见 A 交接，不能替代当前完整工作包的结果。
四项基础检查采用 691a749 的新结果；不得把模拟覆盖当成缺失的原生证据。
原主目录的未提交文档保持原样；此隔离分支不合并，保留供验收。
