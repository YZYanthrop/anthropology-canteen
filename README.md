# Anthropology Canteen 便携版

这是一个本地运行的版本，自带运行环境。使用者不需要安装 Node.js，也不需要账号。

当前正式版本：[v1.2.0](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.2.0)。

当前源码与便携包候选版本为 `v1.3.0`，尚未创建或发布新的 GitHub Release。

## v1.3.0 本机邮件提醒（可选）

- 不需要托管服务器，也不需要网页持续打开。Windows 使用当前用户的任务计划程序，macOS 使用用户级 LaunchAgent；到点启动一次性检查进程，完成后自动退出。
- 支持 QQ、163、126、Yeah、Gmail 应用专用密码、iCloud App 专用密码和自定义 SMTP。Outlook/Hotmail/Live 在本版可作为收件地址；暂不作为发件地址（OAuth2 发件会在后续版本考虑）。
- 只能填写授权码或应用专用密码，不能填写邮箱主密码。465 必须 TLS，587 必须 STARTTLS；禁止 25 端口和忽略证书错误。
- 第一次启用只建立当前成果基线；新增关注项也只从关注时起算。邮件提醒账本与网页未读状态独立，不会把历史发表变成几百条未读。
- 电脑关机、用户未登录或断网时不能准点发信；登录或唤醒后会补跑，且同一成果不会重复发送。没有新内容时不发邮件。
- 凭据不会写入浏览器、普通设置响应、日志或分享包：Windows 使用 DPAPI，macOS 使用登录钥匙串。分享前不要把运行过的 `data/` 文件夹一起发送。

## v1.2.0 三平台发布

- 本次版本用于把此前分别发布的 Windows 1.1.1 与 macOS 1.1.1 beta 整理为共同的
  三平台发布基线，不改变账号、存储、学者身份或信息流架构。
- 唯一的页面内容调整是移除右侧栏中的人类学家引文；其余产品功能保持不变。
- Windows x64、macOS arm64 与 macOS x64 必须从同一提交读取同一个 `package.json`
  版本并分别在原生 runner 构建、测试。
- 三个平台从同一个 `v1.2.0` 标签分别在原生 runner 构建和测试，并发布在同一个
  GitHub Release 中。
- 本地数据仍为 version 7，API-key settings 仍为 version 2；从 1.1.1 更新不需要新的
  数据迁移。
- Windows 与 macOS 使用同一个事务式导入器：导入前验证 data/settings schema、检查
  正在运行的服务并备份目标；失败导入不会覆盖原有数据。

## macOS 便携版说明

- v1.2.0 未签名便携包分别为
  `Anthropology-Canteen-macOS-Apple-Silicon-arm64-v1.2.0.zip` 与
  `Anthropology-Canteen-macOS-Intel-x64-v1.2.0.zip`，都自带 Node.js 24.14.0。
- 最低系统要求是 macOS 13.5；更早版本的 macOS 不在随包
  Node.js 24.14.0 的支持范围内。
- 完整解压后，Finder 双击 `Anthropology Canteen.command` 是推荐主入口；它会短暂显示
  Terminal，服务器就绪并打开浏览器后脚本退出，服务器继续在后台运行。
  `start-local.command` 是需要保留 Terminal 窗口的诊断入口。本版本不提供 `.app`，
  以避免未签名下载应用发生 App Translocation 后找不到同目录运行文件。
- 首次打开未签名版本时，只通过 Finder 的“打开”或“隐私与安全性”批准这个具体项目；
  不要关闭 Gatekeeper，也不要降低系统整体安全设置。
- 数据仍写在当前解压文件夹的 `data/`。旧版导入工具只接受
  `anthropology-canteen-data.json`（或直接包含它的 `data` 文件夹），验证支持的数据/
  设置 schema、检查正在运行的服务器、备份目标文件，并只在同目录存在时迁移设置文件。
- 原生 Actions 会检查双架构启动、持久化、导入、SSE 自动关闭、ZIP 隐私和执行权限；
  Finder、Gatekeeper、默认浏览器和字体显示仍需真人 Mac 测试。Apple Silicon 已有
  v1.1.1 beta 的 M2 真人验证记录；Intel 真人测试仍强烈建议完成。

## 学者发现与作者档案

