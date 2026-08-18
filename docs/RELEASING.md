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
- `1.3.0`：增加向后兼容的本机邮件提醒、凭据安全存储和跨平台计划任务。
- `2.0.0`：数据格式或使用流程存在不兼容变化。

尚未稳定的版本使用预发布编号，例如 `1.2.0-beta.1`。为已经固定的
Windows `v1.1.1` 补做首个 Mac 测试包时，不移动 `v1.1.1` 标签；使用独立测试
标签 `macos-v1.1.1-beta.1`，程序内部版本仍为 1.1.1。
这个测试标签是一次性平台启动例外；必须同时重跑 Windows 回归测试，但不得覆盖现有
`v1.1.1` Release。

v1.3.0 的邮件提醒是可选的本机能力，不依赖托管服务器。正式发布前必须在 Windows
x64、macOS arm64 和 macOS x64 原生 runner 完成提醒 worker 的离线测试、空白包隐私
扫描和启动 smoke；真实邮箱投递作为人工验收，已由使用者确认测试邮件可以收到。
不得把任何邮箱地址、授权码或任务注册信息写入提交、标签或 Release 附件。

## v1.3.0 源码交接

- 交接后的本地 `main` HEAD 和由该提交生成的单根目录源码 ZIP 是下一打包任务的共同
  源码基线；不得把 Windows 本机测试 ZIP 当作 Windows 正式包或 macOS 构建输入。
- 下一任务必须从同一个最终提交分别构建 Windows x64、macOS arm64 和 macOS x64，
  并在相应原生环境运行启动、持久化、提醒调度、凭据存储和空白包隐私测试。
- 该源码交接阶段已完成；正式发布通过同一最终提交的候选构建和标签构建完成。发布
  不签名或公证，除非另行取得 Apple Developer 身份与明确授权。

## 日常开发

1. 从最新 `main` 为一个目标建立短期分支，例如
   `codex/macos-portable-v1.1.1` 或 `codex/fix-journal-search`。
2. 每次提交表达一个完整意图，并更新相应测试和项目文档。
3. 推送分支并建立 Pull Request，检查代码差异和自动测试。
4. 验证通过后合并到 `main` 并删除短期分支。
5. 用户可感知的变化写入 `CHANGELOG.md`；当前状态写入
   `docs/PROJECT_STATE.md`。

不要把 Windows 成品 ZIP 当成 Mac 构建输入。两个平台都必须由共同源码构建。

## Codex 任务分工

Codex 对话只负责组织工作，不代表独立的产品分支。代码、测试、提交和本目录下的
项目文档才是可跨对话恢复的长期记录。

- `first version` 是长期主任务：负责共享源码的功能开发、缺陷修复、数据结构变更、
  版本号决策，以及所有平台验证完成后的统一 GitHub 发布。
- `Mac 适配 vX.Y.Z` 是每个版本单独建立的平台专项任务：从最新 `main` 建立短期分支，
  只处理 Mac 启动器、运行时、打包、权限、Gatekeeper 说明和原生测试；完成后合并回
  `main` 并归档该任务，不保留永久 Mac 产品分支或无限增长的平台对话。
- 类似 `first version (2)` 的派生任务只用于一次性重构、调查或交接。成果提交并合并、
  项目文档更新且后续任务可以独立继续后，即可归档或删除。
- 推送测试分支可以在负责该改动的任务中完成；创建正式版本标签、GitHub Release 和
  发布附件统一回到 `first version`，避免两个任务同时发布同一版本。

源码修改会立即保存在当前工作区，但不会由 Codex 系统自动改写项目文档。每个实现任务
必须在同一改动中主动更新适用的文档；正式发布前由 `first version` 再核对一次：

- 架构、数据格式或当前里程碑：`docs/PROJECT_STATE.md`、`docs/ARCHITECTURE.md`；
- 平台启动、打包或支持状态：`docs/PLATFORMS.md`；
- 分支、验证或发布步骤：`docs/RELEASING.md`；
- 使用者能感知的变化：`CHANGELOG.md`。

未改动相关文档时，不得仅凭某段对话宣称架构、平台状态或发布流程已经改变。

## 自动验证

基础验证：

1. `pnpm lint`
2. `pnpm build`
3. `node --test tests/*.test.mjs`（`dist` 已由上一步生成）

平台包还必须验证：

- 最终包可在对应原生 runner 启动；
- 首页和 `/api/runtime-status` 返回成功；
- 首页明确禁止缓存，并且最终包中的 CSS 和 JavaScript 资源均能成功加载；
- `/api/local-data` 首次为空白且使用当前数据版本；
- 空白首次启动后再放入旁边旧版本时，仍能自动迁移其本地数据；
- 写入数据、停止并重启后数据仍然存在；
- 自动关闭机制能在最后一个页面会话结束后停止服务器；
- ZIP 中没有 `data/`、设置文件、密钥、个人路径、开发依赖或缓存；
- 可执行权限、根目录结构、版本号和 SHA-256 正确。

## v1.2.0 统一发布基线

v1.2.0 是统一三平台发布基线：Windows x64、macOS Apple Silicon arm64 和 macOS
Intel x64 必须读取同一个 `package.json` 版本并从同一 Git 提交构建。本地数据仍为
version 7，API-key settings 仍为 version 2，不需要新增数据迁移。

