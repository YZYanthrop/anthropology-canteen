# Active work packet

Last updated: 2026-09-12

- Status: `Merged`
- Approved for implementation: yes
- Target version: `v1.3.3`
- Plan: [普通中文与左栏可用性](../plans/v1.3.3-language-and-sidebar-usability.md)
- Implementation branch: local `main`；三个短期实现分支保留作已合并记录
- Current step: A（92e5473）、B（c2cb801）、C（666524e）源码已完成并本地合并，真人验收有未完成项
- Handoff: [最终交接与验证限制](../handoffs/v1.3.3-slice-c.md)
- Stable public version: `v1.3.2`
- Immutable release commit: `f89936b8e4854928142fb028de869794639fed3d`

## 下一步

审阅实现结果，补充实际触摸/混合设备、macOS 浏览器、屏幕阅读器及真实高倍缩放验收。
源码验证包括 lint、构建、22 项界面、46 项离线及 12 个 Edge 浏览器场景；不等于真人验收。
版本冻结、三平台原生包验证、推送、标签及发布是后续单独授权任务。

## 范围

主数据格式保持 8、提醒状态 2、设置 3。不修改包装、启动器、导入格式或平台支持。
如必须扩大范围，停止相关实施并说明原因。v1.4.0 仅为
[Proposed 路线图](../plans/v1.4.0-roadmap.md)，不授权实施。

## 基线提醒

v1.3.2 实现、三平台发布与公开附件校验已完成，详见 CHANGELOG。
2026-09-11 核验时本地和远端实际 main 均为 `c20a6be43e9421d1d0d6a738bb8540a6a669c0cf`。
本地 origin/main 缓存过期，当时的 ahead 18 不代表尚未推送；未刷新引用或推送。
未来实施前重新检查工作区和实际远端，不依赖旧任务记录。
