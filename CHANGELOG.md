# 版本记录

本项目从 `v1.0.0` 起采用[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased] — v1.3.4 提醒与迁移安全修复

- 后台任务更新把注册、核对、任务记录及设置写入纳入同一恢复流程；失败后恢复原任务及启用状态，原先没有任务时只清理本次新增。
- 恢复未完成时明确提示并保留恢复材料，重启后仍阻止继续覆盖；取消权限确认不再笼统声称没有更改。
- 更新和恢复不立即检查或发信，保留原登录用户与受限权限；格式仍为 8/2/3。
- A–D 实现及回归代码已本地提交，工作包仍为 In progress；新增实现和完整工作包待独立统一验证，尚未发布。

### Slice B（已实现，待验证）

- 自动迁移和手动导入区分写入失败、确认恢复、恢复未完成及清理失败；保留恢复机会。
- 未完成恢复会阻止重启后的继续覆盖；临时文件在创建前登记，已有新资料与旧版来源受到保护。

### Slice C（已实现，待验证）

- 检查任务与两个触发条件是否启用，区分停用、缺失、需要更新和无法核对；旧记录不再代表运行正常。
- 仅用户明确选择重新开启时改变停用状态，失败按原状态恢复；更新和重新开启不立即检查或发信。

### Slice D（已实现，待验证）

- 查找旧版失败不影响读取当前正常资料；权限错误、扫描期间目录消失与确实没有旧版分开提示。
- 当前资料缺失且扫描失败时不创建空白替代文件，保留旧版本后来出现时的安全发现能力。
- 统一验证修正：旧版提醒身份不可读时停止自动补齐，避免误判唯一来源；导入备份保留既有命名约定。

## [1.3.3] - 2026-09-26

- 触摸设备明确显示“取消关注”，提供至少 44 像素高的点击区域；取消后焦点返回相邻关注项或分组，不清除文章状态和翻译。
- 学者总览卡按稳定关注编号匹配缓存，避免同名学者错误复用另一人的展示身份。
- 桌面左栏可按窗口可用高度独立滚动，短窗口仍能到达首尾关注项；窄屏和极短窗口恢复正常页面滚动。
- “更新健康”改为“更新情况”，用普通中文区分检查完成、部分来源暂时无法查询与未能检查。
- 说明统计对象、检查不保证出现新文章或完整收录，区分旧结果、正在检查和本次结果。
- 尚无结果时不再暗示没有失败；部分完成的通知与摘要一致，全部失败仍保留旧内容及成功时间。
- 自动升级改为从同一个旧版文件夹迁移关注数据、邮件设置、提醒发送记录和 Windows 加密授权码；复制前验证，写入失败时恢复原状。
- 已迁移关注但遗漏提醒资料时，只从身份编号和发件账户完全一致的唯一旧版补齐；多个来源或文件损坏时提示使用手动导入，不自行猜测或覆盖新版资料。
- 提醒状态区分“未找到授权码”和“已找到但当前账户无法读取”；设置已保留但后台任务仍指向旧文件夹时，可复用现有迁移操作。
- Windows 后台提醒更新先用普通权限原位替换同一身份的任务；只有系统拒绝时才提升任务小工具，应用和日常提醒仍以普通权限运行。
- 更新后核对运行程序、提醒程序、工作目录、时间、原登录用户和权限级别；取消 Windows 权限确认时明确说明没有更改任务或提醒资料。
- 无法确认归属的其他旧任务只显示数量和匿名身份编号，不自动删除；任务状态和浏览器接口不返回个人路径、账户名、邮箱或授权码。
- 主数据格式 8、提醒状态 2、设置 3 不变；未修改启动器、导入格式、邮箱接入或平台支持。

### 正式发布

