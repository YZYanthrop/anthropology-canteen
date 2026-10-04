# Active work packet

Last updated: 2026-10-03

- Status: In progress — v1.3.5 macOS 基本可用修复与验收
- Target version: v1.3.5（实时远端核对未使用，尚未发布）
- Approved for implementation: yes；修复/测试/文档/本地提交
- Branch: codex/v1.3.5-macos-basic；独立 worktree macos-v135-fix
- Plan: [批准计划](../plans/v1.3.5-macos-basic-usability.md)
- Baseline: 发布产品 bb78dd9；验收交接 fbaa63f；现有证据及未提交修改保留
- Scope: macOS 停用解析、原状态保存、更新及恢复；数据格式 8/2/3 不变
- Verification: lint/build、Node 164/164、提醒 UI 22/22 已通过；工具补测 4/4 和 Python 7/7；原生候选尚未执行
- Handoff: [实现与云端执行清单](../handoffs/v1.3.5-macos-basic-usability.md)；B/D、Keychain 按依赖未变证明复用
- External authorization: 本次分支推送及云端构建/验收尚未授权，不沿用旧授权
- Completion: 必需场景都通过才判“macOS 基本可用验收通过（有限范围）”；不标整个版本 Verified

[原验收报告](../handoffs/v1.3.4-macos-limited-acceptance.md)与[未修复缺陷](../handoffs/v1.3.4-macos-disabled-state-defect.md)保留。
macos-v134-acceptance 和 reminder-rollback 工作区不变；原主目录五项未提交文档不动。
云端批准前形成可审阅 diff、冻结提交及执行清单。交付后停止；不合并、不推送 main、不打标签、不发布。
v1.3.4 已发布资产保持不变；v1.4.0 仍 Proposed、未批准实施。
