(() => {
  "use strict";

  const TAG = "[S5BotChat]";

  const configScript = document.querySelector("script[data-bot-chat-config]");
  if (!configScript) return;

  const personaUrl = configScript.getAttribute("data-persona") || "/assets/data/bot-persona.json";
  const apiBase = (configScript.getAttribute("data-api") || "/api").replace(/\/$/, "");

  let persona = null;
  let personaOk = false;
  let apiAvailable = true;
  const mounted = [];

  const escapeText = (value) => String(value == null ? "" : value);

  function loadPersona() {
    return fetch(personaUrl, { cache: "no-cache" })
      .then((res) => {
        if (!res.ok) throw new Error("persona http " + res.status);
        return res.json();
      })
      .then((data) => {
        if (!data || !data.display || !data.systemPrompt) throw new Error("persona shape");
        persona = data;
        personaOk = true;
        return data;
      })
      .catch((error) => {
        console.warn(TAG, "角色卡加载失败", error);
        return null;
      });
  }

  function appendBubble(list, role, text) {
    const row = document.createElement("div");
    row.className = "s5-msg-row s5-msg-" + role;

    const avatar = document.createElement("span");
    avatar.className = "s5-msg-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = role === "assistant" ? (persona?.display?.avatarGlyph || "S5") : "我";

    const bubble = document.createElement("div");
    bubble.className = "s5-msg-bubble";
    bubble.textContent = escapeText(text);

    row.appendChild(avatar);
    row.appendChild(bubble);
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
    return bubble;
  }

  function setStatus(panel, message, kind) {
    const status = panel.querySelector(".s5-chat-status");
    if (!status) return;
    status.textContent = message || "";
    status.className = "s5-chat-status" + (kind ? " is-" + kind : "");
    status.hidden = !message;
  }

  function collectHistory(list, limit) {
    const rows = [...list.querySelectorAll(".s5-msg-row")].slice(-limit);
    const history = [];
    for (const row of rows) {
      const isUser = row.classList.contains("s5-msg-user");
      const text = row.querySelector(".s5-msg-bubble")?.textContent || "";
      if (text) history.push({ role: isUser ? "user" : "assistant", content: text });
    }
    return history;
  }

  async function streamChat({ messages, onDelta, signal }) {
    const res = await fetch(apiBase + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ messages }),
      signal,
    });

    const contentType = res.headers.get("content-type") || "";
    if (!res.ok || !contentType.includes("text/event-stream")) {
      const error = new Error("chat unavailable");
      error.code = res.status === 404 ? "not_found" : "bad_response";
      throw error;
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("no stream reader");

    const decoder = new TextDecoder();
    let buffer = "";
    let received = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let chunk;
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }
        if (chunk.error) throw new Error("upstream error");
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          received = true;
          onDelta(delta);
        }
      }
    }
    if (!received) throw new Error("empty stream");
  }

  function degrade(panel, list) {
    apiAvailable = false;
    if (!panel || panel.dataset.s5Offline === "1") return;
    panel.dataset.s5Offline = "1";
    panel.classList.add("is-offline");
    panel.querySelectorAll(".s5-ask-input, .s5-send-btn, .s5-suggest-btn").forEach((el) => {
      el.disabled = true;
    });
    const hint = persona?.staticNotice ||
      "当前站点未启用在线对话。角色卡可正常查看；完整 AI 对话请访问主站 single5240.cn。";
    if (list) {
      const note = document.createElement("div");
      note.className = "s5-offline-note";
      note.textContent = hint;
      list.appendChild(note);
      list.scrollTop = list.scrollHeight;
    }
    setStatus(panel, "静态模式", "warn");
  }

  function renderCardHead(panel) {
    const display = persona.display;
    const head = document.createElement("div");
    head.className = "s5-persona-head";

    const avatar = document.createElement("div");
    avatar.className = "s5-persona-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = display.avatarGlyph || "S5";

    const info = document.createElement("div");
    info.className = "s5-persona-info";

    const name = document.createElement("div");
    name.className = "s5-persona-name";
    name.textContent = display.name || "S5·BOT";

    const title = document.createElement("div");
    title.className = "s5-persona-title";
    title.textContent = display.title || "";

    const tagline = document.createElement("p");
    tagline.className = "s5-persona-tagline";
    tagline.textContent = display.tagline || "";

    info.append(name, title, tagline);
    head.append(avatar, info);

    const chips = document.createElement("div");
    chips.className = "s5-persona-chips";
    [...(display.traits || []), ...(display.specialties || [])].forEach((label) => {
      const chip = document.createElement("span");
      chip.className = "s5-chip";
      chip.textContent = label;
      chips.appendChild(chip);
    });

    const meta = document.createElement("div");
    meta.className = "s5-persona-meta";
    const styleLine = document.createElement("p");
    styleLine.textContent = display.styleLine || "";
    const boundaryLine = document.createElement("p");
    boundaryLine.textContent = display.boundaryLine || "";
    meta.append(styleLine, boundaryLine);

    panel.appendChild(head);
    panel.appendChild(chips);
    panel.appendChild(meta);
  }

  function buildPanel(mode) {
    const panel = document.createElement("section");
    panel.className = "s5-chat-panel s5-chat-" + mode;
    panel.setAttribute("aria-label", "S5·BOT AI 对话");

    if (persona) renderCardHead(panel);

    const list = document.createElement("div");
    list.className = "s5-chat-log";
    list.setAttribute("role", "log");
    list.setAttribute("aria-live", "polite");
    list.setAttribute("aria-label", "对话记录");
    panel.appendChild(list);

    if (persona) {
      const initial = persona.greeting || "你好，我是 S5·BOT。";
      appendBubble(list, "assistant", initial);

      const suggests = document.createElement("div");
      suggests.className = "s5-suggests";
      (persona.suggestions || []).forEach((text) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "s5-suggest-btn";
        btn.textContent = text;
        btn.addEventListener("click", () => {
          const input = panel.querySelector(".s5-ask-input");
          if (input) {
            input.value = text;
            submit();
          }
        });
        suggests.appendChild(btn);
      });
      panel.appendChild(suggests);
    } else {
      appendBubble(list, "assistant", "角色卡暂时无法加载，AI 对话不可用。");
      apiAvailable = false;
    }

    const status = document.createElement("div");
    status.className = "s5-chat-status";
    status.setAttribute("role", "status");
    status.hidden = true;
    panel.appendChild(status);

    const form = document.createElement("form");
    form.className = "s5-chat-form";
    const input = document.createElement("textarea");
    input.className = "s5-ask-input";
    input.setAttribute("aria-label", "输入给 S5·BOT 的消息");
    input.setAttribute("placeholder", "问点嵌入式 / 调试的问题…");
    input.rows = 2;
    input.maxLength = 1200;
    const actions = document.createElement("div");
    actions.className = "s5-chat-actions";
    const send = document.createElement("button");
    send.type = "submit";
    send.className = "s5-send-btn";
    send.textContent = "发送";
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "s5-stop-btn";
    stop.textContent = "停止";
    stop.hidden = true;
    actions.append(stop, send);
    form.append(input, actions);
    panel.appendChild(form);

    let controller = null;
    let busy = false;

    function setBusy(state) {
      busy = state;
      send.disabled = state || !apiAvailable;
      stop.hidden = !state;
      input.setAttribute("aria-busy", String(state));
    }

    async function submit() {
      const text = input.value.trim();
      if (!text || busy) return;
      if (!apiAvailable) {
        degrade(panel, list);
        return;
      }
      input.value = "";
      appendBubble(list, "user", text);
      setBusy(true);
      setStatus(panel, "S5·BOT 正在思考…", "info");

      const history = collectHistory(list, 12).slice(0, -1);
      const messages = [...history, { role: "user", content: text }];
      controller = new AbortController();
      let answerBubble = null;
      let answer = "";

      try {
        await streamChat({
          messages,
          signal: controller.signal,
          onDelta(delta) {
            if (!answerBubble) {
              answerBubble = appendBubble(list, "assistant", "");
            }
            answer += delta;
            answerBubble.textContent = answer;
            list.scrollTop = list.scrollHeight;
          },
        });
        if (!answerBubble) answerBubble = appendBubble(list, "assistant", "（无输出）");
        setStatus(panel, "", "");
      } catch (error) {
        if (error && error.name === "AbortError") {
          if (answerBubble && !answer) answerBubble.textContent = "（已停止）";
          setStatus(panel, "", "");
        } else {
          console.warn(TAG, "对话失败", error);
          if (answerBubble) answerBubble.textContent += "\n\n（回复中断，可重试）";
          degrade(panel, list);
        }
      } finally {
        controller = null;
        setBusy(false);
      }
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submit();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });
    stop.addEventListener("click", () => {
      if (controller) controller.abort();
    });

    return { panel, submit, setBusy };
  }

  function probeApi() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    return fetch(apiBase + "/health", { signal: controller.signal, cache: "no-store" })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => clearTimeout(timer));
  }

  function mountPanel(host) {
    const mode = host.getAttribute("data-bot-chat") || "panel";
    const built = buildPanel(mode);
    host.appendChild(built.panel);
    mounted.push({ host, ...built });

    if (mode === "dock") {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "s5-chat-toggle";
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "打开 S5·BOT AI 对话");
      toggle.textContent = "✦ AI 对话";
      host.parentElement?.insertBefore(toggle, host);

      toggle.addEventListener("click", () => {
        const open = host.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", String(open));
        toggle.textContent = open ? "✕ 收起对话" : "✦ AI 对话";
        if (open) {
          built.panel.querySelector(".s5-ask-input")?.focus();
        }
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && host.classList.contains("is-open")) {
          host.classList.remove("is-open");
          toggle.setAttribute("aria-expanded", "false");
          toggle.textContent = "✦ AI 对话";
          toggle.focus();
        }
      });
    }
  }

  loadPersona().then(async () => {
    apiAvailable = personaOk && (await probeApi());
    document.querySelectorAll("[data-bot-chat]").forEach(mountPanel);
    if (!apiAvailable) {
      mounted.forEach(({ panel }) => degrade(panel, panel.querySelector(".s5-chat-log")));
    }
  });
})();