统一便携包工作流由正常 `vX.Y.Z` 标签触发，也可以手动重新运行一个已经存在的正常
标签。两种入口都只构建、测试并上传有保留期限的工作流产物与 SHA-256，不创建或移动
标签，不创建 GitHub Release，不签名、不公证，也不公开发布。三个正式候选包始终来自
同一个经过校验的标签提交。

v1.3.0 增加一个标签前安全闸门：手动运行可以提供完整的 `candidate_sha`，也可以提供
已有的 `tag`，但两者必须且只能选择一个。`candidate_sha` 运行从最终 `main` 提交在三
个平台原生构建；只有该运行全部通过后，才在完全相同的 SHA 创建不可移动的正常标签。
正式发布附件只允许来自随后标签运行，候选运行产物仅用于审计和验证。

手动重跑既有标签时，必须从 `main` 选择工作流定义并输入完整的正常版本标签；校验 job
使用完全限定的 `refs/tags/vX.Y.Z`，随后把所有平台锁定到解析出的提交 SHA。Windows
smoke 会故意执行一次应被拒绝的无效导入，只有确认该导入精确返回 1 后才清除预期退出码。
工作流通过独立 `pwsh -File` 子进程运行标签内的 smoke，并明确要求子进程正常返回 0；
真实断言或清理失败仍会终止 job。

v1.2.0 的首次标签运行 #31301297604 正是上述负面导入退出码造成的 CI 误报；标签没有移动。
修复经 PR #6 合并后，从 `main` 手动调度既有标签的运行
[#31305111585](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/31305111585)
将所有产物 job 锁定回标签提交 `aa8e3a25dcbe59cd57b83ecd94898efd343d36d0`，三平台、共享测试和源码归档全部通过。
公开 [v1.2.0 Release](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.2.0)
的三个产品 ZIP 与 sidecar 随后都重新下载并通过 SHA-256 核对。

源码归档必须在最终改动已经提交后从 Git 对象生成，而不是压缩当前工作目录。推荐使用
单根目录的 `git archive`，以便只包含受版本控制的源码并排除 `data/`、依赖、构建产物、
缓存和本机文件。v1.2.0 及后续正常版本都遵循下面的公开发布步骤。

## 正常公开发布

本节描述统一 build-only 工作流准备完成后的公开发布步骤。工作流不会自行发布；任何
推送、标签和 GitHub Release 操作仍需单独授权。

1. 确认工作区干净，且不存在个人数据、密钥、缓存或旧构建产物。
2. 更新 `package.json`、`CHANGELOG.md`、`docs/PROJECT_STATE.md` 和发布日期。
3. 完成本地基础验证，在短期分支提交并合并到 `main`。
4. 在创建标签前，用 `candidate_sha` 对最终 `main` 提交完成一次完整原生预检。
5. 预检通过后，在同一 SHA 创建并推送带说明且不可移动的 `vX.Y.Z` 标签。
6. build-only GitHub Actions 从该标签生成并原生测试：
   - Windows x64 ZIP；
   - macOS Apple Silicon ZIP；
   - macOS Intel ZIP。
7. 检查三个标签构建任务、隐私扫描、原生 smoke 和 SHA-256 全部通过。
8. 再次确认发布授权后，将同一标签构建出的三个 ZIP 及其 `.sha256` sidecar 附加到一个
   GitHub Release；不要
   混用手动运行、旧提交或旧平台版本的产物。
9. 从公开 Release 下载发布附件并核对 SHA-256；在 `CHANGELOG.md` 或 Release 说明中记录。

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

该工作流本身只生成有 14 天保留期的 Actions artifacts，不创建或移动标签，不创建
GitHub Release，也不签名或公证。经另行授权后，一次性启动阶段已创建 annotated 标签
`macos-v1.1.1-beta.1`，精确指向运行 #31290870084 的构建提交 `c2ec6d1`，并发布
[macOS v1.1.1 Beta 1 Pre-release](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/macos-v1.1.1-beta.1)。
它没有改写 `v1.1.1`，也没有覆盖现有 Windows Release。

每个 Mac 原生 job 必须从共同源码重新构建，校验 runner 与随包 Node 架构，检查首次
version 7 空白数据、PUT 后重启持久化、导入及备份、最后 SSE 断开约 8 秒退出、单根目录、
ZIP 执行权限、SHA-256 和隐私黑名单。Actions 通过后仍需真人完成 Finder、Gatekeeper、
默认浏览器与字体显示检查；本次已由 Apple Silicon M2 用户确认可以正常启动和试用，
Intel 真人测试仍为强烈建议但尚未记录。

本次发布附件：

- Apple Silicon ZIP SHA-256：
  `679B7EB994EBCDA6B0FC542E3431DE62A14833EA346CCC6B6BC4CF3398C7265B`；
- Intel ZIP SHA-256：
  `666BD2AC0088545CCAC67E8D85697CD0481073C3EFFF7CFC1DBA5E21136C3154`。

发布后已从公开 Release 附件端点重新下载两个 ZIP；重新计算的文件大小和 SHA-256
均与发布前文件及 GitHub 服务器摘要一致。

这一启动阶段完成后，后续版本不得继续使用平台专属正式标签；下一里程碑是由同一个正常
`vX.Y.Z` 标签自动构建、测试并发布 Windows x64、macOS Apple Silicon 和 macOS Intel。

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
