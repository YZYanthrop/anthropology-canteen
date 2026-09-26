# Active work packet

Last updated: 2026-09-26

- Status: `Release candidate`
- Approved for implementation: yes
- Target version: `v1.3.3`
- Plan: [Windows 后台提醒任务迁移](../plans/v1.3.3-windows-reminder-task-migration.md)
- Release branch: `codex/v1.3.3-release`
- Current step: A–E 已纳入同一发布候选；冻结提交后执行本地验证、三平台原生候选和标签构建，再发布 GitHub Release
- Baseline commit: `24b15fb8282d8188c963b4ed3dbe8df322c1840b`
- Stable public version: `v1.3.2`
- Immutable release commit: `f89936b8e4854928142fb028de869794639fed3d`

## 下一步

按 [发布规范](../RELEASING.md) 逐项确认本地测试、候选运行、标签运行、空白包隐私和
公开附件摘要。任一平台失败或版本来源不一致即停止；现有标签不可移动。用户已明确授权
本次合并、推送、创建新标签及 GitHub Release，不包含签名或公证。

## 范围

主数据格式保持 8、提醒状态 2、设置 3。Slice E 只处理 Windows 当前用户计划任务的检查、
原位更新、最小权限提升和保守清理；不改变邮件接入、授权码、数据迁移来源、macOS 行为、
支持平台或发布包装。若无法保证任务仍属于原登录用户，或无法唯一确认旧任务归属，停止自动
修改并说明原因。v1.4.0 仅为 [Proposed 路线图](../plans/v1.4.0-roadmap.md)，不授权实施。

## 基线提醒

v1.3.2 实现、三平台发布与公开附件校验已完成，详见 CHANGELOG。
2026-09-26 已通过实际远端查询核对：发布前 GitHub `main` 为 `c20a6be`，
且是 A–E 实施分支的祖先；主工作区未提交的规划文档保持原状，不并入发布候选。
