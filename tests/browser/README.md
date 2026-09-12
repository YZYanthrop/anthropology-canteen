# 浏览器回归

先运行 `pnpm build`，再在一个终端运行 `node tests/browser/preview-server.mjs`，
保留该终端，在另一个终端运行 `pnpm test:browser`。构建更新后需重启预览服务。

默认使用电脑上已安装的 Microsoft Edge，无需下载浏览器；可用 `BROWSER_CHANNEL`
选择 Playwright 支持的其他已安装 Chromium 浏览器通道。验证结束后关闭预览进程。

预览仅监听 `127.0.0.1:4173`，使用内存合成数据，不读写个人 `data/`，所有接口均被模拟，
未知接口会被拒绝。浏览器测试使用独立临时浏览器环境，不操作用户的浏览器资料。
截图保存到被 Git 忽略的 `outputs/v1.3.3-browser/`。

真实浏览器的布局、滚轮、键盘验证不等于实际触摸设备或屏幕阅读器的真人验收。
