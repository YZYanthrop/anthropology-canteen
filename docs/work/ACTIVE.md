# Active work packet

Last updated: 2026-10-04

- Status: In progress（本轮执行完成，待用户验收；未合并未发布，版本未标 Verified）
- Outcome: macOS 基本可用验收通过（有限范围）；两架构各 46 项必需通过
- Product version: 1.3.4 保持不变，仅内部候选，不替换正式资产
- Product SHA: f1bacdcd939ce1df8aeb5c813c652d55d2d7c138
- Test SHAs: R2 b397de0fa0570e5e7c6fcb604840e6b26b3e19d5；R3 ca4e7622b3773b5c6cbdebdc3c4e6c5fd2d8586b
- Branch: codex/v1.3.4-macos-basic；隔离 worktree macos-v135-fix 保留
- Plan: [批准范围与完成标准](../plans/v1.3.4-macos-basic-internal.md)
- Handoff: [结果、包、校验、Actions 与清理](../handoffs/v1.3.4-macos-basic-internal.md) / [逐项清单](../handoffs/v1.3.4-macos-basic-internal-cases.md)
- Authorization: 本次限定分支推送、双架构内部构建/验收及必要测试脚本修正已执行；不授权发布
- Next: 已停止，等待用户验收；分支不自动合并，最终文档仅本地提交

真实定时各一次、更新/恢复零意外执行；临时任务/plist/进程清理完成，enabled override 残留见报告。
Finder/Gatekeeper、登录注销、睡眠唤醒、整机重启、隔离不可行查询 ACL、真实邮箱未覆盖，不冒充通过。
只用合成资料/临时任务，未读取个人授权码、连接真实邮箱或发信。8/2/3、邮箱、平台、启动器及 v1.4.0 边界不变。
原主目录五项文档修改、旧验收工作区和旧分支保留；main、正式标签、ZIP、校验和 Release 未改写。
