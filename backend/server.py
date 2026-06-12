#!/usr/bin/env python3
import argparse
import json
import mimetypes
import os
import secrets
import shutil
import subprocess
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import bili_danmaku_vrc


JOBS = {}
JOBS_LOCK = threading.Lock()
SERVER_CONFIG = {
    "jobs_dir": Path("jobs").resolve(),
    "base_url": "",
}


def main():
    parser = argparse.ArgumentParser(description="Tiny Bili danmaku-to-HLS backend prototype.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--jobs-dir", default="jobs")
    parser.add_argument("--base-url", default="", help="Public base URL, for example https://example.com")
    args = parser.parse_args()

    SERVER_CONFIG["jobs_dir"] = Path(args.jobs_dir).resolve()
    SERVER_CONFIG["jobs_dir"].mkdir(parents=True, exist_ok=True)
    SERVER_CONFIG["base_url"] = args.base_url.rstrip("/")

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Bili danmaku VRC backend: http://{args.host}:{args.port}")
    print(f"Jobs dir: {SERVER_CONFIG['jobs_dir']}")
    print("POST /api/jobs with JSON: {\"url\":\"https://www.bilibili.com/video/BV...\"}")
    server.serve_forever()


class Handler(BaseHTTPRequestHandler):
    server_version = "BiliDanmakuVRC/0.1"

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/":
            self.send_html(index_html())
            return
        if path.startswith("/api/jobs/"):
            self.handle_get_job(path.rsplit("/", 1)[-1])
            return
        if path.startswith("/media/"):
            self.handle_media(path)
            return
        self.send_error(404, "Not found")

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/jobs":
            self.handle_create_job()
            return
        self.send_error(404, "Not found")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def handle_create_job(self):
        try:
            body = self.read_body()
            data = parse_request_data(body, self.headers.get("Content-Type", ""))
            url = str(data.get("url", "")).strip()
            if not url:
                raise ValueError("缺少 url")
            params = {
                "url": url,
                "quality": normalized_choice(data.get("quality"), ["80", "64", "32", "16"], "80"),
                "page": positive_int(data.get("page"), None),
                "max_danmaku": positive_int(data.get("maxDanmaku"), 1200),
                "max_text_length": positive_int(data.get("maxTextLength"), 80),
            }
        except ValueError as error:
            self.send_json({"ok": False, "error": str(error)}, status=400)
            return

        job_id = secrets.token_urlsafe(9)
        now = iso_now()
        job = {
            "id": job_id,
            "status": "queued",
            "message": "排队中",
            "createdAt": now,
            "updatedAt": now,
            "params": {
                "quality": params["quality"],
                "page": params["page"],
                "maxDanmaku": params["max_danmaku"],
                "maxTextLength": params["max_text_length"],
            },
        }
        with JOBS_LOCK:
            JOBS[job_id] = job

        thread = threading.Thread(target=run_job, args=(job_id, params), daemon=True)
        thread.start()
        self.send_json({"ok": True, "job": public_job(job, self.public_base())}, status=202)

    def handle_get_job(self, job_id):
        with JOBS_LOCK:
            job = JOBS.get(job_id)
        if not job:
            self.send_json({"ok": False, "error": "任务不存在"}, status=404)
            return
        self.send_json({"ok": True, "job": public_job(job, self.public_base())})

    def handle_media(self, path):
        parts = path.split("/")
        if len(parts) < 4:
            self.send_error(404, "Not found")
            return
        job_id = parts[2]
        relative = "/".join(parts[3:])
        with JOBS_LOCK:
            job = JOBS.get(job_id)
        if not job or job.get("status") != "ready":
            self.send_error(404, "Media not ready")
            return
        root = Path(job["hlsDir"]).resolve()
        target = (root / relative).resolve()
        if root not in target.parents and target != root:
            self.send_error(403, "Forbidden")
            return
        if not target.is_file():
            self.send_error(404, "Not found")
            return
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_body(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length > 64 * 1024:
            raise ValueError("请求太大")
        return self.rfile.read(length)

    def public_base(self):
        if SERVER_CONFIG["base_url"]:
            return SERVER_CONFIG["base_url"]
        host = self.headers.get("Host") or f"{self.server.server_address[0]}:{self.server.server_address[1]}"
        return f"http://{host}"

    def send_html(self, text, status=200):
        data = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


def run_job(job_id, params):
    update_job(job_id, status="generating", message="正在拉取视频信息和弹幕")
    job_dir = SERVER_CONFIG["jobs_dir"] / job_id
    work_dir = job_dir / "work"
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        result = bili_danmaku_vrc.generate_artifacts(
            params["url"],
            quality=params["quality"],
            page_override=params["page"],
            out_dir=work_dir,
            max_danmaku=params["max_danmaku"],
            max_text_length=params["max_text_length"],
        )
        safe_id = result["safeId"]
        command_path = Path(result["commandPath"]).resolve()
        update_job(
            job_id,
            status="transcoding",
            message="弹幕已生成，正在准备转码",
            meta=result["meta"],
            safeId=safe_id,
            assPath=str(Path(result["assPath"]).resolve()),
            commandPath=str(command_path),
        )

        ffmpeg_path = shutil.which("ffmpeg")
        if not ffmpeg_path:
            update_job(
                job_id,
                status="needs_ffmpeg",
                message="已生成弹幕和转码命令，但这台机器没有 ffmpeg",
                commandPath=str(command_path),
            )
            return

        log_path = work_dir / f"{safe_id}.ffmpeg.log"
        with log_path.open("w", encoding="utf-8") as log:
            process = subprocess.run(
                ["bash", command_path.name],
                cwd=work_dir,
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=60 * 60,
                check=False,
            )
        if process.returncode != 0:
            update_job(
                job_id,
                status="error",
                message="ffmpeg 转码失败，请查看日志",
                logPath=str(log_path.resolve()),
            )
            return

        hls_dir = work_dir / f"{safe_id}-hls"
        index_path = hls_dir / "index.m3u8"
        if not index_path.is_file():
            update_job(job_id, status="error", message="转码完成但没有找到 index.m3u8")
            return
        update_job(
            job_id,
            status="ready",
            message="带弹幕 HLS 已生成",
            hlsDir=str(hls_dir.resolve()),
            hlsPath=str(index_path.resolve()),
            mediaPath=f"/media/{job_id}/index.m3u8",
        )
    except BaseException as error:
        update_job(job_id, status="error", message=str(error))


def update_job(job_id, **changes):
    changes["updatedAt"] = iso_now()
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job:
            job.update(changes)


def public_job(job, base_url):
    data = {
        "id": job["id"],
        "status": job["status"],
        "message": job["message"],
        "createdAt": job["createdAt"],
        "updatedAt": job["updatedAt"],
        "params": job.get("params", {}),
        "meta": job.get("meta"),
    }
    if job.get("status") == "ready" and job.get("mediaPath"):
        data["hlsUrl"] = base_url + job["mediaPath"]
    if job.get("status") == "needs_ffmpeg":
        data["commandPath"] = job.get("commandPath")
    if job.get("status") == "error":
        data["logPath"] = job.get("logPath")
    return data


def parse_request_data(body, content_type):
    text = body.decode("utf-8", "replace")
    if "application/json" in content_type:
        return json.loads(text or "{}")
    parsed = urllib.parse.parse_qs(text)
    return {key: values[-1] for key, values in parsed.items()}


def normalized_choice(value, allowed, fallback):
    text = str(value or fallback)
    return text if text in allowed else fallback


def positive_int(value, fallback):
    if value in (None, ""):
        return fallback
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    return number if number > 0 else fallback


def iso_now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def index_html():
    return """<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Bili Danmaku VRC Backend</title>
    <style>
      body { margin: 32px; font: 15px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #2b2927; background: #fffaf1; }
      main { max-width: 720px; margin: 0 auto; }
      input, select, button { font: inherit; min-height: 38px; border: 1px solid #eadbc8; border-radius: 8px; padding: 0 10px; }
      input { width: min(560px, 100%); }
      button { background: #e8f8ee; color: #1f6b42; border-color: #9de2b9; font-weight: 700; cursor: pointer; }
      form, pre { margin-top: 16px; }
      pre { overflow: auto; padding: 12px; border: 1px solid #eadbc8; border-radius: 8px; background: #fffdf8; }
    </style>
  </head>
  <body>
    <main>
      <h1>Bili Danmaku VRC Backend</h1>
      <p>输入 B 站普通视频链接，生成带弹幕 HLS 任务。服务器需要安装 ffmpeg 才能自动转码。</p>
      <form id="form">
        <input name="url" placeholder="https://www.bilibili.com/video/BV..." required>
        <select name="quality">
          <option value="80">1080P / 最高可用</option>
          <option value="64">720P</option>
          <option value="32">480P</option>
          <option value="16">360P</option>
        </select>
        <button>创建任务</button>
      </form>
      <pre id="output">等待任务...</pre>
    </main>
    <script>
      const form = document.getElementById("form");
      const output = document.getElementById("output");
      let timer = 0;
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearInterval(timer);
        const body = Object.fromEntries(new FormData(form).entries());
        const response = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const data = await response.json();
        output.textContent = JSON.stringify(data, null, 2);
        if (data.ok) {
          timer = setInterval(() => poll(data.job.id), 2000);
          poll(data.job.id);
        }
      });
      async function poll(id) {
        const response = await fetch(`/api/jobs/${id}`);
        const data = await response.json();
        output.textContent = JSON.stringify(data, null, 2);
        if (!data.ok || ["ready", "needs_ffmpeg", "error"].includes(data.job.status)) clearInterval(timer);
      }
    </script>
  </body>
</html>"""


if __name__ == "__main__":
    main()
