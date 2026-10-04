# Active work packet

Last updated: 2026-10-04

- Status: Proposed
- Approved for implementation: no
- Target: 三平台统一重新发行 v1.3.4；产品 1.3.4，发行修订 r1
- Plan: [具体方案、约定变更、验收与授权闸门](../plans/v1.3.4-three-platform-reissue.md)
- Branch: codex/v1.3.4-reissue-plan；复用干净 macos-v135-fix 隔离工作区，由 a49dc84 分出
- Handoff: [原发布归档及实时保护核对](../handoffs/v1.3.4-original-release-archive.md)
- 已完成：只读 GitHub 核对、旧标签/完整 Git 历史/发布说明/六资产归档及双副本校验
- 待执行：准备脚本、冻结新源、三平台新构建和验收；新的推送/云端构建逐次明确授权
- 发布闸门：新三包验收后才请求一次精确删除/标签/重新发布确认；当前不请求破坏性操作
- 实际 GitHub：Release immutable=false、仓库未启用不可变发布、无规则集；项目不改写标签约定仍有效
- 备用：若不能复用，使用新 v1.3.4-r1 标签/Release，原版保留，并在获授权后添加旧页引导

原内部 Mac 工作执行完成、待用户验收，codex/v1.3.4-macos-basic 与[报告](../handoffs/v1.3.4-macos-basic-internal.md)保留。
产品 f1bacdc 的有限通过及旧 B/D 复用证据不计入未来新发行；当前不将整个版本标 Verified。
原主目录五项未提交文档、其他工作区和旧分支保留；不使用旧主目录作为产品基线。
本轮不修改产品/工作流、不合并、不推送、不打标签、不删除或改写 Release；保持 8/2/3 与真实邮箱禁用边界。
