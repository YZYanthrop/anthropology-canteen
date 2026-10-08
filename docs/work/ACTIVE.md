# Active work packet

Last updated: 2026-10-08

- Status: In progress，未 Verified；完成公开发行和公开下载核验才结束目标
- Approved: 完整目标准备/工具/分支推送/三平台构建验收及门槛后发布；另批准仅修复Mac多行缺失任务诊断，其他产品缺陷仍先报告
- Plan: [统一重新发行](../plans/v1.3.4-three-platform-reissue.md)
- Branch/worktree: codex/v1.3.4-reissue / macos-v135-fix
- Frozen product S2: 9d17e4dd7480b571febbad52a2ef5db8a85930b1；产品1.3.4/r1、格式8/2/3
- Run37632101351: 共享186/39及两Mac独立73项通过；native smoke虽返回0，日志发现Bash提前退出，撤回该项通过结论
- Windows T3/run37717588483: 已结束failure；目录修正后A/C/定时和清理未再报失败，迁移集合失败原因待完整报告；Git Bash诊断误命中whoami另已修工具
- Next: sequence=4 / 仅两Mac native-smoke + 真Bash工具回归 + 独立清理；同S2原ZIP，加完整终点防假通过；测试T另记
- UAC: S2唯一离线场景已准备，尚未弹窗，等待用户配合；新建取消、旧任务注册和更新取消及清理仍待验证
- Evidence: [准确摘要、历史失败和重验范围](../handoffs/v1.3.4-r1-execution.md) / [原发行归档](../handoffs/v1.3.4-original-release-archive.md)
- Public: 旧Release399786176/tag→bb78dd9/六资产/main未变；全部必需门槛后方可按原页或r1备用路线执行
- Forbidden: main推送、签名、公证、保护绕过、其他版本改写、未经批准的新产品修复；不豁免失败和泄漏

只用合成资料/临时任务/测试凭据，不连接真实邮箱、不发信；保留其他工作区和旧主目录五项未提交文档。
