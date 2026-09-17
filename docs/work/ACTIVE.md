# Active work packet

Last updated: 2026-09-17

- Status: `Merged`
- Approved for implementation: yes
- Target version: `v1.3.3`
- Plan: [普通中文与左栏可用性](../plans/v1.3.3-language-and-sidebar-usability.md)
- Implementation branch: local `main`；Slice D 短期分支 `codex/v1.3.3-reminder-migration` 保留作已合并记录
- Current step: A（92e5473）、B（c2cb801）、C（666524e）、D（9e2878a）已本地合并；lint、构建、24 项界面、52 项离线及 12 个 Edge 合成场景通过
- Handoff: [Slice D 交接与验证限制](../handoffs/v1.3.3-slice-d.md)
- Stable public version: `v1.3.2`
- Immutable release commit: `f89936b8e4854928142fb028de869794639fed3d`

## 下一步

审阅 Slice D 实现结果，并在 macOS 原生环境确认钥匙串关联仍可读取；补充实际触摸／混合设备、
macOS 浏览器、屏幕阅读器及真实高倍缩放验收。自动测试不等于真人或原生平台验收。
版本冻结、三平台原生包验证、推送、标签及发布是后续单独授权任务。

## 范围

主数据格式保持 8、提醒状态 2、设置 3。Slice D 只扩展自动迁移和提醒状态提示，
不修改包装、启动器、导入格式、邮箱接入方式或平台支持。
如必须扩大范围，停止相关实施并说明原因。v1.4.0 仅为
[Proposed 路线图](../plans/v1.4.0-roadmap.md)，不授权实施。

## 基线提醒

v1.3.2 实现、三平台发布与公开附件校验已完成，详见 CHANGELOG。
2026-09-11 核验时本地和远端实际 main 均为 `c20a6be43e9421d1d0d6a738bb8540a6a669c0cf`。
本地 origin/main 缓存过期，当时的 ahead 18 不代表尚未推送；未刷新引用或推送。
未来实施前重新检查工作区和实际远端，不依赖旧任务记录。
