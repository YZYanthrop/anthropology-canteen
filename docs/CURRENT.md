# Current project snapshot

Last updated: 2026-10-11

## Stable product

- **v1.3.4 r1 已公开**，完成本次三平台有限验收与公开下载复核；未整体 Verified。
- [发布页](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.3.4) / [发行交接](handoffs/v1.3.4-r1-release.md) / [验收矩阵](handoffs/v1.3.4-r1-verification.md)。
- 产品1.3.4、修订r1；Windows x64、macOS arm64/x64同源 `9d17e4dd7480b571febbad52a2ef5db8a85930b1`。
- v1.3.4标签对象 `94b12bbfd071437f431bdbf8198867dfb84c691a`；按明确一次性例外替换原对象，旧发行[双份归档](handoffs/v1.3.4-original-release-archive.md)保留。
- 主数据/提醒状态/设置格式8/2/3；资料仍在解压目录data中，不需要账户、云数据库或浏览器存储。
- 本地可选提醒由用户电脑调度；不能读取个人授权码或用真实邮箱替代合成验收。

## Product invariants

- 学者优先、期刊其次、关键词家族用于突出已关注对象，不能变成无限制关键词信息流。
- 不能只按姓名、机构、宽泛主题或合作者自动合并学者。
- 兼容迁移保留订阅、跟随日期、文章状态、翻译、缓存、提醒账本与设置；失败保留旧资料。
- 私人data、凭据、个人路径、缓存、PID和调度状态不得提交或打入发行包。
- 各平台共用应用/服务实现及产品版本。

## Current work

[三平台重新发行目标](plans/v1.3.4-three-platform-reissue.md)已完成，状态Released（有限验收），等待用户验收。
共享lint/build、Node186/UI39；Mac各73项及8阶段原包smoke；Windows自动40项（迁移32项）和真实UAC通过。
公开六文件重新下载SHA256/CRC/sidecar/元数据通过，未改验收后的ZIP。
发行与最终交接位于codex/v1.3.4-reissue，**未合并或推送main**；main仍0a2372bc8aed81660871485100a7cf58d19dc2e3。
原主目录五项未提交文档及其他隔离工作区保留。v1.4.0仍Proposed、未批准实施。

## Remaining limits

macOS未签名/公证；Finder/Gatekeeper、真实登录注销、睡眠唤醒、整机重启、无法安全隔离的查询ACL、另一管理员身份和真实邮件未覆盖。
Mac enabled override空记录与历史失败清理证据详见交接，不声称零历史残留或整体Verified。升级请保留旧文件夹和资料备份。

## Read next

每个任务先读AGENTS.md、本文件、[ACTIVE](work/ACTIVE.md)及对应已批准计划。
行为/持久化/迁移读ARCHITECTURE.md；平台/打包读PLATFORMS.md；版本/发布读RELEASING.md和PROJECT_STATE.md；
任务边界读WORKFLOW.md。保留共享实现、pnpm/Vinext与.openai/hosting.json，不自动按名称合并学者。
