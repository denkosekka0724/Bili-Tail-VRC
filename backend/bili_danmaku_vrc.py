#!/usr/bin/env python3
import argparse
import html
import json
import math
import os
import re
import shlex
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path


BILI_VIEW_API = "https://api.bilibili.com/x/web-interface/view"
BILI_PLAY_API = "https://api.bilibili.com/x/player/playurl"
BILI_DM_API = "https://api.bilibili.com/x/v1/dm/list.so"
USER_AGENT = "Mozilla/5.0 BiliDanmakuVRCPrototype/0.1"


def main():
    parser = argparse.ArgumentParser(description="Generate ASS danmaku subtitles and ffmpeg commands for VRC playback.")
    parser.add_argument("url", help="Bilibili ordinary video URL, BV id, or av id")
    parser.add_argument("--quality", default="80", choices=["80", "64", "32", "16"], help="Bilibili direct URL quality preference")
    parser.add_argument("--page", type=int, default=None, help="Override page number")
    parser.add_argument("--out", default="out", help="Output directory")
    parser.add_argument("--width", type=int, default=1920, help="ASS canvas width")
    parser.add_argument("--height", type=int, default=1080, help="ASS canvas height")
    parser.add_argument("--max-danmaku", type=int, default=1200, help="Limit rendered danmaku count")
    parser.add_argument("--max-text-length", type=int, default=80, help="Truncate very long danmaku text")
    parser.add_argument("--duration", type=float, default=8.0, help="Scrolling danmaku duration in seconds")
    args = parser.parse_args()

    result = generate_artifacts(
        args.url,
        quality=args.quality,
        page_override=args.page,
        out_dir=args.out,
        width=args.width,
        height=args.height,
        max_danmaku=args.max_danmaku,
        max_text_length=args.max_text_length,
        duration=args.duration,
    )

    print("弹幕 ASS 已生成:", result["assPath"])
    print("元数据已生成:", result["metaPath"])
    print("ffmpeg 命令已生成:", result["commandPath"])
    print("弹幕数量:", result["meta"]["danmakuRendered"], "/", result["meta"]["danmakuTotal"])
    print("直链 host:", result["meta"]["directUrlHost"] or "未取得")
    if not result["directUrl"]:
        print("警告：没有取得 B 站临时直链，ffmpeg 命令需要手动补 input。", file=sys.stderr)


