# 版本与发布流程

## 核心原则

- `main` 始终保持可发布；每个明确目标使用短期分支。
- Windows 与 macOS 只维护一套共同源码，不建立永久平台分支。
- 正常公开版本的所有平台文件必须来自同一个 Git 提交和同一个标签。
- 已发布标签不可移动、覆盖或复用。
- 对话记录不是版本依据；Git、`AGENTS.md` 和 `docs/` 才是长期记录。

## 版本编号

公开版本使用 `主版本.次版本.修订版本`：

- `1.1.2`：兼容性缺陷修复。
- `1.2.0`：增加向后兼容的新能力。
- `2.0.0`：数据格式或使用流程存在不兼容变化。

尚未稳定的版本使用预发布编号，例如 `1.2.0-beta.1`。为已经固定的
Windows `v1.1.1` 补做首个 Mac 测试包时，不移动 `v1.1.1` 标签；使用独立测试
标签 `macos-v1.1.1-beta.1`，程序内部版本仍为 1.1.1。
这个测试标签是一次性平台启动例外；必须同时重跑 Windows 回归测试，但不得覆盖现有
`v1.1.1` Release。

## 日常开发

1. 从最新 `main` 为一个目标建立短期分支，例如
   `codex/macos-portable-v1.1.1` 或 `codex/fix-journal-search`。
2. 每次提交表达一个完整意图，并更新相应测试和项目文档。
3. 推送分支并建立 Pull Request，检查代码差异和自动测试。
4. 验证通过后合并到 `main` 并删除短期分支。
5. 用户可感知的变化写入 `CHANGELOG.md`；当前状态写入
   `docs/PROJECT_STATE.md`。

不要把 Windows 成品 ZIP 当成 Mac 构建输入。两个平台都必须由共同源码构建。

## 自动验证

基础验证：

1. `pnpm lint`
2. `pnpm build`
3. `node --test tests/*.test.mjs`（`dist` 已由上一步生成）

平台包还必须验证：

- 最终包可在对应原生 runner 启动；
- 首页和 `/api/runtime-status` 返回成功；
- `/api/local-data` 首次为空白且使用当前数据版本；
- 写入数据、停止并重启后数据仍然存在；
- 自动关闭机制能在最后一个页面会话结束后停止服务器；
- ZIP 中没有 `data/`、设置文件、密钥、个人路径、开发依赖或缓存；
- 可执行权限、根目录结构、版本号和 SHA-256 正确。

## 正常公开发布

本节描述 Windows 包装接入同一 tag-driven workflow 后的下一里程碑目标；当前
`macOS portable beta` 工作流没有标签触发，也不生成 Windows ZIP，不能按本节执行正式发布。

1. 确认工作区干净，且不存在个人数据、密钥、缓存或旧构建产物。
2. 更新 `package.json`、`CHANGELOG.md`、`docs/PROJECT_STATE.md` 和发布日期。
3. 完成本地基础验证并提交：`chore: release vX.Y.Z`。
4. 在该提交创建带说明的 `vX.Y.Z` 标签并推送。
5. GitHub Actions 从该标签生成并原生测试：
   - Windows x64 ZIP；
   - macOS Apple Silicon ZIP；
   - macOS Intel ZIP。
6. 所有任务通过后，将三个文件附加到同一个 GitHub Release。
7. 下载一次发布附件并核对 SHA-256；在 `CHANGELOG.md` 或 Release 说明中记录。

推送、建立 Release、配置 Apple 凭据、签名和公证都是外部操作，执行前必须得到
使用者明确授权。

## v1.1.1 Mac 启动阶段

1. 保持现有 `v1.1.1` 标签不变。
2. 从 `main`/`v1.1.1` 建立 worktree 和
   `codex/macos-portable-v1.1.1` 分支。
3. 确认共享数据目录策略，并加入 Mac 启动/导入工具、双架构打包和原生测试。
   普通文件夹布局继续使用脚本旁的 `data/`；只有打包布局确有需要时才增加数据目录参数。
4. 生成不含数据和密钥的未签名 beta 包。
5. 合并到 `main` 后再使用 `macos-v1.1.1-beta.1` 测试标签，重跑 Windows 回归并由
   真实 Mac 用户完成首次启动验证。
6. 将打包基础设施合并到 `main`；待 Windows 包装也接入同一发布工作流后，正常标签才可
   自动生成全部受支持平台包。当前 Mac beta 工作流不得被描述为完整的正式发布流水线。

当前仓库中的 beta 生成入口是 GitHub Actions 的 `macOS portable beta`
`workflow_dispatch`。它先在 Windows 重跑 lint、build 和全部离线测试，再分别在
`macos-15`（arm64）与 `macos-15-intel`（x64）原生构建和 smoke，成功后上传：

- `Anthropology-Canteen-macOS-Apple-Silicon-arm64-v1.1.1.zip` 及 SHA-256；
- `Anthropology-Canteen-macOS-Intel-x64-v1.1.1.zip` 及 SHA-256。

该工作流只生成有 14 天保留期的 Actions artifacts，不创建或移动标签，不创建
GitHub Release，也不签名或公证。合并后若决定使用一次性测试标签，另行明确授权创建
`macos-v1.1.1-beta.1`；不得把它改写成 `v1.1.1`，也不得覆盖现有 Windows Release。

每个 Mac 原生 job 必须从共同源码重新构建，校验 runner 与随包 Node 架构，检查首次
version 7 空白数据、PUT 后重启持久化、导入及备份、最后 SSE 断开约 8 秒退出、单根目录、
ZIP 执行权限、SHA-256 和隐私黑名单。Actions 通过后仍需真人完成 Finder、Gatekeeper、
默认浏览器与字体显示检查；Apple Silicon 必测，Intel 强烈建议测试。

## 数据与隐私检查

- `data/`、`.env*`、API Key、PID、缓存和个人绝对路径不得进入 Git 或 ZIP。
- 分享包首次启动必须为空白。
- 升级工具只迁移 Anthropology Canteen 自己的数据和设置，不触碰其他应用数据。
- 发布前扫描压缩包内部路径，而不只检查源文件夹。

## 简单决策法

先问：“升级后，原来的数据和用法仍兼容吗？”

- 兼容，只修问题：增加修订版本。
- 兼容，增加能力：增加次版本，修订版本归零。
- 不兼容：增加主版本，其余归零。
