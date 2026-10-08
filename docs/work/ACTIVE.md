# Active work packet

Last updated: 2026-10-08

- Status: In progress，未 Verified；完成公开发行和公开下载核验才结束目标
- Approved: 完整目标准备/工具/分支推送/三平台构建验收及门槛后发布；另批准仅修复Mac多行缺失任务诊断，其他产品缺陷仍先报告
- Plan: [统一重新发行](../plans/v1.3.4-three-platform-reissue.md)
- Branch/worktree: codex/v1.3.4-reissue / macos-v135-fix
- Frozen product S2: 9d17e4dd7480b571febbad52a2ef5db8a85930b1；产品1.3.4/r1、格式8/2/3
- Run37632101351: 共享lint/build/Node186/UI39通过，两Mac各73项+原包native smoke+独立清理通过；Windows原包黑盒/native smoke通过但后续工具目录/ACL失败
- Next: sequence=3定向重验同S2原Windows ZIP；只修工具不改产品，测试T另记。新目录/直接Python/ACL前置探针；不掩盖旧清理失败
- UAC: S2唯一离线场景已准备，尚未弹窗，等待用户配合；新建取消、旧任务注册和更新取消及清理仍待验证
- Evidence: [准确摘要、历史失败和重验范围](../handoffs/v1.3.4-r1-execution.md) / [原发行归档](../handoffs/v1.3.4-original-release-archive.md)
- Public: 旧Release399786176/tag→bb78dd9/六资产/main未变；全部必需门槛后方可按原页或r1备用路线执行
- Forbidden: main推送、签名、公证、保护绕过、其他版本改写、未经批准的新产品修复；不豁免失败和泄漏

只用合成资料/临时任务/测试凭据，不连接真实邮箱、不发信；保留其他工作区和旧主目录五项未提交文档。
