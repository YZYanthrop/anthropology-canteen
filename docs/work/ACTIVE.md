# Active work packet

Last updated: 2026-10-04

- Status: In progress — v1.3.4 基线的 macOS 基本可用内部修复与验收
- Product version: 1.3.4 保持不变；内部候选用准确 SHA 区分，非正式资产替换
- Approved: 必要修复、测试、文档、本地提交及内部构建/测试；分支推送仍须最终冻结后限定授权
- Branch: codex/v1.3.4-macos-basic；复用隔离 worktree macos-v135-fix
- Plan: [当前批准计划](../plans/v1.3.4-macos-basic-internal.md)
- Baseline: 正式 bb78dd9431a61617c3198b087ac556759ef85333；验收 fbaa63f；必要修复 2936d8a
- Handoff: [准确提交与验证记录](../handoffs/v1.3.4-macos-basic-internal.md)
- Verification: 既有 lint/build、Node 164/164、提醒 UI 22/22、工具补测保留；本次定向 Node 7/7、Python 7/7、定向 lint 和恢复版本后的 build 已通过
- Cloud: 尚未推送新分支或构建最终内部包；旧 v1.3.5 请求不再适用
- Completion: 两架构必需项全部通过才判“macOS 基本可用验收通过（有限范围）”；不标版本 Verified

仅修已确认 macOS 停用识别和由此导致的更新/恢复，8/2/3、邮箱、平台和启动器不变。
原 v1.3.4 验收、v1.3.5 本地分支及其他工作区修改保留；不以旧主目录作为产品基线。
只用合成资料和唯一临时任务，不读取个人授权码、不连接真实邮箱、不发信。
交付验收后停止；不自动合并、不推送 main、不打标签、不发布、不覆盖已有标签或正式 ZIP。
