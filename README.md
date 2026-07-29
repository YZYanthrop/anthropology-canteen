# Anthropology Canteen Windows 便携版

这是一个本地运行的版本，自带运行环境。使用者不需要安装 Node.js，也不需要账号。

当前正式版本：`v1.0.1`。

## 学者发现与作者档案

- “按姓名”会同时尝试中文姓名的拼音、姓名顺序、标点和轻微拼写差异。
- 可填写单位与研究方向来甄别同名学者；结果中会展示别名、机构、方向和代表作。
- “按代表作”支持论文标题、DOI、ORCID、OpenAlex 或 Semantic Scholar 链接。
- 文献卡片中的作者姓名可以点击；有稳定作者 ID 时直接打开内部档案，只有姓名时会结合当前文献让使用者确认。
- 学者身份由 OpenAlex、Semantic Scholar 与 Crossref 独立聚合。某一来源限流或失败时，其他结果仍可使用。
- 本版不包含邮件、定时任务或提醒设置。

## 启动

1. 完整解压整个 ZIP 文件。
2. 双击 `Anthropology Canteen.vbs`。
3. 程序会在后台运行，不会出现需要一直保留的黑色窗口。
4. 网页准备好后会自动打开：
   `http://anthropology-canteen.localhost:3000`

备用地址：

- `http://localhost:3000`
- `http://127.0.0.1:3000`

关闭最后一个 Anthropology Canteen 网页后，后台程序会在约 8 秒内自动停止。
刷新网页不会误关程序；如果同时打开了多个页面，需要全部关闭。
下次使用时只需再次双击 `Anthropology Canteen.vbs`。

如果无窗口启动失败，可以双击 `start-local.cmd` 查看具体错误提示。

## 更新版本

推荐更新方式：

1. 关闭旧版的所有 Anthropology Canteen 网页并等待约 10 秒；更早版本则关闭黑色窗口或使用旧版关闭脚本。
2. 将新版 ZIP 完整解压到旧版同一个文件夹里，并允许 Windows 覆盖同名程序文件。
3. 旧文件夹中的 `data/anthropology-canteen-data.json` 会保留下来，关注列表和收藏状态不会丢失。

如果你已经把新版解压到了一个全新的文件夹：

1. 在新版文件夹中双击 `import-data-from-old-version.cmd`。
2. 按窗口提示，把旧版的 `data` 文件夹，或旧版的 `data/anthropology-canteen-data.json` 文件拖进去并回车。
3. 导入完成后再双击 `Anthropology Canteen.vbs`。

## 数据保存

- 这个分享版第一次打开是空白的，不预置任何个人关注项。
- 每位使用者添加的期刊、学者、关键词、收藏、已读状态、最近一次成功读取的文章列表，以及已经点击生成过的中文摘要，会保存在解压文件夹里的 `data/anthropology-canteen-data.json`。
- 这些数据不会写回原始 ZIP 文件，也不会同步给其他人。
- 想把空白版发给别人时，请发送原始 ZIP；不要发送自己已经运行过、带有 `data` 文件夹的使用中副本。
- 如果想把自己的配置带到另一台电脑，可以复制整个解压后的文件夹，或只复制 `data/anthropology-canteen-data.json`。
- 如果想恢复空白状态，先关闭所有 Anthropology Canteen 网页并等待约 10 秒，再删除 `data/anthropology-canteen-data.json`。
- 新版第一次打开时，如果发现浏览器里有旧版保存的数据，会自动迁移到上面的 `data` 文件中，并清除 Anthropology Canteen 自己的旧浏览器记录。
- 学术数据检索和中文翻译仍然需要联网。

## 更新版本时保留自己的数据

推荐做法：

1. 不要删除旧版文件夹。
2. 把新版 ZIP 解压到旧版文件夹旁边，例如两个文件夹都放在桌面或同一个资料夹里。
3. 双击新版里的 `Anthropology Canteen.vbs`。
4. 如果新版自己的 `data` 文件还不存在，它会自动寻找旁边旧版文件夹里的 `data/anthropology-canteen-data.json`，并把保存时间最新的那份复制到新版。

如果自动迁移没有发生，也可以手动复制旧版里的 `data` 文件夹到新版文件夹中。

## 注意

- 不要在 ZIP 压缩包预览窗口中直接运行，必须先完整解压。
- 不要单独复制启动文件；必须保留整个文件夹。
- 不需要账号或数据库。

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
```

版本编号和发布流程见 [`docs/RELEASING.md`](docs/RELEASING.md)，版本变更见
[`CHANGELOG.md`](CHANGELOG.md)。

## 许可证

创作者：[YZYanthrop](https://github.com/YZYanthrop)

本项目由 YZYanthrop 创作，并采用 [MIT License](LICENSE) 开放使用。
