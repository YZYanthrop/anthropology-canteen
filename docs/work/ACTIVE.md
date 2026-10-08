# Active work packet

Last updated: 2026-10-08

- Status: In progress，未 Verified；完成公开发行和公开下载核验才结束目标
- Approved: 完整目标准备/工具/分支推送/三平台构建验收及门槛后发布；另批准仅修复Mac多行缺失任务诊断，其他产品缺陷仍先报告
- Plan: [统一重新发行](../plans/v1.3.4-three-platform-reissue.md)
- Branch/worktree: codex/v1.3.4-reissue / macos-v135-fix
- Frozen product S2: 9d17e4dd7480b571febbad52a2ef5db8a85930b1；产品1.3.4/r1、格式8/2/3
- Run37632101351: 共享186/39及两Mac独立73项通过；native smoke虽返回0，日志发现Bash提前退出，撤回该项通过结论
- Windows T3/run37717588483: 39/40及主独立清理通过；迁移集合6个用例缺源码dist，ACL原生两项通过；Bash诊断失败及空合成目录残留另记，不豁免
- Current run: [37718779771](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/37718779771)，T4=49eb8801306eabc118249042ab1dffe49e146b5e；sequence=4仅两Mac原S2 ZIP native-smoke/真Bash工具回归/独立清理，作业success但详细报告下载审核中
- Next: sequence=5仅Windows原S2 ZIP；从同包dist准备源码测试依赖，拒绝覆盖不匹配内容，不重新构建；修正Bash诊断一起重验
- UAC: S2唯一离线场景已准备，尚未弹窗，等待用户配合；新建取消、旧任务注册和更新取消及清理仍待验证
- Evidence: [准确摘要、历史失败和重验范围](../handoffs/v1.3.4-r1-execution.md) / [原发行归档](../handoffs/v1.3.4-original-release-archive.md)
- Public: 旧Release399786176/tag→bb78dd9/六资产/main未变；全部必需门槛后方可按原页或r1备用路线执行
- Forbidden: main推送、签名、公证、保护绕过、其他版本改写、未经批准的新产品修复；不豁免失败和泄漏

只用合成资料/临时任务/测试凭据，不连接真实邮箱、不发信；保留其他工作区和旧主目录五项未提交文档。