def generate_artifacts(
    raw_url,
    quality="80",
    page_override=None,
    out_dir="out",
    width=1920,
    height=1080,
    max_danmaku=1200,
    max_text_length=80,
    duration=8.0,
):
    video_input = parse_video_input(raw_url)
    view = get_view_info(video_input)
    page_number = page_override or video_input.get("page") or 1
    page = pick_page(view, page_number)
    bvid = view.get("bvid") or video_input.get("bvid") or ""
    aid = view.get("aid") or video_input.get("aid") or ""
    cid = page["cid"]

    danmaku = fetch_danmaku(cid)
    selected = limit_danmaku_text(select_danmaku(danmaku, max_danmaku), max_text_length)
    title = make_title(view, page)
    ass_text = build_ass(
        selected,
        title=title,
        width=width,
        height=height,
        scroll_duration=duration,
    )

    play = get_play_url(aid=aid, bvid=bvid, cid=cid, quality=quality)
    direct_url = extract_direct_url(play)
    actual_quality = play.get("quality")

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    safe_id = f"{bvid or 'av' + str(aid)}-p{page_number}"
    ass_path = out_dir / f"{safe_id}.ass"
    meta_path = out_dir / f"{safe_id}.json"
    command_path = out_dir / f"{safe_id}.ffmpeg.sh"

    ass_path.write_text(ass_text, encoding="utf-8")
    meta = {
        "title": title,
        "bvid": bvid,
        "aid": aid,
        "cid": cid,
        "page": page_number,
        "danmakuTotal": len(danmaku),
        "danmakuRendered": len(selected),
        "requestedQuality": int(quality),
        "actualQuality": actual_quality,
        "directUrlHost": host_of(direct_url),
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    command_path.write_text(build_ffmpeg_script(direct_url, ass_path.name, safe_id), encoding="utf-8")
    os.chmod(command_path, 0o755)

    return {
        "safeId": safe_id,
        "assPath": str(ass_path),
        "metaPath": str(meta_path),
        "commandPath": str(command_path),
        "meta": meta,
        "directUrl": direct_url,
    }


def parse_video_input(raw):
    text = raw.strip()
    if re.fullmatch(r"BV[0-9A-Za-z]+", text, re.I):
        return {"bvid": text, "aid": "", "page": 1}
    if re.fullmatch(r"av\d+", text, re.I):
        return {"bvid": "", "aid": text[2:], "page": 1}
    if re.fullmatch(r"\d+", text):
        return {"bvid": "", "aid": text, "page": 1}

    try:
        url = urllib.parse.urlparse(text)
    except ValueError:
        raise SystemExit("无法识别这个 B 站视频地址")

    bv = re.search(r"/video/(BV[0-9A-Za-z]+)", url.path, re.I)
    av = re.search(r"/video/av(\d+)", url.path, re.I)
    query = urllib.parse.parse_qs(url.query)
    page = positive_int(first(query.get("p")), 1)
    if bv or av:
        return {"bvid": bv.group(1) if bv else "", "aid": av.group(1) if av else "", "page": page}
    raise SystemExit("目前只支持 B 站普通 BV/av 视频页")


def get_view_info(video_input):
    params = {}
    if video_input.get("bvid"):
        params["bvid"] = video_input["bvid"]
    if video_input.get("aid"):
        params["aid"] = video_input["aid"]
    data = get_json(BILI_VIEW_API, params, referer="https://www.bilibili.com/")
    if data.get("code") != 0 or not data.get("data"):
        raise SystemExit(data.get("message") or "获取视频信息失败")
    return data["data"]


def pick_page(view, page_number):
    pages = view.get("pages") or []
    if not pages:
        raise SystemExit("没有找到视频分P信息")
    index = max(0, min(page_number - 1, len(pages) - 1))
    return pages[index]


def fetch_danmaku(cid):
    params = {"oid": str(cid)}
    raw = get_bytes(BILI_DM_API, params, referer=f"https://www.bilibili.com/video/")
    text = decode_bili_response(raw)
    root = ET.fromstring(text)
    items = []
    for node in root.findall("d"):
        p = (node.get("p") or "").split(",")
        if len(p) < 4:
            continue
        try:
            start = float(p[0])
            mode = int(float(p[1]))
            size = int(float(p[2]))
            color = int(float(p[3]))
        except ValueError:
            continue
        content = html.unescape(node.text or "").strip()
        if not content:
            continue
        items.append({"start": start, "mode": mode, "size": size, "color": color, "text": content})
    return sorted(items, key=lambda item: item["start"])


def select_danmaku(items, max_count):
    if max_count <= 0 or len(items) <= max_count:
        return items
    step = len(items) / max_count
    return [items[math.floor(i * step)] for i in range(max_count)]


def limit_danmaku_text(items, max_length):
    if max_length <= 0:
        return items
    limited = []
    for item in items:
        copy = dict(item)
        if len(copy["text"]) > max_length:
            copy["text"] = copy["text"][:max_length].rstrip() + "..."
        limited.append(copy)
    return limited


def get_play_url(aid, bvid, cid, quality):
    params = {
        "avid": str(aid or ""),
        "bvid": bvid or "",
        "cid": str(cid),
        "qn": str(quality),
        "type": "mp4",
        "otype": "json",
        "fnver": "0",
        "fnval": "0",
        "fourk": "1",
        "platform": "html5",
        "high_quality": "1" if int(quality) >= 80 else "0",
    }
    data = get_json(BILI_PLAY_API, params, referer="https://www.bilibili.com/")
    if data.get("code") != 0 or not data.get("data"):
        return {}
    return data["data"]


def extract_direct_url(play):
    durl = play.get("durl") if isinstance(play, dict) else None
    if isinstance(durl, list) and durl:
        return durl[0].get("url") or ""
    return ""


def build_ass(items, title, width, height, scroll_duration):
    lanes = max(8, height // 42)
    top_lanes = max(3, lanes // 5)
    bottom_lanes = max(3, lanes // 5)
    scroll_end = [0.0] * lanes
    top_end = [0.0] * top_lanes
    bottom_end = [0.0] * bottom_lanes
    lines = [
        "[Script Info]",
        f"Title: {title}",
        "ScriptType: v4.00+",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        f"PlayResX: {width}",
        f"PlayResY: {height}",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Danmaku,Microsoft YaHei,38,&H00FFFFFF,&H00FFFFFF,&HAA000000,&HAA000000,0,0,0,0,100,100,0,0,1,2,0,7,20,20,20,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]

    for item in items:
        start = item["start"]
        text = escape_ass(item["text"])
        color = ass_color(item["color"])
        size = clamp(item["size"], 18, 44)
        if item["mode"] == 5:
            lane = pick_lane(top_end, start)
            y = 32 + lane * 48
            top_end[lane] = start + 4.0
            ass = f"{{\\an8\\fs{size}\\c{color}\\pos({width // 2},{y})}}{text}"
            end = start + 4.0
        elif item["mode"] == 4:
            lane = pick_lane(bottom_end, start)
            y = height - 42 - lane * 48
            bottom_end[lane] = start + 4.0
            ass = f"{{\\an2\\fs{size}\\c{color}\\pos({width // 2},{y})}}{text}"
            end = start + 4.0
        else:
            lane = pick_lane(scroll_end, start)
            y = 28 + lane * 42
            estimated_width = estimate_text_width(item["text"], size)
            scroll_end[lane] = start + min(scroll_duration, max(3.5, scroll_duration * estimated_width / width))
            ass = f"{{\\an7\\fs{size}\\c{color}\\move({width + 24},{y},{-estimated_width - 24},{y})}}{text}"
            end = start + scroll_duration
        lines.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Danmaku,,0,0,0,,{ass}")
    return "\n".join(lines) + "\n"


def build_ffmpeg_script(direct_url, ass_name, safe_id):
    input_arg = direct_url or "PASTE_BILIBILI_DIRECT_URL_HERE"
    mp4_name = f"{safe_id}-danmaku.mp4"
    hls_dir = f"{safe_id}-hls"
    hls_index = f"{hls_dir}/index.m3u8"
    headers_arg = "$'Referer: https://www.bilibili.com\\r\\nUser-Agent: Mozilla/5.0\\r\\n'"
    return "\n".join([
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'mkdir -p ' + shlex.quote(hls_dir),
        "# 需要 ffmpeg；B 站直链会过期，请尽快执行。",
        "ffmpeg \\",
        "  -headers " + headers_arg + " \\",
        "  -i " + shlex.quote(input_arg) + " \\",
        "  -vf " + shlex.quote(f"subtitles={ass_name}") + " \\",
        "  -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p \\",
        "  -c:a aac -b:a 160k -movflags +faststart \\",
        "  " + shlex.quote(mp4_name),
        "",
        "ffmpeg \\",
        "  -i " + shlex.quote(mp4_name) + " \\",
        "  -c copy -f hls -hls_time 6 -hls_playlist_type vod \\",
        "  -hls_segment_filename " + shlex.quote(f"{hls_dir}/seg_%04d.ts") + " \\",
        "  " + shlex.quote(hls_index),
        "",
        "echo 'HLS playlist: " + hls_index + "'",
        "",
    ])


def get_json(url, params, referer):
    return json.loads(get_bytes(url, params, referer).decode("utf-8"))


def get_bytes(url, params, referer):
    full_url = url
    if params:
        full_url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        full_url,
        headers={
            "User-Agent": USER_AGENT,
            "Referer": referer,
            "Accept": "application/json, text/xml, */*",
            "Accept-Encoding": "identity",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = resp.read()
            encoding = (resp.headers.get("Content-Encoding") or "").lower()
    except urllib.error.URLError as error:
        raise SystemExit(f"请求失败：{error}") from error
    if encoding == "deflate":
        try:
            data = zlib.decompress(data)
        except zlib.error:
            data = zlib.decompress(data, -zlib.MAX_WBITS)
    return data


def decode_bili_response(data):
    for decoder in (
        lambda raw: raw.decode("utf-8"),
        lambda raw: zlib.decompress(raw).decode("utf-8"),
        lambda raw: zlib.decompress(raw, -zlib.MAX_WBITS).decode("utf-8"),
    ):
        try:
            return decoder(data)
        except Exception:
            pass
    return data.decode("utf-8", "replace")


def make_title(view, page):
    title = view.get("title") or "Bilibili Video"
    part = page.get("part") or ""
    if part and part != title and len(view.get("pages") or []) > 1:
        return f"{title} - {part}"
    return title


def pick_lane(ends, start):
    for index, end in enumerate(ends):
        if end <= start:
            return index
    index = min(range(len(ends)), key=lambda i: ends[i])
    return index


def estimate_text_width(text, size):
    width = 0
    for char in text:
        width += size if ord(char) > 127 else size * 0.58
    return int(width) + 24


def ass_color(rgb):
    rgb = int(rgb)
    r = (rgb >> 16) & 255
    g = (rgb >> 8) & 255
    b = rgb & 255
    return f"&H00{b:02X}{g:02X}{r:02X}"


def ass_time(seconds):
    seconds = max(0, float(seconds))
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    centiseconds = int(round((seconds - int(seconds)) * 100))
    if centiseconds >= 100:
        secs += 1
        centiseconds = 0
    return f"{hours}:{minutes:02d}:{secs:02d}.{centiseconds:02d}"


def escape_ass(text):
    return text.replace("\\", "\\\\").replace("{", "｛").replace("}", "｝").replace("\n", " ")


def host_of(url):
    if not url:
        return ""
    try:
        return urllib.parse.urlparse(url).netloc
    except ValueError:
        return ""


def positive_int(value, fallback):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    return number if number > 0 else fallback


def first(values):
    return values[0] if values else None


def clamp(value, low, high):
    return max(low, min(high, value))


if __name__ == "__main__":
    main()
