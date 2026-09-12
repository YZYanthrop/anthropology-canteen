# Active work packet

Last updated: 2026-09-12

- Status: `In progress`
- Approved for implementation: yes
- Target version: `v1.3.3`
- Plan: [普通中文与左栏可用性](../plans/v1.3.3-language-and-sidebar-usability.md)
- Implementation branch: `codex/v1.3.3-b-sidebar-scroll`
- Current step: Slice A 已在本地合并（92e5473），当前执行 Slice B
- Stable public version: `v1.3.2`
- Immutable release commit: `f89936b8e4854928142fb028de869794639fed3d`

## 下一步

依次实施 Slice A（中文与更新说明）、B（左栏滚动）、C（触摸操作及回归）。
每阶段完成验证、交接和本地提交合并，再开始下一阶段。不打包、不推送、不发布。

## 范围

主数据格式保持 8、提醒状态 2、设置 3。不修改包装、启动器、导入格式或平台支持。
如必须扩大范围，停止相关实施并说明原因。v1.4.0 仅为
[Proposed 路线图](../plans/v1.4.0-roadmap.md)，不授权实施。

## 基线提醒

v1.3.2 实现、三平台发布与公开附件校验已完成，详见 CHANGELOG。
2026-09-11 核验时本地和远端实际 main 均为 `c20a6be43e9421d1d0d6a738bb8540a6a669c0cf`。
本地 origin/main 缓存过期，当时的 ahead 18 不代表尚未推送；未刷新引用或推送。
未来实施前重新检查工作区和实际远端，不依赖旧任务记录。
