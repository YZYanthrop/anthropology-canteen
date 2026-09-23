# Active work packet

Last updated: 2026-09-23

- Status: `Ready for review`
- Approved for implementation: yes
- Target version: `v1.3.3 Slice E`
- Plan: [Windows 后台提醒任务迁移](../plans/v1.3.3-windows-reminder-task-migration.md)
- Implementation branch: `codex/v1.3.3-reminder-task-migration`
- Current step: Slice E 实现、回归、Windows 原生验证、文档和交接已完成；等待分支 diff 审阅，不合并、不发布
- Baseline commit: `24b15fb8282d8188c963b4ed3dbe8df322c1840b`
- Stable public version: `v1.3.2`
- Immutable release commit: `f89936b8e4854928142fb028de869794639fed3d`

## 下一步

审阅 Slice E 分支 diff 与 [交接](../handoffs/v1.3.3-slice-e.md)。同一提醒身份的任务重复
更新仍为一项，权限确认只提升任务小工具；来源不明确的旧任务只报告不删除。合并、版本冻结、
推送、标签及发布仍是后续单独授权任务。

## 范围

主数据格式保持 8、提醒状态 2、设置 3。Slice E 只处理 Windows 当前用户计划任务的检查、
原位更新、最小权限提升和保守清理；不改变邮件接入、授权码、数据迁移来源、macOS 行为、
支持平台或发布包装。若无法保证任务仍属于原登录用户，或无法唯一确认旧任务归属，停止自动
修改并说明原因。v1.4.0 仅为 [Proposed 路线图](../plans/v1.4.0-roadmap.md)，不授权实施。

## 基线提醒

v1.3.2 实现、三平台发布与公开附件校验已完成，详见 CHANGELOG。
2026-09-23 规划基线为本地 `main` 的 `24b15fb`；`origin/main` 跟踪信息仍可能过期，
不能仅凭 ahead 数字判断远端状态。实施前重新检查工作区和实际远端，不依赖旧任务记录。
