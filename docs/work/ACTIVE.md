# Active work packet

Last updated: 2026-10-11

- Status: Released（本轮有限验收及公开字节复核完成），等待用户验收；未整体Verified。
- Packet: [三平台统一重新发行v1.3.4 r1](../plans/v1.3.4-three-platform-reissue.md)。完整目标已完成，当前没有继续实施的新授权。
- Public: [原入口](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.3.4)，Release399786176保留，恰好三个r1 ZIP和三个校验文件。
- Product: `9d17e4dd7480b571febbad52a2ef5db8a85930b1`；产品1.3.4/r1，格式8/2/3。
- Tag: v1.3.4 → `94b12bbfd071437f431bdbf8198867dfb84c691a` → 产品S；原发行双份完整归档，其他版本不变。
- Evidence: [发行交接](../handoffs/v1.3.4-r1-release.md)、[矩阵](../handoffs/v1.3.4-r1-verification.md)、[真实UAC](../handoffs/v1.3.4-r1-uac.md)、[失败与纠正历史](../handoffs/v1.3.4-r1-execution.md)。
- Tests: S/run37632101351；Mac smoke T4=49eb880/run37718779771；Windows T5=e523256/run37719540921；本地UAC全部完成，临时任务/进程清理，worker零执行。
- Retained branch/worktree: codex/v1.3.4-reissue / macos-v135-fix；最终交接只推此分支，不合并、不推main，不自动删除工作区。
- Limits: Finder/Gatekeeper、真实登录/睡眠/重启、无法安全隔离查询ACL、另一管理员身份、签名/公证及真实邮件未覆盖；Mac空override和历史工具清理失败如实保留。
- Other work: main保持0a2372bc，旧主目录五项未提交文档和其他分支保留；v1.4.0未批准。