- “按姓名”输入至少两个字符便会自动推荐，不区分大小写。完整姓名、部分姓名及常见错拼都可以检索；中文姓名会同时尝试常见拼音顺序。
- 配置免费的 OpenAlex API Key 后，会使用最接近 1.0.0 的 OpenAlex 作者主档案搜索，错拼容错、单位、研究方向和最新发表最完整。未配置时使用 Semantic Scholar，并由 Crossref 补充经过身份筛选的新成果。
- 每条学者搜索结果会突出显示“最可能的主档案”、成果总数和最近一项发表；同名的少量成果碎片会排在后面，方便甄别。
- 可填写单位、研究方向及机构个人主页来甄别同名学者；结果中会展示别名、机构、方向和代表作。
- “按代表作”支持论文或书籍题目、DOI、ISBN、ORCID、OpenAlex 或 Semantic Scholar 链接；图书会同时查询 Open Library。
- 文献卡片中的作者姓名可以点击；有稳定作者 ID 时直接打开内部档案，只有姓名时会结合当前文献让使用者确认。
- 姓名模式始终坚持“一条稳定作者 ID 对应一张候选卡”。姓名、单位、宽泛主题或共同作者不会再把不同 ID 自动拼成一个档案。
- Semantic Scholar 被限流时，Crossref 只生成一张按完整姓名和人类学证据筛选的临时候选卡，不会把每篇论文分别列成一位学者；临时候选会明确标注自动追踪可能不完整。
- Crossref 补充成果必须通过 DOI、ORCID、单位或明确的人类学证据；同名医学、肿瘤学或化学论文不会进入人类学家档案。
- 学者姓名优先采用索引的规范写法。即使输入 `cheryl mattingly`、`veena das` 或 `jason throop`，关注列表也不会保存成全小写。
- 点击“查看档案”后，OpenAlex 会分页读取历史发表，Semantic Scholar 最多读取 1,000 项，随后按 DOI 或题名年份去重并按年份倒序。
- 关注过或打开过的学者档案会连同历史发表保存在本地数据文件中。24 小时内再次打开会立即显示缓存；过期后先显示旧内容再刷新，成功刷新会替换曾经误收的旧成果。
- 学者总览卡片保持等高；档案中的发表若带有公开摘要，可以点击“展开摘要”，摘要也会随档案一起缓存。
- 信息流六小时内优先使用本地缓存；OpenAlex 为空或失败时会继续尝试已确认的 Semantic Scholar ID。
- 内置的人类学期刊（包括 Ethos、HAU、Ethnos、Current Anthropology 等）搜索会立即返回；其他期刊再查询 OpenAlex 与 Crossref。
- 邮件提醒在“设置 → 邮件提醒”中启用；必须先发送测试邮件，成功后才能安装系统计划任务。

## 启动

1. 完整解压整个 ZIP 文件。
2. 双击 `Anthropology Canteen.vbs`。
3. 程序会在后台运行，不会出现需要一直保留的黑色窗口。
4. 网页准备好后会自动打开。默认使用
   `http://anthropology-canteen.localhost:3000`；如果另一个解压副本仍在运行，
   当前版本会自动选择后续本地端口，避免误打开旧文件夹。

备用地址：

- `http://localhost:3000`
- `http://127.0.0.1:3000`

关闭最后一个 Anthropology Canteen 网页后，后台程序会在约 8 秒内自动停止。
刷新网页不会误关程序；如果同时打开了多个页面，需要全部关闭。
下次使用时只需再次双击 `Anthropology Canteen.vbs`。

如果无窗口启动失败，可以双击 `start-local.cmd` 查看具体错误提示。

## 更新版本

推荐使用并排更新，不要把新版覆盖解压到旧程序文件夹：

1. 关闭旧版的所有 Anthropology Canteen 网页并等待约 10 秒；更早版本则关闭黑色窗口或使用旧版关闭脚本。
2. 将新版 ZIP 解压成独立文件夹，并放在旧版文件夹旁边。
3. 启动新版；只要新版数据仍为空，它会继续寻找旁边保存时间最新的旧版数据。
4. 如果自动迁移没有发生，双击新版中的 `import-data-from-old-version.cmd`，把旧版的
   `data` 文件夹拖入窗口并回车。
5. 确认关注项、收藏和提醒设置无误后再删除旧版文件夹。

## 数据保存

