# Active work packet

Last updated: 2026-09-28

- Status: `In progress`
- Approved for implementation: yes — Slice A–D
- Target version: `v1.3.4`
- Plan: [提醒与迁移安全修复](../plans/v1.3.4-reminder-and-migration-safety.md)
- Implementation branch: `codex/v1.3.4-slice-a`
- Implementation commits: A `0809a1b` / `c8d68db`; B `dd07d9d`; C `f15b63c`; D `5ae4aee`; review fixes `08641db`
- Base commit: `f88bc46ea8ad2e1cfa9d0cbd446bd1d50422d3e8`
- Current step: A–D 实现交接完成，等待用户验收及独立统一验证；保持 In progress，不是 Verified
- Handoff: [统一验证清单与提交索引](../handoffs/v1.3.4-unified-verification.md)
- Stable public version: `v1.3.3`
- Immutable release commit: `a853e712a84156b5cc5575a828d2295298b35beb`

## 已完成的发布

v1.3.3 A–E 已纳入同一标签。Windows x64、macOS Apple Silicon arm64、macOS Intel x64
通过候选与正式标签原生验证，公开 ZIP 重新下载后与校验文件一致。详见
[版本记录](../../CHANGELOG.md)和[正式下载页](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.3.3)。

## 下一步边界

实施完整 A–D 工作包，不扩大到 v1.4.0。允许本地提交，不合并、不推送、不打标签、不发布。
每 Slice 先写回归再修复；本轮不运行 lint/build/Node/UI/原生验证，不请求 UAC。
全部实现后交付统一验证清单，由独立任务执行。A 既有结果保留；新增实现均待验证，不标 Verified。
保持格式 8/2/3，使用合成资料及唯一临时任务，不读取个人授权码或发送邮件。
A 的历史 Windows 原生回滚与归属保护结果见 A 交接，不能替代当前完整工作包的结果。
四项基础检查、macOS 原生、真实 UAC 取消、另一管理员凭据均列入统一清单待验证。
原主目录的未提交文档保持原样；此隔离分支不合并，保留供验收。
