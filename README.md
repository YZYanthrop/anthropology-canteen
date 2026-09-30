# Anthropology Canteen

Anthropology Canteen 是在自己电脑上运行的人类学研究追踪工具。它不需要账号、云数据库，也不需要单独安装 Node.js（便携包自带的运行环境）；关注记录和设置保存在解压后的程序文件夹内。Windows 64 位、macOS Apple Silicon 和 macOS Intel 均有便携包。

当前正式版本是 [Anthropology Canteen v1.3.4 Release（正式下载页）](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.3.4)。

v1.3.4 已发布，但未全部 Verified。macOS 版为实验性版本，尚未完成 v1.3.4 的 macOS 原生验收，后台提醒、资料迁移及失败恢复仍存在未验证风险。升级前请保留旧版文件夹和资料备份。

Windows 另一管理员身份、真实任务读取权限拒绝及已有任务取消场景仍未验证。 详见[发布说明](docs/releases/v1.3.4.md)。

## 第一次使用：4 步开始

1. 打开 [v1.3.4 正式下载页](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.3.4)。
2. 根据电脑类型下载下方三个 ZIP（压缩包）之一。
3. 在文件管理器中把 ZIP 完整解压到一个独立文件夹。
4. 运行对应系统的推荐启动器：
   - Windows：双击 `Anthropology Canteen.vbs`。
   - macOS：双击 `Anthropology Canteen.command`。

不要在 ZIP 预览窗口内双击启动文件。不要只复制其中一个启动文件；运行时需要保留完整的解压文件夹。

## 选择正确的 v1.3.4 下载包

### Windows 64 位电脑

下载：`Anthropology-Canteen-Windows-x64-v1.3.4.zip`

这是面向 64 位 Windows 的便携包。

### M1、M2、M3、M4 等 Apple 芯片 Mac

下载：`Anthropology-Canteen-macOS-Apple-Silicon-arm64-v1.3.4.zip`

这类 Mac 在“关于本机”中会显示 Apple M 系列“芯片”。

### Intel 处理器 Mac

下载：`Anthropology-Canteen-macOS-Intel-x64-v1.3.4.zip`

如果不确定 Mac 类型，请打开“ → 关于本机”。看到“芯片：Apple M…”时选择 Apple Silicon arm64；看到“处理器：Intel…”时选择 Intel x64。

在 Release 页的“Assets”区域下载上述 ZIP。普通使用不需要下载同名 `.sha256` 文件；它只用于后文的可选完整性校验。不要选择 GitHub 自动生成的“Source code (zip)”或“Source code (tar.gz)”，它们是给开发者看的源码，不是可直接启动的便携包。

## Windows：启动与诊断

Windows 便携包支持 64 位 Windows 10 或更新版本。

### 正常启动

1. 打开完整解压后的文件夹。
2. 双击 `Anthropology Canteen.vbs`。
3. 等待默认浏览器自动打开 Anthropology Canteen。

推荐始终使用 `Anthropology Canteen.vbs`。它会在后台启动程序，不需要一直保留黑色命令窗口。

正常启动不需要管理员权限。如果双击后没有打开网页，请双击同一文件夹中的 `start-local.cmd`，并保留窗口以查看诊断信息。

### 邮件提醒的 Windows 权限确认

首次开启邮件提醒时，部分 Windows 系统仍可能要求管理员权限。更新旧版的后台提醒时，新版会先以普通权限尝试；确有需要时，只对更新任务的小工具显示一次 Windows 权限确认，不必关闭整个应用或以管理员身份重新启动。

若首次开启提醒仍显示权限不足，可按以下步骤重试：

1. 关闭所有 Anthropology Canteen 页面。
2. 等待约 10 秒。
3. 右键 `start-local.cmd`。
4. 选择“以管理员身份运行”。
5. 重新尝试开启邮件提醒。

任务注册后的提醒仍以当前用户和有限权限运行；日常启动仍应双击 `Anthropology Canteen.vbs`，不需要管理员权限。

## macOS：启动与诊断

v1.3.4 的 macOS 便携包最低支持 macOS 13.5。Apple Silicon 和 Intel 包都未签名、未公证。

### 正常启动

1. 在 Finder 中打开完整解压后的文件夹。
2. 双击 `Anthropology Canteen.command`。
3. 等待默认浏览器自动打开 Anthropology Canteen。

Terminal 可能短暂出现；浏览器打开后不需要一直保留它。如果程序没有启动，请双击 `start-local.command`，并保留 Terminal 窗口以查看诊断信息。

### 首次批准当前下载项目

如果 macOS 提示无法验证开发者：

1. 在 Finder 中右键或按住 Control 键点击 `Anthropology Canteen.command`。
2. 从菜单中选择“打开”。
3. 在确认窗口中再次选择“打开”。

如果仍被阻止，请前往“系统设置 → 隐私与安全性”，只批准这次下载的 Anthropology Canteen 项目。不要关闭 Gatekeeper（macOS 的下载安全检查），也不要降低系统整体安全设置。

## 关闭应用