- 这个分享版第一次打开是空白的，不预置任何个人关注项。
- 每位使用者添加的期刊、学者、关键词、收藏、已读状态、最近一次成功读取的文章列表、已经加载过的学者档案，以及点击生成过的中文摘要，会保存在解压文件夹里的 `data/anthropology-canteen-data.json`。
- 可选的 OpenAlex 与 Semantic Scholar API Key 单独保存在 `data/anthropology-canteen-settings.json`。网页只显示是否已配置及末四位，不会把完整 Key 返回到页面。
- 邮件提醒配置保存在同一 settings 文件；提醒基线与待发送账本保存在 `data/anthropology-canteen-reminder-state.json`。Windows 的 DPAPI 密文在 `data/anthropology-canteen-reminder-secret.json`，macOS 凭据只在登录钥匙串中。停用提醒会移除系统任务；“停用并删除授权码”还会清除凭据。
- 这些数据不会写回原始 ZIP 文件，也不会同步给其他人。
- 想把空白版发给别人时，请发送原始 ZIP；不要发送自己已经运行过、带有 `data` 文件夹的使用中副本，因为其中可能同时包含关注数据和 API Key。
- 如果想把自己的全部配置带到另一台电脑，可以复制整个解压后的文件夹或整个 `data` 文件夹；只复制 `anthropology-canteen-data.json` 不会带走 API Key。
- 如果想恢复空白状态，先关闭所有 Anthropology Canteen 网页并等待约 10 秒，再删除 `data/anthropology-canteen-data.json`。
- 如果把整个使用中文件夹复制到新位置，设置中的提醒会显示仍绑定旧路径；在“邮件提醒”窗口点击“迁移到当前文件夹”会覆盖同一个系统任务，避免重复发信。
- 新版第一次打开时，如果发现浏览器里有旧版保存的数据，会自动迁移到上面的 `data` 文件中，并清除 Anthropology Canteen 自己的旧浏览器记录。
- 学术数据检索和中文翻译仍然需要联网。
- 关注学者或期刊之前发表的历史成果会保留在档案中供查阅，但不会计入“未读”；未读从实际关注日期开始计算。
- v1.3.0 的研究数据仍为 version 7；settings 从 version 2 升级到 version 3 时会保留原有 API Key。关注项、关注日期、收藏、已读、忽略和中文翻译都会保留。

## 更新版本时保留自己的数据

推荐做法：

1. 不要删除旧版文件夹。
2. 把新版 ZIP 解压到旧版文件夹旁边，例如两个文件夹都放在桌面或同一个资料夹里。
3. 双击新版里的 `Anthropology Canteen.vbs`。
4. 如果新版自己的 `data` 文件还不存在，它会自动寻找旁边旧版文件夹里的关注数据和接口设置，并把保存时间最新的那份复制到新版。

如果自动迁移没有发生，优先使用事务式导入工具；不要在任一版本仍在运行时手动覆盖
`data` 文件。

## 注意

- 不要在 ZIP 压缩包预览窗口中直接运行，必须先完整解压。
- 不要单独复制启动文件；必须保留整个文件夹。
- 不需要账号或数据库。

## 可选：配置免费 API Key

1. 打开“添加关注 → 学者 → 接口设置”。
2. OpenAlex Key 用于稳定的作者主档案搜索、单位、主题、错拼和最新成果；点击页面中的链接申请并复制 Key。
3. Semantic Scholar Key 不是必需项，但可减少连续姓名查询时的限流；也可通过页面中的链接申请。
4. 将需要的 Key 分别粘贴回 Anthropology Canteen，点击“保存到本地”。

两种 Key 都只保存在当前解压文件夹。发送空白原始 ZIP 不会泄露它们；不要把已经运行过且带有 `data` 文件夹的副本直接发给别人。

## 运行环境说明

本便携版内含 Node.js 24.14.0 可执行程序，仅用于启动本地网页。Node.js 依其开源许可分发：
https://github.com/nodejs/node/blob/v24.14.0/LICENSE

## 源码开发

需要 Node.js 22.13.0 或更高版本，以及 pnpm 11.9.0。

```powershell
pnpm install
pnpm dev
```

发布前检查：

```powershell
pnpm lint
pnpm build
node --test tests/*.test.mjs
```

版本编号和发布流程见 [`docs/RELEASING.md`](docs/RELEASING.md)，版本变更见
[`CHANGELOG.md`](CHANGELOG.md)。

## 许可证

创作者：[YZYanthrop](https://github.com/YZYanthrop)

本项目由 YZYanthrop 创作，并采用 [MIT License](LICENSE) 开放使用。
