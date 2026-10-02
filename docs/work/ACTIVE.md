# Active work packet

Last updated: 2026-10-02

- Status: In progress — 已发布 v1.3.4 的 macOS 有限验收；产品仍 not fully Verified
- Target version: v1.3.4
- Task disposition: 本地脚本准备已批准；新的分支推送和两架构云端执行待单独授权
- Plan: [macOS 有限验收](../plans/v1.3.4-macos-limited-acceptance.md)；原 A–D 实现计划已归档
- Handoff: [本轮验收记录](../handoffs/v1.3.4-macos-limited-acceptance.md)；分支 codex/v1.3.4-macos-acceptance
- Verification: [原验证记录](../handoffs/v1.3.4-validation.md)；不以有限包检查替代未验证项目

v1.3.4 已发布，但未全部 Verified；用户明确接受本次验证例外。
不可变标签 v1.3.4 指向 `bb78dd9431a61617c3198b087ac556759ef85333`，三个最终包的 release.json 同源。
[公开发布页](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.3.4)；[发布交接](../handoffs/v1.3.4-release.md)。
最终 Windows 包及两个原生 Mac 包的结构、空白资料、隐私、服务启动、静态资源和合成状态重启持久化检查通过。
既有 691a749 的 lint/build、Node 132/132、UI 39/39 及已执行 Windows 原生结果保留，未重复整套回归。

macOS 版为实验性版本，尚未完成 v1.3.4 的 macOS 原生验收，后台提醒、资料迁移及失败恢复仍存在未验证风险。升级前请保留旧版文件夹和资料备份。

Windows 另一管理员身份、真实任务读取权限拒绝及已有任务取消场景仍未验证。
启动器人工交互与真实邮件/服务不在本次有限检查范围内，不声称完整原生验收。
格式保持 8/2/3；v1.4.0 仍为 Proposed、未批准实施。
原主目录两项修改和三项未跟踪文档保留在 codex/preserve-local-planning-v1.3.4，未覆盖或提交。
