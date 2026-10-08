# Active work packet

Last updated: 2026-10-08

- Status: In progress，自动验收已完成，真实UAC待验证；未公开重新发行，未整体Verified
- Approved: 完整目标准备/工具/分支推送/三平台构建验收及门槛后发布；限定Mac多行诊断修复已批准完成，其他新产品缺陷仍先报告
- Target/plan: [三平台统一重新发行v1.3.4 r1，公开核验与交接](../plans/v1.3.4-three-platform-reissue.md)
- Branch/worktree: codex/v1.3.4-reissue / macos-v135-fix
- Frozen product S2: 9d17e4dd7480b571febbad52a2ef5db8a85930b1；产品1.3.4/r1、格式8/2/3
- Build/shared/Mac73: run37632101351；Node186/UI39、lint/build通过。该轮Mac smoke假通过已撤回，由T4补验替代
- Mac smoke: T4=49eb8801306eabc118249042ab1dffe49e146b5e / run37718779771；两架构8阶段、Bash3/3和独立清理通过，原始报告已核实
- Windows: T5=e52325656e620536f052b6c234272d7b640be7cc / run37719540921；40/40、迁移32/32、权限对照和清理通过，原始报告已核实
- Next: 用户配合S2真实UAC。唯一离线场景已准备、未弹窗；新建取消（否）→旧任务注册（是）→更新取消（否）→精确清理，每步事先通知
- UAC receipt: outputs/r1-execution/uac-s2/owned.json；只能操作其中唯一临时身份，离线worker；开始前复核身份和计划时间仍安全
- Evidence: [逐项验收矩阵](../handoffs/v1.3.4-r1-verification.md) / [执行与历史失败](../handoffs/v1.3.4-r1-execution.md) / [原发行归档](../handoffs/v1.3.4-original-release-archive.md)
- Public: 旧Release399786176/tag→bb78dd9/六资产/main未变；UAC门槛完成后复核真实远端和归档、生成精确清单，按已授权原页或r1备用路线发布，再公开下载核验
- Forbidden: main推送、签名、公证、保护绕过、其他版本改写、未经批准的新产品修复；不豁免失败和活动泄漏

只用合成资料/临时任务/测试凭据，不连接真实邮箱、不发信；保留其他工作区和旧主目录五项未提交文档。
