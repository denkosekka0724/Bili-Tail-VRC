# Bili Tail VRC Danmaku Edition

这是 Bili小尾巴 VRC 的弹幕实验分支。普通模式和正式上架版保持同款操作：普通视频单击复制 91biliplayer 播放地址，普通视频双击复制 B 站临时直链，分P、列表页视频和直播间会自动走直链。弹幕模式额外连接你自己填写的后端，把当前 B 站普通视频生成带弹幕的 HLS 地址，再复制给 VRC/VRChat 播放器测试。

普通正式版已经上架 Chrome Web Store：

https://chromewebstore.google.com/detail/naeaecjabhcjeagenojhaiflljegmaca?utm_source=item-share-cb

这个分支是单独的弹幕版包，不会改动普通版的商店隐私政策和上架说明。

## 功能

- 普通模式单击扩展图标：复制 91biliplayer 包装播放地址。
- 普通模式快速双击扩展图标：复制 B 站临时直链。
- 普通模式遇到分P、列表页视频或直播间：自动复制更适合的临时直链。
- 弹幕模式单击扩展图标：把当前普通 BV/av 视频交给自建后端，等待后端生成带弹幕 HLS 地址并复制。
- 扩展图标菜单：打开“切换小尾巴配置”，设置普通 / 弹幕模式、清晰度偏好、后端地址和弹幕数量。
- 首次安装：打开本地交互式教程页，用模拟浏览器演示每一种点击方式。

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

## 弹幕后端

弹幕模式需要你自己的后端服务。这个分支把一个最小原型放在 `backend/`，用于把 B 站弹幕转成 ASS，然后调用 ffmpeg 烧录并输出 HLS。

本地试跑：

```sh
cd backend
python3 server.py --host 127.0.0.1 --port 8765
```

然后在扩展配置页把后端地址填成：

```text
http://127.0.0.1:8765
```

公网使用时建议配 HTTPS，并确保后端返回 CORS 头。弹幕模式不会把数据发到扩展作者服务器，只会请求你在配置页填写的后端地址。

## 打包

仓库根目录就是扩展根目录。给 Chrome/Edge 上传时只打包扩展运行文件，不要把 `backend/`、`store-assets/` 或 `.git/` 一起塞进 zip。

```sh
zip -r -X bili-tail-vrc-danmaku.zip . \
  -x '.git/*' \
  -x '.github/*' \
  -x '.gitignore' \
  -x '.DS_Store' \
  -x 'backend/*' \
  -x 'store-assets/*' \
  -x '*.zip'
```

## 文件用途

仓库根目录是浏览器扩展本体。本地测试时选择仓库根目录；后端和商店素材只是辅助资料，打包扩展时会排除。

| 文件 | 用途 |
| --- | --- |
| `.github/workflows/release.yml` | GitHub Actions 发布流程。给弹幕分支打 `v*` 标签时，会读取 `manifest.json` 版本号并打出只包含扩展本体的 zip。 |
| `.gitignore` | 忽略本机临时文件、zip 包、构建目录、依赖目录，以及后端运行时生成的 jobs/out/log 文件。 |
| `README.md` | 当前弹幕实验分支的说明，写清普通模式、弹幕模式、本地安装、后端使用、打包方式和文件边界。 |
| `manifest.json` | Chrome/Edge 扩展清单。定义弹幕版名称、版本、权限、图标、后台脚本和扩展按钮。 |
| `background.js` | 扩展核心逻辑。监听扩展图标单击、双击和右键菜单；普通模式请求 Bilibili API 并复制 91biliplayer 地址或临时直链；弹幕模式请求用户填写的后端任务接口并复制生成的 HLS 地址。 |
| `options.html` | 配置页结构。用户从扩展图标菜单打开“切换小尾巴配置”时看到这个页面。 |
| `options.css` | 配置页样式。控制简洁卡片、模式切换按钮、下拉框、后端输入框、弹幕参数和保存状态提示。 |
| `options.js` | 配置页交互。读取和保存普通 / 弹幕模式、清晰度、后端地址、弹幕数量和单条长度。 |
| `welcome.html` | 首次安装后的教程页结构。它是本地页面，用模拟 Chrome 和 B 站页面演示小尾巴的几种点击方式。 |
| `welcome.css` | 教程页样式。负责步骤列表、模拟浏览器、顶部提示、扩展菜单、按钮和移动端布局。 |
| `welcome.js` | 教程页交互。控制 5 个教程步骤切换，模拟普通单击、普通双击、自动直链、弹幕 HLS 和配置菜单入口。 |

### 图标文件

