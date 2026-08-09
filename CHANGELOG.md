# 版本记录

本项目从 `v1.0.0` 起采用[语义化版本](https://semver.org/lang/zh-CN/)。

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
