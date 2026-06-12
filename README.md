# Bili Tail Tool

Bili小尾巴 VRC解析是一个轻量的 Chromium 浏览器扩展，用来把当前 B 站普通视频、分P、列表页视频和直播间解析成可以带去 VRChat/VRC 播放器里尝试使用的链接。

## 功能

- 普通视频单击扩展图标：复制 91biliplayer 包装播放地址。
- 普通视频快速双击扩展图标：复制 B 站临时直链。
- 分P、列表页视频和直播间：自动复制对应的临时直链。
- 扩展图标菜单：打开“切换小尾巴配置”，设置直链清晰度偏好。
- 首次安装：打开本地交互式教程页，演示单击、双击、自动直链和配置入口。

## 本地安装

Chrome:

1. 打开 `chrome://extensions`
2. 开启 Developer mode
3. 选择 Load unpacked
4. 选择本仓库目录

Edge:

1. 打开 `edge://extensions`
2. 开启 Developer mode
3. 选择 Load unpacked
4. 选择本仓库目录

## 打包

仓库根目录就是扩展根目录，直接打包即可：

```sh
zip -r -X bili-tail-tool.zip . \
  -x '.git/*' \
  -x '.DS_Store' \
  -x 'store-assets/*' \
  -x '*.zip'
```

## 商店素材

Chrome Web Store / Edge Add-ons 用的说明、权限理由和预览图放在：

- `store-assets/listing/`
- `store-assets/screenshots/`
- `store-assets/promotional/`

## 文件用途

仓库根目录本身就是浏览器扩展目录。本地测试时选择仓库根目录；正式打包时只需要打包扩展运行文件，`store-assets/` 是上架时手动上传或复制填写用的素材。

| 文件 | 用途 |
| --- | --- |
| `.gitignore` | 告诉 Git 忽略 `.DS_Store`、zip 包、构建目录和依赖目录，避免把本机或临时产物提交上来。 |
| `README.md` | 项目说明，写明插件能做什么、怎么本地安装、怎么打包，以及每个文件的用途。 |
| `manifest.json` | 浏览器扩展清单。定义插件名称、版本、权限、图标、后台脚本和扩展按钮，是 Chrome/Edge 识别插件的入口文件。 |
| `background.js` | 插件的核心逻辑。监听扩展图标点击、双击和右键菜单，读取当前 B 站页面信息，请求 Bilibili API，生成 91biliplayer 包装链接或 B 站临时直链，并把结果复制到剪贴板。 |
| `options.html` | 设置页结构。用户从扩展图标菜单打开“切换小尾巴配置”时看到这个页面。 |
| `options.css` | 设置页样式。负责设置页的卡片、按钮、下拉框、状态提示等视觉效果。 |
| `options.js` | 设置页交互逻辑。读取和保存用户的默认清晰度偏好，使用浏览器扩展存储保存设置。 |
| `welcome.html` | 首次安装后的使用教程页结构。它是本地页面，不请求远程资源，用模拟浏览器界面演示如何点击小尾巴。 |
| `welcome.css` | 教程页样式。负责欢迎页布局、步骤列表、模拟浏览器、提示气泡和按钮的视觉效果。 |
| `welcome.js` | 教程页交互逻辑。控制 4 个教程步骤切换，模拟单击、双击、自动直链和扩展菜单入口。 |
| `icons/icon-16.png` | 16x16 扩展图标，用于浏览器工具栏、小尺寸列表或系统 UI。 |
| `icons/icon-32.png` | 32x32 扩展图标，用于工具栏和教程页里的小尾巴按钮。 |
| `icons/icon-48.png` | 48x48 扩展图标，用于扩展管理页、欢迎页标题区等中等尺寸展示。 |
| `icons/icon-128.png` | 128x128 扩展图标，用于 Chrome/Edge 扩展商店和扩展管理页的大图标展示。 |
| `icons/icon-512-preview.png` | 512x512 预览图标，主要给商店素材、截图或后续设计调整使用，不是 manifest 必需尺寸。 |

### 上架资料文件

| 文件 | 用途 |
| --- | --- |
| `store-assets/listing/asset-checklist.md` | 上架素材检查清单。用来确认图标、截图、宣传图、描述、隐私链接和权限说明是否准备齐。 |
| `store-assets/listing/chrome-web-store-listing-zh.md` | Chrome Web Store 中文上架文案草稿，包含名称、简介、详细描述、分类建议等可复制内容。 |
| `store-assets/listing/permission-justification-zh.md` | 权限用途说明。用于填写 Chrome/Edge 后台里 `activeTab`、`clipboardWrite`、`contextMenus`、`scripting`、`storage` 和 B 站 host permission 的理由。 |
| `store-assets/listing/privacy-policy-zh.md` | 中文隐私政策 Markdown 版本，方便阅读和复制。 |
| `store-assets/listing/privacy-policy.html` | 隐私政策 HTML 版本，可以放到 GitHub Pages 或其他静态网页作为商店隐私链接。 |
| `store-assets/listing/review-notes-zh.md` | 审核备注草稿。给商店审核人员解释插件的单一用途、91biliplayer 的使用方式、权限边界和测试步骤。 |
| `store-assets/screenshots/screenshot-1280x800-main.png` | 主预览图。当前同步为第 1 张教程截图，适合放在商店截图第一位。 |
| `store-assets/screenshots/screenshot-1280x800-01-normal-video.png` | 教程截图 1：普通视频单击扩展图标，复制 91biliplayer 播放地址。 |
| `store-assets/screenshots/screenshot-1280x800-02-temporary-direct-link.png` | 教程截图 2：普通视频快速双击扩展图标，复制 B 站临时直链。 |
| `store-assets/screenshots/screenshot-1280x800-03-auto-direct-link.png` | 教程截图 3：分P、列表页视频和直播间自动走临时直链逻辑。 |
| `store-assets/screenshots/screenshot-1280x800-04-settings-menu.png` | 教程截图 4：展示扩展图标菜单里的“切换小尾巴配置”入口。 |
| `store-assets/screenshots/screenshot-1280x800-privacy.png` | 隐私/权限说明用预览图。可在商店截图或审核资料中补充说明插件不收集个人数据。 |
| `store-assets/promotional/small-promo-440x280.png` | Chrome Web Store 小尺寸宣传图，尺寸 440x280。 |
| `store-assets/promotional/marquee-1400x560.png` | Chrome Web Store 大横幅宣传图，尺寸 1400x560。 |

## 实现说明

- Bilibili API 流程参考了 `injahow/bilibili-parse` 的思路：先通过 `x/web-interface/view` 获取 `cid`，再通过 `x/player/playurl` 获取播放信息。
- VRChat 播放器链接工作流参考了 `LgcChina/BiliSongListTool` 的使用场景。
- 扩展使用原生 JavaScript 编写，不需要 PHP、Unity 或构建步骤。
- 扩展不包含作者服务器，不收集、出售、共享或上传用户个人信息。

## 注意

- This is an unofficial tool and is not affiliated with Bilibili, VRChat, or 91biliplayer.
- Bilibili direct media URLs are temporary and may expire.
- Normal-video single click uses `https://biliplayer.91vrchat.com/player/?url=` plus the current Bilibili page URL. That third-party 91biliplayer service is not provided by this extension, so playback reliability depends on the service, Bilibili permissions, and network conditions.
- Use this only with content you have the right to play.
