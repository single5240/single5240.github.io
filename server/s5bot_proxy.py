#!/usr/bin/env python3
"""S5·BOT chat proxy.

A dependency-free (stdlib only) HTTP proxy that lets the static site call an
OpenAI Responses endpoint without exposing the model API key to the browser.
It injects the shared persona as Responses `instructions`, translates the
upstream SSE stream into Chat Completions chunks for the existing frontend,
and enforces same-origin and per-IP rate limits.

Designed to bind to 127.0.0.1 only; Nginx reverse-proxies /api/ to it.

Environment variables:
  S5BOT_UPSTREAM        Primary base URL, without /responses or /chat/completions.
  S5BOT_API_KEY         Primary upstream API key. Never commit it.
  S5BOT_MODEL           Primary model id.
  S5BOT_API             Primary protocol: responses (default) or chat.
  S5BOT_POOL_1 .. _24   Optional entries, each "base|api_key|model" or
                        "base|api_key|model|chat". The fourth field selects
                        chat completions; omitted means responses. Use model
                        "*" to read that API's /models list at startup and
                        publish each chat model as its own choice. Distinct
                        model ids become choices on the site. Entries that
                        share a model id stay backups for that choice and are
                        tried in order when it errors before any text is sent.
  S5BOT_POOL_COOLDOWN   Seconds to deprioritize a failed upstream (default 45).
  S5BOT_HIDE_MODELS     Comma-separated public model ids (or bare model names)
                        to hide from /api/health and reject on /api/chat.
                        Merged with the temporary probe hide list in code.
  S5BOT_PERSONA_PATH    Path to bot-persona.json (shared with the frontend).
  S5BOT_ALLOWED_ORIGIN  Allowed Origin, or a comma-separated list.
                        If unset, requests without an Origin header are allowed
                        (same-origin fetches from a same-site page send none or
                        the site origin, depending on browser).
  S5BOT_USER_AGENT      User-Agent sent upstream. Some gateways only allow
                        known programming clients. Default: opencode/1.19.6
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

PERSONA_PATH = os.environ.get("S5BOT_PERSONA_PATH", "")
ALLOWED_ORIGINS = {
    item.strip().rstrip("/")
    for item in os.environ.get("S5BOT_ALLOWED_ORIGIN", "").split(",")
    if item.strip()
}
USER_AGENT = os.environ.get("S5BOT_USER_AGENT", "opencode/1.19.6")
RATE_PER_MIN = int(os.environ.get("S5BOT_RATE_PER_MIN", "12"))
POOL_COOLDOWN = int(os.environ.get("S5BOT_POOL_COOLDOWN", "45"))
HOST = os.environ.get("S5BOT_HOST", "127.0.0.1")
PORT = int(os.environ.get("S5BOT_PORT", "8765"))
MAX_POOLS = 24

MAX_BODY_BYTES = 192 * 1024
MAX_MESSAGES = 14
MAX_CONTENT_CHARS = 72000
MAX_TOTAL_CHARS = 96000

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


API_ALIASES = {
    "responses": "responses",
    "response": "responses",
    "chat": "chat",
    "completions": "chat",
    "chat_completions": "chat",
    "chat-completions": "chat",
}


class Upstream:
    def __init__(self, name, base, key, model, api):
        self.name = name
        self.base = base
        self.key = key
        self.model = model
        self.api = api


def normalize_api(value):
    key = value.strip().lower()
    if key not in API_ALIASES:
        raise ValueError(f"unknown api {value!r}; use responses or chat")
    return API_ALIASES[key]


def normalize_base(base):
    base = base.rstrip("/")
    for suffix in ("/chat/completions", "/responses"):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
            break
    return base


def parse_pool_record(text, name):
    parts = [part.strip() for part in text.split("|")]
    if len(parts) == 3:
        base, key, model = parts
        api = "responses"
    elif len(parts) == 4:
        base, key, model, api = parts
        api = normalize_api(api)
    else:
        raise ValueError(f"{name} must be base|api_key|model or base|api_key|model|chat")
    if not (base and key and model):
        raise ValueError(f"{name} must be base|api_key|model or base|api_key|model|chat")
    return Upstream(name, normalize_base(base), key, model, api)


def load_upstreams(environ):
    entries = []
    primary = (
        environ.get("S5BOT_UPSTREAM", "").strip(),
        environ.get("S5BOT_API_KEY", "").strip(),
        environ.get("S5BOT_MODEL", "").strip(),
    )
    if any(primary):
        if not all(primary):
            raise ValueError("primary upstream needs S5BOT_UPSTREAM, S5BOT_API_KEY and S5BOT_MODEL together")
        api = normalize_api(environ.get("S5BOT_API", "responses") or "responses")
        entries.append(Upstream("primary", normalize_base(primary[0]), primary[1], primary[2], api))
    for index in range(1, MAX_POOLS + 1):
        raw = environ.get(f"S5BOT_POOL_{index}", "").strip()
        if raw:
            entries.append(parse_pool_record(raw, f"backup-{index}"))
    return entries


class PoolOrder:
    """Prefer upstreams that have not just failed. Still try cooled ones last."""

    def __init__(self, entries, cooldown):
        self.entries = entries
        self.cooldown = cooldown
        self._down_until = [0.0] * len(entries)
        self._lock = threading.Lock()

    def order(self):
        now = time.monotonic()
        with self._lock:
            ready = [i for i, until in enumerate(self._down_until) if until <= now]
            cooling = [i for i, until in enumerate(self._down_until) if until > now]
        return ready + cooling

    def mark_down(self, index):
        with self._lock:
            self._down_until[index] = time.monotonic() + self.cooldown

    def mark_up(self, index):
        with self._lock:
            self._down_until[index] = 0.0


def _content_chunk(translated):
    return b'"content"' in translated


def _error_chunk(translated):
    return translated.startswith(b"data: {") and b'"error"' in translated


def read_until_content(upstream, api):
    """Buffer a stream until the first text delta.

    Raises ValueError when the upstream finishes, or reports an error, before
    producing text. The caller can then try another pool without having sent
    anything to the browser.
    """
    pending = []
    while True:
        line = upstream.readline()
        if not line:
            break
        translated = translate_line(line, api)
        if not translated:
            continue
        if _error_chunk(translated):
            raise ValueError("upstream error event")
        pending.append(translated)
        if _content_chunk(translated):
            return pending
        if translated.startswith(b"data: [DONE]"):
            break
    raise ValueError("upstream produced no text")


SKIP_ENDPOINT_TYPES = {"video-generation", "image-generation", "image-edit"}
CHAT_ENDPOINT_TYPES = {"openai", "openai-response", "anthropic"}
SKIP_MODEL_WORDS = ("image", "video", "vidu", "seedance", "wan", "banana", "claude", "astra")
BLOCKED_MODEL_IDS = {
    "gemini-4-carbon",
    "glm-5.3",
    # Live probe 2026-11-22: catalog entries that timed out / returned 502.
    "gpt-5.6-sol",
    "gpt-6-sol",
    "gpt-6.1-terra",
    "gemini-3.8-flash",
    "gemini-4-hydrogen",
    "gemini-4-neon",
    "grok-4.5",
    "grok-4.7",
    "deepseek-v4-pro-0813",
    "deepseek-v4.1-flash-1017",
    # Live probe 2026-11-24: no text within 45s, or 502 before any token.
    # Keep this id out of * catalogs. Explicit pool keys are selected separately.
    "deepseek-v4.1-flash",
    "deepseek-v4-pro",
    "deepseek-flash",
    "deepseek-v4.1-flash:1017",
    "glm-5.3-flash",
    "gpt-5.6-luna",
    "gpt-6-luna",
}

# Temporary hide list for the model selector (group id or bare model name).
# Extend or override at runtime with S5BOT_HIDE_MODELS without editing code.
TEMP_HIDDEN_MODEL_IDS = {
    "gpt-6.1-sol|responses",
    "gpt-5.6-sol",
    "gpt-6-sol",
    "gpt-6.1-terra",
    "gemini-3.8-flash",
    "gemini-4-hydrogen",
    "gemini-4-neon",
    "grok-4.5",
    "grok-4.7",
    "deepseek-v4-pro-0813",
    "deepseek-v4.1-flash-1017",
    "deepseek-v4-pro",
    "deepseek-flash",
    "deepseek-v4.1-flash:1017",
    "glm-5.3-flash",
    "gpt-5.6-luna",
    "gpt-6-luna",
}


def is_chat_catalog_model(item):
    """Keep text chat models. Image and video catalogs stay off the selector."""
    if not isinstance(item, dict):
        return False
    model_id = item.get("id")
    if not isinstance(model_id, str):
        return False
    model_id = model_id.strip()
    if not model_id or model_id == "*" or len(model_id) > 160:
        return False
    types = item.get("supported_endpoint_types") or []
    if not isinstance(types, list):
        types = []
    kinds = {str(kind) for kind in types}
    if kinds & SKIP_ENDPOINT_TYPES:
        return False
    if kinds and not (kinds & CHAT_ENDPOINT_TYPES):
        return False
    lowered = model_id.lower()
    if lowered in BLOCKED_MODEL_IDS:
        return False
    if any(word in lowered for word in SKIP_MODEL_WORDS):
        return False
    return True


def catalog_model_ids(payload):
    items = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        return []
    found = []
    seen = set()
    for item in items:
        if not is_chat_catalog_model(item):
            continue
        model_id = item["id"].strip()
        if model_id in seen:
            continue
        seen.add(model_id)
        found.append(model_id)
    return found


def fetch_catalog_models(entry):
    request = urllib.request.Request(
        entry.base + "/models",
        headers={
            "Authorization": "Bearer " + entry.key,
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return catalog_model_ids(payload)


def expand_catalog(entries, fetch=None):
    """Turn a model id of * into one upstream per chat model. Keys stay put."""
    fetch = fetch_catalog_models if fetch is None else fetch
    expanded = []
    for entry in entries:
        if entry.model != "*":
            expanded.append(entry)
            continue
        try:
            model_ids = fetch(entry)
        except Exception as exc:  # noqa: BLE001 - a dead catalog must not drop the other pools
            print(f"[s5bot] {entry.name} model list unavailable ({exc.__class__.__name__})", file=sys.stderr)
            continue
        if not model_ids:
            print(f"[s5bot] {entry.name} model list was empty", file=sys.stderr)
            continue
        for model_id in model_ids:
            expanded.append(Upstream(
                f"{entry.name}:{model_id}",
                entry.base,
                entry.key,
                model_id,
                entry.api,
            ))
    return expanded


def build_model_groups(entries):
    """One public choice per model id and protocol. Keys stay server-side."""
    grouped = []
    by_key = {}
    for index, entry in enumerate(entries):
        key = (entry.model, entry.api)
        group = by_key.get(key)
        if group is None:
            group = {"model": entry.model, "api": entry.api, "indices": []}
            by_key[key] = group
            grouped.append(group)
        group["indices"].append(index)
    used = set()
    for group in grouped:
        shared = sum(1 for item in grouped if item["model"] == group["model"]) > 1
        ident = group["model"] + ("|" + group["api"] if shared else "")
        suffix = 2
        while ident in used:
            ident = group["model"] + "|" + group["api"] + "-" + str(suffix)
            suffix += 1
        used.add(ident)
        group["id"] = ident
        group["label"] = group["model"] if ident == group["model"] else group["model"] + " · " + group["api"]
    return grouped


def load_hidden_models(environ=None):
    """Merge the temporary probe hide list with S5BOT_HIDE_MODELS."""
    env = os.environ if environ is None else environ
    hidden = set(TEMP_HIDDEN_MODEL_IDS)
    for item in env.get("S5BOT_HIDE_MODELS", "").split(","):
        item = item.strip()
        if item:
            hidden.add(item)
    return hidden


def filter_visible_groups(groups, hidden):
    """Drop temporarily shielded choices from the public selector."""
    if not hidden:
        return groups
    visible = []
    for group in groups:
        if group["id"] in hidden or group["model"] in hidden:
            continue
        visible.append(group)
    return visible


UPSTREAMS = []
POOL = None
MODEL_GROUPS = []
MODEL_BY_ID = {}
HIDDEN_MODELS = set()


def configure(environ=None):
    global UPSTREAMS, POOL, MODEL_GROUPS, MODEL_BY_ID, HIDDEN_MODELS
    env = os.environ if environ is None else environ
    loaded = load_upstreams(env)
    UPSTREAMS = expand_catalog(loaded)
    POOL = PoolOrder(UPSTREAMS, POOL_COOLDOWN)
    HIDDEN_MODELS = load_hidden_models(env)
    MODEL_GROUPS = filter_visible_groups(build_model_groups(UPSTREAMS), HIDDEN_MODELS)
    MODEL_BY_ID = {group["id"]: group for group in MODEL_GROUPS}
    if HIDDEN_MODELS:
        print(
            f"[s5bot] hiding {len(HIDDEN_MODELS)} model id(s); "
            f"{len(MODEL_GROUPS)} choice(s) visible",
            file=sys.stderr,
        )
    return UPSTREAMS


def requested_model(raw):
    """Return a public model id, or None when the client asked for an unknown one."""
    if not MODEL_GROUPS:
        return None
    if not isinstance(raw, dict) or raw.get("model") in (None, ""):
        return MODEL_GROUPS[0]["id"]
    value = raw.get("model")
    if not isinstance(value, str) or len(value) > 160 or value not in MODEL_BY_ID:
        return None
    return value

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


def translate_line(line, api):
    if api == "chat":
        return translate_chat_line(line)
    return translate_responses_line(line)


def translate_chat_line(line):
    """Keep one Chat Completions SSE line, dropping empty role-only deltas."""
    if not line.startswith(b"data:"):
        return None
    payload = line[5:].strip()
    if not payload:
        return None
    if payload == b"[DONE]":
        return b"data: [DONE]\n\n"
    try:
        chunk = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(chunk, dict):
        return None
    if chunk.get("error"):
        body = json.dumps({"error": chunk["error"]}, ensure_ascii=False)
        return ("data: " + body + "\n\n").encode("utf-8")
    choices = chunk.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        return None
    delta = choices[0].get("delta")
    content = delta.get("content") if isinstance(delta, dict) else None
    if not isinstance(content, str) or not content:
        content = choices[0].get("text")
    if not isinstance(content, str) or not content:
        return None
    body = json.dumps(
        {"choices": [{"delta": {"content": content}}]},
        ensure_ascii=False,
    )
    return ("data: " + body + "\n\n").encode("utf-8")


def translate_responses_line(line):
    """Turn one Responses SSE line into a Chat Completions chunk, or None."""
    if not line.startswith(b"data:"):
        return None
    payload = line[5:].strip()
    if not payload:
        return None
    if payload == b"[DONE]":
        return b"data: [DONE]\n\n"
    try:
        chunk = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(chunk, dict):
        return None
    if chunk.get("error"):
        body = json.dumps({"error": chunk["error"]}, ensure_ascii=False)
        return ("data: " + body + "\n\n").encode("utf-8")
    event_type = chunk.get("type") or ""
    if event_type == "response.output_text.delta":
        delta = chunk.get("delta") or ""
        if not isinstance(delta, str) or not delta:
            return None
        body = json.dumps(
            {"choices": [{"delta": {"content": delta}}]},
            ensure_ascii=False,
        )
        return ("data: " + body + "\n\n").encode("utf-8")
    if event_type in ("response.completed", "response.failed", "response.incomplete"):
        return b"data: [DONE]\n\n"
    return None


def sanitize_messages(raw):
    """Return a clean list of {role, content} or None if invalid."""
    if not isinstance(raw, list) or not (1 <= len(raw) <= MAX_MESSAGES):
        return None
    clean = []
    total = 0
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
        total += len(content)
        if total > MAX_TOTAL_CHARS:
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
        if not ALLOWED_ORIGINS:
            return True
        origin = self.headers.get("Origin", "").rstrip("/")
        return origin in ALLOWED_ORIGINS

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/health":
            self._send_json(200, {
                "ok": True,
                "modelConfigured": bool(UPSTREAMS),
                "poolCount": len(UPSTREAMS),
                "models": [
                    {"id": group["id"], "label": group["label"]}
                    for group in MODEL_GROUPS
                ],
            })
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
        if not UPSTREAMS:
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
        model_id = requested_model(raw)
        if model_id is None:
            self._send_json(400, {"error": "invalid_model"})
            return
        allowed = set(MODEL_BY_ID[model_id]["indices"])

        upstream = None
        pending = None
        chosen = None
        failures = []
        for index in POOL.order():
            if index not in allowed:
                continue
            entry = UPSTREAMS[index]
            opened = None
            try:
                opened = open_upstream(entry, messages)
                pending = read_until_content(opened, entry.api)
            except Exception as exc:  # noqa: BLE001 - any pre-output failure may fail over
                if opened is not None:
                    opened.close()
                POOL.mark_down(index)
                reason = exc.__class__.__name__
                if isinstance(exc, urllib.error.HTTPError):
                    reason = f"HTTP {exc.code}"
                    exc.close()
                failures.append(entry.name)
                print(f"[s5bot] {entry.name} unavailable ({reason}); trying next", file=sys.stderr)
                continue
            POOL.mark_up(index)
            upstream = opened
            chosen = index
            break

        if upstream is None:
            self._send_json(502, {"error": "upstream_unavailable", "tried": failures})
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")  # let Nginx stream without buffering
        self.end_headers()

        try:
            saw_done = False
            for translated in pending:
                if translated.startswith(b"data: [DONE]"):
                    saw_done = True
                self.wfile.write(translated)
                self.wfile.flush()
            while True:
                line = upstream.readline()
                if not line:
                    break
                translated = translate_line(line, UPSTREAMS[chosen].api)
                if not translated:
                    continue
                if translated.startswith(b"data: [DONE]"):
                    saw_done = True
                self.wfile.write(translated)
                self.wfile.flush()
            if not saw_done:
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # client closed early / pressed stop
        finally:
            upstream.close()
            if chosen is not None:
                print(
                    f"[s5bot] replied via {UPSTREAMS[chosen].name} model={model_id}",
                    file=sys.stderr,
                )


def open_upstream(entry, messages):
    if entry.api == "chat":
        path = "/chat/completions"
        payload = {
            "model": entry.model,
            "stream": True,
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + messages,
        }
    else:
        path = "/responses"
        payload = {
            "model": entry.model,
            "stream": True,
            "store": False,
            "instructions": SYSTEM_PROMPT,
            "input": messages,
        }
    request = urllib.request.Request(
        entry.base + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + entry.key,
            "Accept": "text/event-stream",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    return urllib.request.urlopen(request, timeout=60)


def main():
    try:
        configure()
    except ValueError as exc:
        print(f"[s5bot] {exc}", file=sys.stderr)
        sys.exit(1)
    if not UPSTREAMS:
        print("[s5bot] set S5BOT_UPSTREAM/API_KEY/MODEL or at least one S5BOT_POOL_N", file=sys.stderr)
        sys.exit(1)
    server = ThreadingHTTPServer((HOST, PORT), ChatHandler)
    summary = ", ".join(entry.name for entry in UPSTREAMS)
    print(f"[s5bot] listening on {HOST}:{PORT} pools={len(UPSTREAMS)} ({summary})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
