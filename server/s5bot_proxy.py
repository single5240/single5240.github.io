#!/usr/bin/env python3
"""S5·BOT chat proxy.

A dependency-free (stdlib only) HTTP proxy that lets the static site call an
OpenAI-compatible chat endpoint without exposing the model API key to the
browser. It injects the shared persona system prompt, streams the upstream
SSE response back to the client, enforces same-origin and per-IP rate limits.

Designed to bind to 127.0.0.1 only; Nginx reverse-proxies /api/ to it.

Environment variables:
  S5BOT_UPSTREAM        Base URL of the OpenAI-compatible API, e.g.
                        https://api.openai.com/v1  or  https://api.deepseek.com/v1
  S5BOT_API_KEY         The upstream API key. REQUIRED. Never commit it.
  S5BOT_MODEL           Model id to use. REQUIRED.
  S5BOT_PERSONA_PATH    Path to bot-persona.json (shared with the frontend).
  S5BOT_ALLOWED_ORIGIN  Exact allowed Origin (e.g. https://single5240.cn).
                        If unset, requests without an Origin header are allowed
                        (same-origin fetches from a same-site page send none or
                        the site origin, depending on browser).
  S5BOT_RATE_PER_MIN    Max requests per client IP per minute (default 12).
  S5BOT_HOST            Bind host (default 127.0.0.1 — keep it loopback).
  S5BOT_PORT            Bind port (default 8765).
"""

import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM = os.environ.get("S5BOT_UPSTREAM", "").rstrip("/")
API_KEY = os.environ.get("S5BOT_API_KEY", "")
MODEL = os.environ.get("S5BOT_MODEL", "")
PERSONA_PATH = os.environ.get("S5BOT_PERSONA_PATH", "")
ALLOWED_ORIGIN = os.environ.get("S5BOT_ALLOWED_ORIGIN", "").rstrip("/")
RATE_PER_MIN = int(os.environ.get("S5BOT_RATE_PER_MIN", "12"))
HOST = os.environ.get("S5BOT_HOST", "127.0.0.1")
PORT = int(os.environ.get("S5BOT_PORT", "8765"))

MAX_BODY_BYTES = 16 * 1024
MAX_MESSAGES = 14
MAX_CONTENT_CHARS = 2000

# ----- load shared persona system prompt at startup -----
def load_system_prompt():
    path = PERSONA_PATH
    if not path:
        here = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(here, "..", "assets", "data", "bot-persona.json")
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        prompt = data["systemPrompt"]
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("empty systemPrompt")
        return prompt.strip()
    except Exception as exc:  # noqa: BLE001 - fail fast with a clear reason
        print(f"[s5bot] cannot load persona from {path}: {exc}", file=sys.stderr)
        sys.exit(1)

SYSTEM_PROMPT = load_system_prompt()

# ----- naive per-IP sliding-window rate limit -----
_rate_lock = threading.Lock()
_hits = defaultdict(deque)


def allow(ip):
    now = time.monotonic()
    with _rate_lock:
        bucket = _hits[ip]
        while bucket and bucket[0] <= now - 60:
            bucket.popleft()
        if len(bucket) >= RATE_PER_MIN:
            return False
        bucket.append(now)
        return True


def sanitize_messages(raw):
    """Return a clean list of {role, content} or None if invalid."""
    if not isinstance(raw, list) or not (1 <= len(raw) <= MAX_MESSAGES):
        return None
    clean = []
    for item in raw:
        if not isinstance(item, dict):
            return None
        role = item.get("role")
        content = item.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str):
            return None
        content = content.strip()
        if not content or len(content) > MAX_CONTENT_CHARS:
            return None
        clean.append({"role": role, "content": content})
    return clean or None


class ChatHandler(BaseHTTPRequestHandler):
    server_version = "S5BotProxy/1.0"

    def log_message(self, fmt, *args):
        # Avoid logging query content; keep only status lines.
        sys.stderr.write("[s5bot] %s - %s\n" % (self.address_string(), fmt % args))

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _origin_ok(self):
        if not ALLOWED_ORIGIN:
            return True
        origin = self.headers.get("Origin", "")
        return origin == ALLOWED_ORIGIN

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/health":
            self._send_json(200, {"ok": True, "modelConfigured": bool(API_KEY and MODEL)})
        else:
            self._send_json(404, {"error": "not_found"})

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path != "/api/chat":
            self._send_json(404, {"error": "not_found"})
            return

        if not self._origin_ok():
            self._send_json(403, {"error": "origin_not_allowed"})
            return
        if not (API_KEY and MODEL and UPSTREAM):
            self._send_json(503, {"error": "server_not_configured"})
            return

        client_ip = self.client_address[0]
        if not allow(client_ip):
            self._send_json(429, {"error": "rate_limited"})
            return

        length = self.headers.get("Content-Length")
        try:
            length = int(length) if length is not None else -1
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY_BYTES:
            self._send_json(413, {"error": "body_too_large"})
            return

        try:
            raw = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send_json(400, {"error": "invalid_json"})
            return

        messages = sanitize_messages(raw.get("messages")) if isinstance(raw, dict) else None
        if messages is None:
            self._send_json(400, {"error": "invalid_messages"})
            return

        payload = {
            "model": MODEL,
            "stream": True,
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + messages,
        }
        upstream_req = urllib.request.Request(
            UPSTREAM + "/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + API_KEY,
                "Accept": "text/event-stream",
            },
            method="POST",
        )

        try:
            upstream = urllib.request.urlopen(upstream_req, timeout=60)
        except urllib.error.HTTPError as exc:
            body = exc.read(512).decode("utf-8", "replace")
            self._send_json(502, {"error": "upstream_http_error", "status": exc.code, "detail": body[:256]})
            return
        except urllib.error.URLError as exc:
            self._send_json(502, {"error": "upstream_unreachable", "detail": str(exc.reason)[:256]})
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")  # let Nginx stream without buffering
        self.end_headers()

        try:
            while True:
                line = upstream.readline()
                if not line:
                    break
                self.wfile.write(line)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # client closed early / pressed stop
        finally:
            upstream.close()


def main():
    if not (API_KEY and MODEL and UPSTREAM):
        print("[s5bot] S5BOT_UPSTREAM, S5BOT_API_KEY and S5BOT_MODEL must be set", file=sys.stderr)
        sys.exit(1)
    server = ThreadingHTTPServer((HOST, PORT), ChatHandler)
    print(f"[s5bot] listening on {HOST}:{PORT} -> {UPSTREAM} (model {MODEL})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
