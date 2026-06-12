# Bili小尾巴 VRC弹幕后端原型

把 B 站普通视频的弹幕拉下来，转换成 ASS 字幕，并生成适合服务器转码成 VRC 可播 HLS/MP4 的 ffmpeg 命令。

这个原型是弹幕实验分支的配套服务，不属于普通 Chrome 商店版扩展。适合先在本地或自己的服务器上验证“带弹幕视频 -> VRC 播放器”的链路。

## 快速测试

```bash
python3 bili_danmaku_vrc.py "https://www.bilibili.com/video/BV1GJ411x7h7" --max-danmaku 80
```

常用参数：

- `--quality 80`：请求 1080P/最高可用直链，B 站可能自动降级。
- `--max-danmaku 1200`：最多渲染多少条弹幕。
- `--max-text-length 80`：超长弹幕会截短，避免在 VRC 里刷满整屏。
- `--page 2`：指定分P。

输出会放到 `out/`：

- `*.ass`：弹幕字幕文件
- `*.json`：视频和弹幕元数据
- `*.ffmpeg.sh`：烧录弹幕并输出 MP4/HLS 的命令模板

## 运行转码

本机需要安装 `ffmpeg`。当前机器没检测到 ffmpeg，所以脚本只生成命令，不会自动转码。

```bash
sh out/BVxxxx-p1.ffmpeg.sh
```

生成的 HLS `index.m3u8` 需要放到 HTTPS 服务器或 VRCDN 这类 VRC 可访问的托管上，再把 m3u8 地址给 VRC 播放器。

## 启动后端原型

```bash
python3 server.py --host 127.0.0.1 --port 8765
```

打开：

```text
http://127.0.0.1:8765
```

或者直接创建任务：

```bash
curl -X POST http://127.0.0.1:8765/api/jobs \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.bilibili.com/video/BV1GJ411x7h7","quality":"80","maxDanmaku":1200}'
```

查询任务：

```bash
curl http://127.0.0.1:8765/api/jobs/<job-id>
```

任务状态：

- `generating`：正在拉视频信息和弹幕。
- `transcoding`：弹幕已生成，正在跑 ffmpeg。
- `ready`：HLS 已生成，返回 `hlsUrl`，可以给 VRC 播放器测试。
- `needs_ffmpeg`：弹幕和转码命令已生成，但服务器没有安装 ffmpeg。
- `error`：任务失败。

部署到公网时建议这样启动：

```bash
python3 server.py --host 0.0.0.0 --port 8765 --base-url https://your-domain.example
```

再用 Nginx/Caddy 反代成 HTTPS。VRChat/Android 播放器对 HTTPS 更友好。

## 注意

- 只用于你有权播放/转码/公开展示的内容。
- B 站临时直链会过期，ffmpeg 命令要尽快跑。
- 弹幕烧录是最稳的 VRC 兼容方案，但需要转码时间。
- 扩展只负责把 B 站链接发给这个后端，后端负责生成 HLS 地址。