关闭所有 Anthropology Canteen 浏览器页面后，后台程序通常会在约 8 秒内停止。下次使用时，重新运行所属平台的推荐启动器即可。

## v1.3.4 有什么新变化

- 后台提醒更新失败时恢复原任务及记录；恢复未完成会明确提示。
- 资料迁移失败时区分已恢复与恢复未完成，保留备份和恢复材料。
- 后台状态区分已开启、已停用、需要更新、任务不存在和无法核对，不自动重新开启停用任务。
- 寻找旧版本失败不影响读取当前正常资料，不用空白文件覆盖已有资料。

完整版本记录见 [`CHANGELOG.md`](CHANGELOG.md)。

### 更新情况与关注操作

- “更新情况”统计本次检查的学者和期刊关注项，关键词组只用于匹配文章。
- “已完成检查”不等于有新文章，也不保证数据来源已收录全部成果。
- 部分数据来源暂时无法查询时会明确提示；全部检查失败时继续显示上次保存的内容。
- 上次成功取得数据的时间与本次检查结果分开显示；从本地读取的旧检查结果会明确标注。
- 桌面关注栏内容较多时可以单独滚动，也可用 Tab 键进入后通过方向键或翻页键浏览。
- 触摸设备直接显示“取消关注”按钮；取消关注不会清除已经保存的文章状态和翻译。
- 自动升级会从同一个旧版文件夹保留邮件设置、提醒发送记录和 Windows 加密授权码；不会自动发信或创建后台任务。
- Windows 更新后台提醒时，应用会先尝试普通更新；确有需要时只为任务小工具显示一次系统权限确认，应用和日常提醒仍以普通权限运行。
- 同一提醒身份重复更新不会增加任务；无法确认归属的旧任务会保留并提示手动核对。

## 更新旧版本且保留数据

1. 关闭旧版的全部 Anthropology Canteen 页面。
2. 等待约 10 秒，让旧版后台程序退出。
3. 把 v1.3.4 ZIP 解压到新的独立文件夹，不要覆盖旧版文件夹。
4. 启动新版，让它优先尝试从旁边的旧版文件夹自动迁移数据。
5. 核对关注项、收藏、忽略状态、翻译、API Key、邮件提醒设置、授权码状态和上次发送记录。
6. 确认新版数据完整后，再决定是否删除旧版文件夹。

请保留旧版文件夹，直到核对完成。迁移不要求手工编辑 JSON 数据文件。
如果页面显示“设置已保留，请将后台提醒更新到当前文件夹”，请使用页面中的
“更新后台提醒到当前文件夹”按钮。Windows 可能要求确认一次权限；只提升任务小工具，
不要求重新填写授权码，也不让应用或日常提醒长期使用管理员权限。
如果旧版来源无法唯一确认或授权码无法由当前账户读取，程序会保留现有文件并提示使用下方手动导入工具。

### Windows 自动迁移没有发生

1. 关闭新旧两个版本的全部页面。
2. 双击新版中的 `import-data-from-old-version.cmd`。
3. 把旧版的 `data` 文件夹拖入窗口并按 Enter。

### macOS 自动迁移没有发生

1. 关闭新旧两个版本的全部页面。
2. 双击新版中的 `import-data-from-old-version.command`。
3. 按窗口提示选择旧版数据。

两个平台使用同一套事务式导入逻辑：导入前会验证格式并备份目标文件，失败时不会留下部分替换的数据。

## 重要：保护自己的数据

> 从 v1.3.4 Release 下载的三个正式便携包 ZIP 都是空白分享包，不含个人关注记录、API Key、邮件地址、提醒状态或授权码。分享给别人时，请发送原始便携包 ZIP，不要发送自己已经运行过的文件夹。

- 第一次运行后，解压文件夹中会出现 `data/`。它可能包含关注记录、收藏、忽略状态、翻译、API Key、邮件提醒设置和提醒历史。
- Windows 的 `data/` 还可能包含由 DPAPI 加密的邮件授权码。DPAPI 是 Windows 自带的、与用户账户绑定的加密方式；其密文不能当作可在任意 Windows 账户或电脑上直接使用的密码备份。
- macOS 的邮件授权码保存在当前用户的登录钥匙串中，不写入空白 Release ZIP。
- 数据不会写回原始 ZIP，也不会自动同步到云数据库。
- 学术数据检索、中文翻译和可选邮件发送需要联网，并会访问相应的外部服务。

## 常见问题

### 双击后没有打开网页

先等待片刻，再使用诊断启动器。

- Windows：双击 `start-local.cmd`，并保留窗口查看提示。
- macOS：双击 `start-local.command`，并保留 Terminal 窗口查看提示。

### 在 ZIP 预览窗口中无法运行

返回下载目录，把整个 ZIP 完整解压到新文件夹，再从解压后的文件夹启动。不要把单个启动文件拖出 ZIP 单独运行。

### 浏览器打开了旧版本

关闭所有 Anthropology Canteen 页面，等待约 10 秒，然后从 v1.3.4 的新文件夹重新启动。启动器会核对程序文件夹，并在旧副本仍占用端口时尝试其他本地端口；若仍不正确，请运行所属平台的诊断启动器。