- 标签提交：`a853e712a84156b5cc5575a828d2295298b35beb`；[候选运行 #36212326375](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/36212326375) 与 [正式标签运行 #36212646270](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/36212646270) 的共享验证、Windows x64、macOS Apple Silicon、macOS Intel 和源码归档六项任务均通过。
- Windows x64（43,307,551 bytes）：`E16EBF81DC6AB823D2DD464D7B982A555A00BD108A5BA504296F5153E9DA4F6B`。
- macOS Apple Silicon arm64（46,520,616 bytes）：`2E8EB9D80C7BBBF6BC3770F5EEC0C2049777A2E5250E9703340AF5379A28008B`。
- macOS Intel x64（47,724,845 bytes）：`EFB516173F607CD33BF7E13214E555E09CB909F1488EA72E6C12ECC9B035C955`。
- 三个平台 ZIP 与同名 `.sha256` 文件已发布在 [v1.3.3 GitHub Release](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.3.3)，公开后重新下载并逐一核对通过。macOS 包未签名、未公证。

## [1.3.2] - 2026-08-24

### 文章状态、恢复与日期准确性

- 在现有统一文章列表加入“已忽略”筛选、数量和恢复操作；忽略文章后可立即撤销，恢复只清除忽略状态，收藏、已读和中文翻译不受影响。
- 主数据 schema 保持 version 8，并新增向后兼容的可选 `articleArchive`。已收藏或已忽略文章的展示快照不设数量上限，旧 feed 缓存会自动回填，缓存已丢失的历史状态仍可通过明确占位记录恢复或清理。
- 收藏数量只统计未忽略收藏；已忽略数量包含没有可恢复元数据的旧状态。状态全部清除后，对应文章快照会一并移除。
- OpenAlex、Semantic Scholar 和 Crossref 记录真实提供的年／月／日精度；重复成果优先采用更精确的有效日期，同期排序使用稳定文章 ID 收尾。
- 旧缓存中没有精度的 `YYYY-01-01` 按年级日期显示，不再虚构 1 月 1 日；只有日期精度足以证明晚于关注时间时，文章才计为关注后的新成果。
- 新增文章恢复、旧 schema 8、无上限归档、孤立状态、状态转换、日期精度、排序和邮件日期显示的确定性回归测试。

### 导航、学者新文章与更新健康

- Logo 与学者详情页的返回操作统一恢复“学者动态”总览，同时清除档案、关注项、历史模式、列表筛选和搜索词，避免返回后残留隐形筛选。
- 学者卡显示关注后、未读且未忽略的新文章数，并可在该学者范围内一次标为已读；卡片改用明确的原生查看与标记按钮，不再嵌套可点击容器。
- 信息流覆盖结果区分成功、部分失败和失败，并只列出实际尝试的 OpenAlex、Semantic Scholar 与 Crossref 状态；手动检查会绕过内存中的提供方缓存。
- 移除硬编码活动柱图，改为显示上次成功取得数据的时间、各类关注项数量及失败来源；右栏隐藏时仍在主内容区保留精简健康摘要。
- 全部提供方失败时保留上次成功的信息流和时间，不显示成功提示，同时展示本次失败覆盖；学者卡不再以固定高度裁切必要操作。
- 新增统一导航复位、学者范围批量已读、真实提供方覆盖、缓存绕过、部分失败和全部失败降级的确定性 API 与 DOM 回归测试。

### 提醒状态、核心无障碍与窄屏适配

- 邮件提醒保存规范化的已保存配置快照，并将表单修改和待保存授权码明确标为未保存；当前修改保存并重新测试前，不再沿用旧配置的“已保存／测试成功”状态。
- 未保存修改会禁用测试和启用操作；旧计划仍运行时明确说明其使用已保存配置，关闭 dirty 提醒弹窗前会确认是否放弃修改。
- 添加关注与邮件提醒弹窗新增初始焦点、焦点圈定、Escape 关闭和焦点返回触发控件。
- 普通通知使用 polite status live region，错误反馈使用 alert；无操作的收录原因标签改为不可聚焦的语义文本。
- 820px 及以下将搜索框保留为全宽顶栏第二行；内容型元数据字号不低于 11px，表单标签与控件文字不低于 12px，并保留原有字体和视觉体系。
- 新增 dirty 状态、待保存授权码、放弃确认、键盘弹窗、live feedback、匹配标签和窄屏样式契约的确定性 DOM 回归测试。
- Windows 开启提醒改为先注册计划任务，再写入启用状态并执行首次检查；注册失败不会先发出一次性邮件，也不会留下 `enabled=true` 或 scheduler marker。首次检查失败会卸载刚注册的任务，并回滚提醒配置与发送账本，同时保留 SMTP 授权码。
- Windows 的 `PermissionDenied`、`Access is denied` 和 `0x80070005` 现在显示无路径、无堆栈的中文操作提示。部分系统首次注册或更新后迁移时需要右键以管理员身份运行一次 `start-local.cmd`；注册后的任务仍以当前用户 `RunLevel Limited` 运行，日常启动不需要管理员权限。只有第三步变绿并显示“后台提醒已开启”才表示真正生效，没有新文章时不会发邮件。

### 发布准备

- 产品元数据及 OpenAlex、Semantic Scholar、Crossref 请求使用的产品 User-Agent 统一为 `1.3.2`。
- 发布前只对冻结后的最终 `main` 完整提交运行一次 `candidate_sha` 原生预检；候选运行同时构建并 smoke Windows x64、macOS Apple Silicon arm64 和 macOS Intel x64，但候选产物仅用于验证，不能作为正式 Release 附件。
- 正式附件仍须由同一 SHA 上不可移动的 `v1.3.2` 标签重新生成。每个平台 ZIP 在构建时生成一个同名 `.sha256` sidecar；公开发布后再下载附件完成第二次完整性核对，不为重复取得相同摘要重新构建。

### 正式发布

- `v1.3.2` 标签提交为 `f89936b8e4854928142fb028de869794639fed3d`。预标签候选运行
  [#32683536380](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/32683536380)
  与正式标签运行
  [#32687638516](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/32687638516)
  均通过；正式运行的标签校验、共享应用验证、Windows x64、原生 macOS arm64、原生 macOS x64 和源码归档六项任务全部成功。
- Windows x64（43,294,718 bytes）：`9F51687B1B750614FB3547A4F5C5626DAD263ED43DD6D200F980FCD4D9D08D95`。
- macOS Apple Silicon arm64（46,512,921 bytes）：`0BF239A5871E5CFDE15B56546362F27D5110D94AB8AA24EFEAC6E3AFF87AC960`。
- macOS Intel x64（47,717,149 bytes）：`7E54A8EE4652A00F8E0A21C9A4175E645F90CC9CB36FCBA1628E3A670AE472A6`。
- 三个平台 ZIP 与同名 `.sha256` 文件已发布在
  [v1.3.2 GitHub Release](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.3.2)，并在公开发布后重新下载；三项 SHA-256 均与 sidecar 匹配。
- Windows 首次注册提醒或更新迁移时，部分系统需以管理员身份运行一次 `start-local.cmd`；注册后的计划任务仍以当前用户 `RunLevel Limited` 运行，日常启动无需管理员权限。macOS 两个架构的便携包均未签名、未公证。

## [1.3.1] - 2026-08-20

### 安全与数据可靠性

- 本地便携服务器新增 Host、Origin 和进程级会话校验，限制请求体大小并加入浏览器安全响应头，阻止外部网页借本机接口读取或修改 Anthropology Canteen 数据、设置和邮件提醒。
- 网页日常保存改为字段级合并；本地数据、设置和提醒状态使用独立跨进程锁、临时文件、原子替换与滚动备份，后台检查不再覆盖同时发生的收藏、关注或翻译操作。
- 主数据升级到 version 8，加入单调递增的 revision；移除关注、状态、翻译、学者缓存及提醒账本的静默数量截断，旧 version 2–7 数据继续自动迁移且失败时保留原文件。
- 提醒状态升级到 version 2；学者基线使用稳定 subscription ID，期刊使用 ISSN，改名或同名不再共享游标。首次基线仍抑制历史成果，但基线建立后才被索引发现的旧年份成果可以正常提醒。
- 信息流返回每个关注项的查询覆盖状态；全部来源失败时返回明确失败并保留上次缓存，失败关注项不建立或推进提醒基线。
- DOI 之外的跨来源成果按规范化题名、年份和首位作者去重，降低同一成果因来源 ID 不同而重复提醒的概率。
- 本地 JSON 主文件损坏时可从上一份有效滚动备份恢复；请求过大时明确拒绝，不再静默丢弃尾部数据。

### 学者身份与依赖维护

- 学者记录只有在 ORCID、同一索引 ID 或共同 DOI 等稳定证据一致时才自动整合；姓名、单位、研究方向、共同作者、书系或主页只用于展示与排序，不再触发自动合并。
- 机构主页改为人工核验链接，不再在搜索过程中自动抓取任意网址，避免慢请求、重定向失败和本机网络访问风险。
- 界面将“身份已确认”改为“已连接稳定索引记录”，明确“可追踪”不等于数据库身份绝对正确。
- 升级 Next.js、Nodemailer 及配套 lint 依赖，修复 v1.3.0 生产依赖中的已知高风险安全公告。
- 新增本地接口防护、字段合并、超量数据保留、稳定提醒基线、晚收录成果、失败来源降级和提醒状态迁移回归测试。

### 正式发布

- `v1.3.1` 标签提交为 `7695e3a2e2620aa28c78958f9547d9e06f63e6f4`；三平台原生构建与 smoke
  在 [Actions #32341349020](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/32341349020)
  全部通过。
- Windows x64（43,280,250 bytes）：`81A2801461AB5767DD50D139C34D3B3461C62DF24DCE5C0564C7ED0EADF6D779`。
- macOS Apple Silicon arm64（46,499,368 bytes）：`7BCEF366E5E0F0534FE4C7F53D9B467004E16CBC3B9D067C02200213CC37BC1C`。
- macOS Intel x64（47,703,588 bytes）：`A93EA6AE59CA3B25138A514A0F758FF9C05032AE393D195AFDE41D8F37AA4444`。
- 三个平台 ZIP 与同名 `.sha256` 文件发布在
  [v1.3.1 GitHub Release](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.3.1)；macOS 包未签名、未公证。

## [1.3.0] - 2026-08-18

### 可选的零成本本机邮件提醒

- 新增共享 `reminder-worker`：网页关闭后仍可由 Windows 当前用户任务计划程序或
  macOS LaunchAgent 定时启动，检查同一信息流并发送一次性汇总邮件。
- 支持 QQ、163、126、Yeah、Gmail 应用专用密码、iCloud App 专用密码和自定义 SMTP；
  465 强制 TLS、587 强制 STARTTLS，Outlook/Hotmail/Live 可作为收件地址。
- 首次启用和新增关注项只建立基线，不推送历史成果；提醒账本与网页未读状态独立，
  DOI／稳定来源 ID／标题年份组合用于去重，没有更新时不发邮件。
- 邮件为纯文本加静态 HTML，可选摘要片段，按学者优先、期刊其次分组，单封最多完整
  展示 50 项；SMTP 失败会保留 pending outbox 并在下次重试。
- 授权码不接受主密码：Windows 使用用户绑定的 DPAPI，macOS 使用登录钥匙串；密钥、
  任务注册和提醒状态不会进入空白分享 ZIP。
- 邮件提醒设置重做为清晰的三步向导，逐步说明发件小号、授权码、测试邮件和启用任务，
  并加入完成状态、邮箱服务商提示、运行条件说明及适配窄屏的帮助布局。
- 新版便携包的旧版导入继续保留原有研究数据，并同时迁移提醒设置、发送去重账本和
  Windows DPAPI 加密授权码；导入失败时不修改旧数据或当前版本数据。
- 修复固定本地网址可能复用旧页面缓存、导致新版只显示无样式文字的问题；启动网址增加
  缓存隔离，HTML 明确禁止缓存，最终包会实际检查 CSS 与 JavaScript 资源。
- 修复新文件夹已经生成空白数据文件后便不再查找旁边旧版本的问题；只要当前数据仍为空，
  后续启动或读取会继续尝试迁移旁边旧版的数据。
- 修复旧版仍在后台运行时，新启动器误连旧文件夹的问题；启动器现在核对实际程序目录，
  发现端口属于另一个解压副本时会换用新的本地端口启动当前版本。
- settings 升级为 version 3，主研究数据仍为 version 7；保留既有 API Key、关注项、
  收藏、已读、忽略、翻译和缓存。真实 SMTP 测试已由使用者确认可以收到邮件。

### 开发与验证状态

- 35 项确定性测试、lint 与生产构建均通过；Windows 本机测试包已由使用者确认正常。
- 正式附件从同一不可变标签在 Windows x64、macOS arm64 和 macOS x64 原生 runner 重新构建，
  并通过 Keychain、LaunchAgent、DPAPI、任务计划、提醒 worker、启动、持久化和隐私检查。
- macOS 便携包未签名、未公证；三个正式平台包及其 SHA-256 sidecar 发布在同一个 GitHub Release。
- 正式标签提交为 `218d1d75f4f82eadbb991f637f562aec6cc57bb9`，三平台原生构建与 smoke
  在 [Actions #32140570991](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/32140570991)
  全部通过。公开附件大小与摘要如下：
  - Windows x64（43,251,467 bytes）：`CF4B74FC3E8AD790BEE432C15E3A0FF57A90E24C8976DC9A1A0534B6442BBF0D`；
  - macOS Apple Silicon arm64（46,470,417 bytes）：`DB89E9CF79BCC2791CCC499F1CD33A64E489ADA45DF3132134CB5322964A18B6`；
  - macOS Intel x64（47,674,795 bytes）：`1B2E49F2906CB281E347DB8B620CB150CFEA7C206B2031F4E399A3370A92811F`。

## [1.2.0] - 2026-08-09

### 三平台正式发布

- 将 Windows x64、macOS Apple Silicon arm64 与 macOS Intel x64 整理为同一产品版本、
  同一源码提交和同一构建基线，不再把后续正式版本拆成平台专属发布。
- `v1.2.0` 标签在对应原生 runner 构建、测试 Windows x64、macOS Apple Silicon arm64
  与 macOS Intel x64，并将三个便携包发布在同一个 GitHub Release；macOS 包未签名、
  未公证。
- 同一标签同时生成经过路径隐私检查的源码归档，避免混入 `data/`、依赖、构建产物、
  缓存或本机文件。

### 界面与兼容性

- 移除页面右侧栏中的 Ruth Benedict 引文，不再放置人类学家名言。
- 应用功能与持久化结构保持不变：本地数据仍为 version 7，API-key settings 仍为
  version 2；1.1.1 用户的关注、关注日期、状态、翻译和缓存记录无需额外迁移。
- Windows 与 macOS 改为共用事务式数据导入器。导入会先验证 data/settings schema、
  检查正在运行的服务并备份目标；无效设置或中途失败不会留下部分覆盖的数据。

### 发布文件

- `Anthropology-Canteen-Windows-x64-v1.2.0.zip`
- `Anthropology-Canteen-macOS-Apple-Silicon-arm64-v1.2.0.zip`
- `Anthropology-Canteen-macOS-Intel-x64-v1.2.0.zip`
- 每个附件的 SHA-256 记录在同名 `.sha256` 文件及 GitHub Release 说明中。
- [v1.2.0 GitHub Release](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.2.0)
  来自不可移动标签提交 `aa8e3a25dcbe59cd57b83ecd94898efd343d36d0`；三平台原生构建与 smoke
  在 [Actions #31305111585](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/31305111585)
  全部通过。
- 发布后的三个公开 ZIP 与 sidecar 已重新下载并核对：
  - Windows x64：`779DA709836840745AF6829A4413D457FAA2E14EC51DC71E578107BE6F8B6BEA`；
  - macOS Apple Silicon arm64：`FA43E0E42BEEB611C74E62EF8DE52496FF9DFBF834935F0AEB297F842A01F539`；
  - macOS Intel x64：`FC2B6C02714B3C2A9165B43848D8B542D3B6AC7413F770204D58ED2619DDD306`。
- 首次标签运行 #31301297604 的 Windows smoke 因预期失败用例遗留退出码而被 CI 误报；
  标签未移动，后续运行只修复 CI 调用方式，并从同一标签提交完整重建所有平台。

## [macos-v1.1.1-beta.1] - 2026-08-09

- 新增 Apple Silicon arm64 与 Intel x64 的普通文件夹便携包；分别携带官方
  Node.js 24.14.0 运行时、许可证、Finder 可双击的 `.command` 主入口、前台诊断和
  旧版数据导入工具。未签名 beta 不提供可能受 App Translocation 影响的 `.app`。
- macOS 继续使用解压目录内的 `data/` 和共享 `portable-server.mjs`，保留 90 秒未连接
  退出、最后页面关闭约 8 秒退出及相邻旧版自动迁移语义，没有复制应用或服务器逻辑。
- 手动导入会先验证受支持的数据版本、基本结构与可选 settings version 2 白名单字段，
  活 PID 存在时拒绝导入，然后备份已有目标；无设置源时保留现有目标设置。
- 新增 `macos-15` arm64、`macos-15-intel` x64 原生打包/smoke 工作流，并在
  Windows 重跑共同代码回归。ZIP 只有一个版本化根目录，保留执行权限，生成 SHA-256，
  且扫描用户数据、设置、PID、环境文件、开发依赖、缓存和个人路径。
- GitHub Actions 原生矩阵运行 #31290870084 已通过 Windows 回归、Apple Silicon
  打包/smoke 和 Intel 打包/smoke；Apple Silicon M2 用户随后确认可以正常启动和试用，
  Intel 包尚未记录真人测试。
- 一次性标签 `macos-v1.1.1-beta.1` 指向实际构建提交 `c2ec6d1`，并发布为
  [GitHub Pre-release](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/macos-v1.1.1-beta.1)；
  没有移动或覆盖现有 Windows `v1.1.1`。
- 发布文件及 SHA-256：
  - `Anthropology-Canteen-macOS-Apple-Silicon-arm64-v1.1.1.zip`：
    `679B7EB994EBCDA6B0FC542E3431DE62A14833EA346CCC6B6BC4CF3398C7265B`；
  - `Anthropology-Canteen-macOS-Intel-x64-v1.1.1.zip`：
    `666BD2AC0088545CCAC67E8D85697CD0481073C3EFFF7CFC1DBA5E21136C3154`。
- 两个公开 Release ZIP 在发布后重新下载，所得大小与 SHA-256 均再次通过核对。

## [1.1.1] - 2026-08-07

### 学者搜索与身份模型重构

- 姓名模式恢复 v1.0.0 的稳定原则：一条索引作者 ID 对应一张候选卡。姓名、单位、宽泛主题或共同作者不再触发跨 ID 自动合并。
- OpenAlex 配置免费 Key 后，以官方作者搜索为主；姓名联想只作部分输入降级，错拼时再启用模糊搜索。
- 未配置 OpenAlex 时，Semantic Scholar 会在一次查询中带回候选人的发表，并以姓名接近度、成果量、单位/主题和最近发表重新排序；Cheryl Mattingly、Veena Das、Jason Throop 的主档案会排在少量成果碎片之前。
- Semantic Scholar 被限流时，Crossref 只生成一张经过完整姓名及人类学证据筛选的临时候选卡，不再把每篇论文列成一个学者结果。
- Crossref 的补充成果只有在 DOI、ORCID、单位或明确人类学证据成立时才进入档案；同名肿瘤学、医学或化学记录不会混入 Cheryl Mattingly 档案。
- 数据库规范姓名优先；全小写输入会安全显示为 `Cheryl Mattingly`、`Veena Das`、`Jason Throop`，不再以原始查询覆盖并永久保存小写姓名。
- 搜索卡片突出“最可能的主档案”、成果总数及最近一项发表；期刊或出版社名称不会被写成研究方向。

### 档案完整性、缓存与接口额度

- OpenAlex 档案使用 cursor 分页，Semantic Scholar 单次读取最多 1,000 项；全部成果按 DOI 或题名年份去重并按年份倒序。
- 已保存档案仍会立即显示，但权威缓存有效期从七天缩短为 24 小时；成功联网刷新会替换旧档案成果，不再让曾经误收的医学论文永久粘在缓存中。
- 信息流在 OpenAlex 返回空结果时继续尝试已确认的 Semantic Scholar ID，不再把“成功但为空”误判为更新完成。
- 除 OpenAlex Key 外，接口设置新增可选的 Semantic Scholar 免费 API Key，用于降低连续查询时的 429 限流。两种 Key 均只保存在解压文件夹的设置文件中。

### 本地数据升级

- 产品版本保持 `v1.1.1`，内部本地数据升级到 version 7。
- 首次读取 version 6 时，旧版自动合并的多 ID 会移入隔离字段，错误的学者档案与信息流缓存会重新生成；关注项、关注日期、收藏、已读、忽略和中文翻译全部保留。
- 旧版全小写关注姓名会在迁移或下一次稳定 ID 刷新时恢复规范大小写。

### 验证

- 21 项离线回归覆盖三位指定学者、同名医学记录、Semantic Scholar 限流、Crossref 证据筛选、OpenAlex 分页、旧版数据迁移与 API Key 私密保存。
- 发布文件：`Anthropology-Canteen-Windows-v1.1.1.zip`
- SHA-256：`AE7F717A449F1B45CA15EB9DCFC83BE4BB0AF86D5E68A480FB1EA0B816B83238`

## [1.1.0] - 2026-07-30

### 学者检索与档案

- 中文单位会先解析为索引中的标准机构名，中文学科也会转换为可检索的英文主题；中文姓名会同时检索合并与分隔的拼音形式。
- 代表作成为独立身份锚点，论文没有 ORCID 或索引作者 ID 可疑时，不再把整份错误档案自动绑定给作者。
- 同一位学者在博士阶段和工作后的多个机构、多个 OpenAlex 或 Semantic Scholar ID，会在 ORCID、共同作品等证据足够时整合为一个档案。

### 兼容与本地数据

- 本地数据升级到 version 4；旧关注、文章缓存、收藏、已读状态和中文摘要会保留。
- 期刊与学者关注项会记录关注时间；历史发表仍可查看，但只有关注之后发表的内容才计入未读数量。
- 便携分享包仍为空白，不包含个人数据、API 密钥或邮件提醒功能。

### 发布文件

- `Anthropology-Canteen-Windows-v1.1.0.zip`
- SHA-256：`472E2B3B23E75F48910CC388B44C56514921F2D0A865E9C1426282A1A7EBE923`

## [1.0.1] - 2026-07-29

### 学者检索与档案

- 学者搜索并行聚合 OpenAlex、Semantic Scholar 与 Crossref，单一来源失败时不再整体空白。
- 新增姓名与代表作两种搜索方式，支持中文姓名拼音、姓名顺序、轻微拼写差异、DOI、ORCID 和索引链接。
- 候选结果加入别名、当前与历史单位、研究方向、代表作、来源及自动追踪状态。
- 文章作者改为可点击的内部学者档案入口，并可在档案中关注或取消关注。
- 同名候选只在稳定 ID、ORCID 或共同代表作 DOI 足以确认时合并。

### 兼容与本地数据

- 本地数据升级到 version 3；旧关注、文章缓存、收藏、已读状态和中文摘要会保留。
- 学者关注项新增稳定订阅 ID、别名、多个外部 ID、机构及核验来源。
- 便携分享包仍为空白，不包含个人数据、API 密钥或邮件提醒功能。

### 发布文件

- `Anthropology-Canteen-Windows-v1.0.1.zip`
- SHA-256：`89C01C52EE14D3FEDFF83B7FFFAAA47405CB76C9922DBB0AA9D4CC3747CEAD81`

## [1.0.0] - 2026-07-28

首个正式版本，对应项目内部第 12 次迭代。

### 主要功能

- 关注人类学期刊、学者和关键词组，并聚合相关学术成果。
- 展示学者动态、期刊更新、关键词命中和收藏内容。
- 支持文章收藏、已读状态、忽略状态和中文摘要。
- 用户数据保存在本地，可从旧版本自动或手动迁移。
- 提供无需单独安装 Node.js 的 Windows 便携版。

### 发布文件

- `Anthropology-Canteen-Windows-v1.0.0.zip`
- SHA-256：`CB286E9EEA574EA211C0336D6F36AB1BB6C69B29F99E87F1FFEDE7DC39EB758F`