| 文件 | 用途 |
| --- | --- |
| `icons/icon-16.png` | 16x16 扩展图标，用在工具栏小尺寸位置和浏览器内部列表。 |
| `icons/icon-32.png` | 32x32 扩展图标，用在工具栏、欢迎页模拟按钮和部分 Chromium UI。 |
| `icons/icon-48.png` | 48x48 扩展图标，用在扩展管理页、配置页标题和欢迎页标题。 |
| `icons/icon-128.png` | 128x128 扩展图标，用在 Chrome/Edge 扩展管理页和商店要求的大图标。 |
| `icons/icon-512-preview.png` | 512x512 预览图标，给商店素材、截图或后续视觉调整使用，不是 manifest 必需尺寸。 |

### 后端原型

| 文件 | 用途 |
| --- | --- |
| `backend/README.md` | 后端原型说明。记录如何本地测试、如何启动 HTTP 服务、任务状态含义和部署注意事项。 |
| `backend/server.py` | 最小 HTTP 后端。提供 `POST /api/jobs` 创建任务、`GET /api/jobs/<id>` 查询状态、`/media/...` 输出 HLS 文件。 |
| `backend/bili_danmaku_vrc.py` | 弹幕处理脚本。解析 B 站普通视频，拉取弹幕 XML，生成 ASS 字幕、元数据和 ffmpeg 转码命令。 |

### 商店素材

这些文件是上架时复制填写或上传用的素材，不参与扩展运行。

| 文件 | 用途 |
| --- | --- |
| `store-assets/listing/asset-checklist.md` | 上架前检查清单，用来核对图标、截图、描述、权限理由、隐私链接和审核备注是否准备齐。 |
| `store-assets/listing/chrome-web-store-listing-zh.md` | Chrome Web Store 中文文案草稿，可按是否发布弹幕版再调整名称、简介和详细描述。 |
| `store-assets/listing/permission-justification-zh.md` | 权限用途说明草稿，解释 `activeTab`、`clipboardWrite`、`contextMenus`、`scripting`、`storage` 和 B 站 host permission 为什么需要。 |
| `store-assets/listing/privacy-policy-zh.md` | 中文隐私政策草稿。弹幕版若单独上架，需要把“用户自填后端地址”说明清楚。 |
| `store-assets/listing/privacy-policy.html` | 隐私政策 HTML 版本，可放到 GitHub Pages 或其他静态网页作为商店隐私链接。 |
| `store-assets/listing/review-notes-zh.md` | 审核备注草稿，用来解释插件单一用途、91biliplayer、弹幕后端边界、权限边界和测试步骤。 |
| `store-assets/screenshots/screenshot-1280x800-main.png` | 商店主预览图，展示教程式的主界面引导。 |
| `store-assets/screenshots/screenshot-1280x800-01-normal-video.png` | 教程截图 1，演示普通视频单击复制 91biliplayer 播放地址。 |
| `store-assets/screenshots/screenshot-1280x800-02-temporary-direct-link.png` | 教程截图 2，演示普通视频快速双击复制 B 站临时直链。 |
| `store-assets/screenshots/screenshot-1280x800-03-auto-direct-link.png` | 教程截图 3，演示分P、列表页视频和直播间自动复制直链。 |
| `store-assets/screenshots/screenshot-1280x800-04-settings-menu.png` | 教程截图 4，演示扩展图标菜单里的“切换小尾巴配置”入口。 |
| `store-assets/screenshots/screenshot-1280x800-privacy.png` | 隐私/权限说明图，可用于审核材料或补充截图。 |
| `store-assets/promotional/small-promo-440x280.png` | Chrome Web Store 小尺寸宣传图，尺寸 440x280。 |
| `store-assets/promotional/marquee-1400x560.png` | Chrome Web Store 大横幅宣传图，尺寸 1400x560。 |

## 实现说明

- Bilibili API 流程参考了 `injahow/bilibili-parse` 的思路：先通过 `x/web-interface/view` 获取 `cid`，再通过 `x/player/playurl` 获取播放信息。
- VRChat 播放器链接工作流参考了 `LgcChina/BiliSongListTool` 的使用场景。
- 普通模式使用 `https://biliplayer.91vrchat.com/player/?url=` 包装当前 B 站页面地址。这个第三方服务不是本扩展作者提供，播放稳定性取决于 91biliplayer、B 站权限和网络环境。
- 弹幕模式只请求用户自己填写的后端地址。后端原型需要 ffmpeg，生成和托管 HLS 的成本、权限和合规风险由部署者自己确认。
- 扩展不包含作者服务器，不收集、出售、共享或上传用户个人信息。

## 注意

- This is an unofficial experimental tool and is not affiliated with Bilibili, VRChat, or 91biliplayer.
- Bilibili direct media URLs are temporary and may expire.
- The danmaku backend should only be used with content you have the right to play, transform, and publicly show.
- If this danmaku edition is published separately, prepare a separate privacy policy and listing text for the backend behavior.
