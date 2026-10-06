# Active work packet

Last updated: 2026-10-06

- Status: In progress；发布停止于新产品缺陷，未 Verified
- Approved: 完整目标的准备/工具/分支推送/三平台构建验收及门槛后发布仍有效；新产品修复须另行明确批准
- Target: 三平台统一重新发行 v1.3.4（r1），公开下载复核通过及交接完成
- Branch/worktree: codex/v1.3.4-reissue / macos-v135-fix；产品 S 与首轮 T=`946cc16aae10e2ffda6fb8104d9576b21b317756`
- Plan: [范围、门槛与发布路线](../plans/v1.3.4-three-platform-reissue.md)
- Run: [37321169428](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/37321169428)，已结束 failure；三包已构建，共享170/39通过
- Blocker: 两 Mac 原包首次任务注册失败；[默认诊断包装缺陷与复现](../handoffs/v1.3.4-r1-macos-missing-task-defect.md)
- Other failures: Intel 黑盒资料读取超时、Windows 提醒状态超时，尚未判定根因；Windows 后续原生/UAC 未执行
- Evidence: [执行记录、各平台结果、包摘要和清理](../handoffs/v1.3.4-r1-execution.md)；[原发行双份归档](../handoffs/v1.3.4-original-release-archive.md)
- Next: 交付已复现的新产品缺陷；修复获批后新 S、三平台重建与完整验收，不套用旧结果
- Public state: Release399786176 / 原tag→bb78dd9 / 六资产 / main 未变；原页或 r1 备用路线均须全部必需门槛后才执行
- Forbidden: main 推送、签名、公证、保护绕过、其他版本改写、未经批准的新产品修复；不把已知失败豁免

产品1.3.4、格式8/2/3；只用合成资料/临时任务/测试凭据，无真实邮箱或发信。
其他工作区、历史分支和原主目录五项未提交文档保留。真实 UAC 尚未弹窗；新产品阻断解除后先准备场景再通知用户。