### macOS 提示无法验证开发者

在 Finder 中对 `Anthropology Canteen.command` 使用“打开”。如果仍被阻止，只在“系统设置 → 隐私与安全性”中批准当前下载项目。不要关闭 Gatekeeper。

### Windows 邮件提醒第三步无法变绿

首次开启提醒若权限不足，可关闭全部页面并等待约 10 秒，再右键 `start-local.cmd` 以管理员身份运行一次。更新旧版后台提醒时直接使用页面中的“更新后台提醒到当前文件夹”；如果 Windows 要求权限确认，只会提升任务小工具。只有第三步变绿并显示“后台提醒已开启”才表示任务已注册；日常启动不需要管理员权限。

### 自动迁移没有发生

确认新版解压在新的独立文件夹，并尽量与旧版文件夹放在同一位置。关闭两个版本后再启动新版；仍未迁移时，使用上方对应平台的事务式导入工具。不要手工修改 JSON。

## 可选功能：API Key 与邮件提醒

首次启动不要求配置任何 Key，也不要求开启邮件提醒。这两类功能都可以以后再设置。

### API Key

API Key 是学术数据服务提供的访问凭证。可选的 OpenAlex 和 Semantic Scholar API Key 能改善部分学者检索或减少限流，但不是使用基本功能的前提。

可在应用的“添加关注 → 学者 → 接口设置”中配置。Key 只保存在当前解压文件夹的设置文件中；不要分享已经运行过的文件夹。

### 邮件提醒与 SMTP

SMTP 是邮箱的发信服务器设置。邮件提醒是可选的本机功能：Windows 使用当前用户的任务计划程序，macOS 使用当前用户的 LaunchAgent（定时启动任务）。网页关闭后，系统任务仍可按设置尝试检查更新。

- 只使用邮箱授权码或应用专用密码，不要填写邮箱主密码。
- 电脑需要开机、用户需要登录，并且网络可用；提醒不能保证在关机或断网时准点送达。
- 没有新文章时不会发送邮件。
- Windows 使用用户账户绑定的 DPAPI 加密授权码；macOS 使用登录钥匙串。

更完整的平台限制见 [`docs/PLATFORMS.md`](docs/PLATFORMS.md)。

## 数据文件与兼容版本

普通使用者不需要直接打开或编辑这些文件。它们位于解压文件夹的 `data/` 中；下方的 schema 指数据文件的格式版本：

- `anthropology-canteen-data.json`：关注、文章状态、翻译和缓存；v1.3.4 使用主数据格式 8。
- `anthropology-canteen-settings.json`：API Key 和提醒配置；v1.3.4 使用设置格式 3。
- `anthropology-canteen-reminder-state.json`：提醒基线、待发送记录和发送历史；v1.3.4 使用提醒状态格式 2。
- `anthropology-canteen-reminder-secret.json`：仅 Windows 使用的 DPAPI 加密授权码文件。

自动迁移和事务式导入会验证受支持的数据格式，并尽量保留关注日期、收藏、已读、忽略、翻译、API Key、提醒设置、提醒发送记录和 Windows 加密授权码。自动迁移只从同一个旧版文件夹取这些资料，不会把多个旧版本拼在一起。请在确认新版内容无误之前保留旧版文件夹。

## 可选：用 SHA-256 核对下载

SHA-256 是文件的数字摘要，可用于检查下载是否完整。每个正式 ZIP 在 Release 中都有一个同名 `.sha256` 小文件。普通使用者可以直接下载并使用 ZIP；这项校验是可选的，不应阻挡首次使用。

Windows PowerShell 示例：

```powershell
Get-FileHash ".\Anthropology-Canteen-Windows-x64-v1.3.4.zip" -Algorithm SHA256
```

macOS Terminal 示例：

```bash
shasum -a 256 "Anthropology-Canteen-macOS-Apple-Silicon-arm64-v1.3.4.zip"
shasum -a 256 "Anthropology-Canteen-macOS-Intel-x64-v1.3.4.zip"
```

把命令显示的 64 位摘要与相应 `.sha256` 文件中的摘要比较即可。

## 运行环境与源码开发

便携包已包含 Node.js 24.14.0，仅用于运行本地应用。其许可见 [Node.js 24.14.0 LICENSE](https://github.com/nodejs/node/blob/v24.14.0/LICENSE)。

只有参与源码开发时，才需要另行安装 Node.js 22.13.0 或更高版本，以及 pnpm 11.9.0。

```powershell
pnpm install
pnpm dev
```

开发验证命令：

```powershell
pnpm lint
pnpm build
pnpm test:ui
node --test tests/*.test.mjs
```

## 详细文档

- [版本变化记录](CHANGELOG.md)
- [平台支持、启动器和打包边界](docs/PLATFORMS.md)
- [版本编号与发布流程](docs/RELEASING.md)
- [应用架构与数据边界](docs/ARCHITECTURE.md)

## 许可证

Anthropology Canteen 由 [YZYanthrop](https://github.com/YZYanthrop) 创作，并采用 [MIT License](LICENSE) 开放使用。
