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

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderInline(raw) {
    const src = String(raw);
    let html = "";
    let i = 0;
    while (i < src.length) {
      if (src[i] === "`") {
        const end = src.indexOf("`", i + 1);
        if (end > i + 1 && !src.slice(i + 1, end).includes("\n")) {
          html += "<code>" + escapeHtml(src.slice(i + 1, end)) + "</code>";
          i = end + 1;
          continue;
        }
      }
      if (src[i] === "!" || src[i] === "[") {
        const mark = src[i] === "!" ? i + 1 : i;
        if (src[mark] === "[") {
          const labelEnd = src.indexOf("]", mark + 1);
          if (labelEnd > mark && src[labelEnd + 1] === "(") {
            const urlEnd = src.indexOf(")", labelEnd + 2);
            if (urlEnd > labelEnd) {
              const label = src.slice(mark + 1, labelEnd);
              const url = src.slice(labelEnd + 2, urlEnd).trim();
              if (/^https?:\/\/[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+$/.test(url)) {
                html += '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + renderInline(label) + "</a>";
                i = urlEnd + 1;
                continue;
              }
            }
          }
        }
      }
      if (src.startsWith("***", i)) {
        const end = src.indexOf("***", i + 3);
        if (end > i + 3) {
          html += "<strong><em>" + renderInline(src.slice(i + 3, end)) + "</em></strong>";
          i = end + 3;
          continue;
        }
      }
      if (src.startsWith("**", i)) {
        const end = src.indexOf("**", i + 2);
        if (end > i + 2) {
          html += "<strong>" + renderInline(src.slice(i + 2, end)) + "</strong>";
          i = end + 2;
          continue;
        }
      }
      if (src[i] === "*" && src[i + 1] !== " " && src[i + 1] !== "*") {
        const end = src.indexOf("*", i + 1);
        if (end > i + 1 && !src.slice(i + 1, end).includes("\n")) {
          html += "<em>" + renderInline(src.slice(i + 1, end)) + "</em>";
          i = end + 1;
          continue;
        }
      }
      if (src.startsWith("~~", i)) {
        const end = src.indexOf("~~", i + 2);
        if (end > i + 2) {
          html += "<s>" + renderInline(src.slice(i + 2, end)) + "</s>";
          i = end + 2;
          continue;
        }
      }
      html += escapeHtml(src[i]);
      i += 1;
    }
    return html;
  }

  function renderMarkdown(source) {
    const lines = String(source == null ? "" : source).replace(/\r\n/g, "\n").split("\n");
    const blocks = [];
    let i = 0;
    const isUnordered = (line) => /^[-*]\s+/.test(line);
    const isOrdered = (line) => /^\d+\.\s+/.test(line);
    const isQuote = (line) => /^>\s?/.test(line);
    const isHeading = (line) => /^#{1,6}\s+\S/.test(line);
    const isRule = (line) => /^(?:---|\*\*\*|___)\s*$/.test(line);
    const isTableRow = (line) => /^\s*\|.+\|\s*$/.test(line);
    const isTableSep = (line) => {
      if (!line.includes("-")) return false;
      const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
      return cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
    };
    const splitCells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    const isTable = (index) => isTableRow(lines[index] || "") && isTableSep(lines[index + 1] || "");

    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") {
        i += 1;
        continue;
      }
      if (line.startsWith("```")) {
        const langMatch = /^```([A-Za-z0-9_+#.-]{0,24})/.exec(line);
        const lang = langMatch ? langMatch[1] : "";
        const buf = [];
        i += 1;
        while (i < lines.length && !lines[i].startsWith("```")) {
          buf.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        const langAttr = lang ? ' data-lang="' + escapeHtml(lang) + '"' : "";
        blocks.push('<pre class="s5-md-pre"><code' + langAttr + ">" + escapeHtml(buf.join("\n")) + "</code></pre>");
        continue;
      }
      if (isRule(line)) {
        blocks.push('<hr class="s5-md-hr">');
        i += 1;
        continue;
      }
      if (isHeading(line)) {
        const level = Math.min(line.match(/^#{1,6}/)[0].length, 4);
        blocks.push("<h" + level + ' class="s5-md-h s5-md-h' + level + '">' + renderInline(line.replace(/^#{1,6}\s+/, "")) + "</h" + level + ">");
        i += 1;
        continue;
      }
      if (isQuote(line)) {
        const buf = [];
        while (i < lines.length && isQuote(lines[i])) {
          buf.push(lines[i].replace(/^>\s?/, ""));
          i += 1;
        }
        blocks.push('<blockquote class="s5-md-quote">' + buf.map((part) => renderInline(part)).join("<br>") + "</blockquote>");
        continue;
      }
      if (isUnordered(line) || isOrdered(line)) {
        const ordered = isOrdered(line);
        const items = [];
        const test = ordered ? isOrdered : isUnordered;
        while (i < lines.length && test(lines[i])) {
          let body = lines[i].replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, "");
          let check = "";
          const task = !ordered && /^\[([ xX])\]\s+([\s\S]*)$/.exec(body);
          if (task) {
            check = task[1].toLowerCase() === "x" ? "☑ " : "☐ ";
            body = task[2];
          }
          items.push("<li>" + check + renderInline(body) + "</li>");
          i += 1;
        }
        const tag = ordered ? "ol" : "ul";
        blocks.push("<" + tag + ' class="s5-md-list">' + items.join("") + "</" + tag + ">");
        continue;
      }
      if (isTable(i)) {
        const header = splitCells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && isTableRow(lines[i])) {
          rows.push(splitCells(lines[i]));
          i += 1;
        }
        const head = "<tr>" + header.map((cell) => "<th>" + renderInline(cell) + "</th>").join("") + "</tr>";
        const body = rows.map((row) => {
          return "<tr>" + header.map((_, idx) => "<td>" + renderInline(row[idx] || "") + "</td>").join("") + "</tr>";
        }).join("");
        blocks.push('<div class="s5-md-table-wrap"><table class="s5-md-table"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>");
        continue;
      }
      const buf = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !lines[i].startsWith("```") &&
        !isRule(lines[i]) &&
        !isHeading(lines[i]) &&
        !isQuote(lines[i]) &&
        !isUnordered(lines[i]) &&
        !isOrdered(lines[i]) &&
        !isTable(i)
      ) {
        buf.push(lines[i]);
        i += 1;
      }
      blocks.push('<p class="s5-md-p">' + buf.map((part) => renderInline(part)).join("<br>") + "</p>");
    }
    return blocks.join("");
  }

  function setBubbleContent(bubble, role, text) {
    const value = String(text == null ? "" : text);
    bubble.dataset.raw = value;
    if (role === "assistant") {
      bubble.classList.add("is-md");
      bubble.innerHTML = renderMarkdown(value);
    } else {
      bubble.classList.remove("is-md");
      bubble.textContent = value;
    }
  }

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

  const THREAD_KEY = "s5-bot-threads";
  const THREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const THREAD_LIMIT = 20;
  const THREAD_MESSAGE_LIMIT = 40;

  function emptyStore() {
    return { version: 1, activeId: "", threads: [] };
  }

  function readStore() {
    try {
      const raw = localStorage.getItem(THREAD_KEY);
      if (!raw) return emptyStore();
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.threads)) return emptyStore();
      const now = Date.now();
      const threads = [];
      for (const thread of data.threads) {
        if (!thread || typeof thread.id !== "string") continue;
        if (now - Number(thread.updatedAt) >= THREAD_TTL_MS) continue;
        if (!Array.isArray(thread.messages)) continue;
        const messages = [];
        for (const item of thread.messages) {
          if (!item || (item.role !== "user" && item.role !== "assistant")) continue;
          if (typeof item.content !== "string" || !item.content) continue;
          messages.push({ role: item.role, content: item.content });
        }
        if (!messages.length) continue;
        threads.push({
          id: thread.id,
          title: String(thread.title || "对话").replace(/\s+/g, " ").slice(0, 24),
          updatedAt: Number(thread.updatedAt) || now,
          messages: messages.slice(-THREAD_MESSAGE_LIMIT),
        });
        if (threads.length >= THREAD_LIMIT) break;
      }
      const activeId = threads.some((thread) => thread.id === data.activeId) ? data.activeId : "";
      return { version: 1, activeId, threads };
    } catch {
      return emptyStore();
    }
  }

  function writeStore(store) {
    try {
      localStorage.setItem(THREAD_KEY, JSON.stringify(store));
    } catch (error) {
      console.warn(TAG, "对话未能写入本地缓存", error);
    }
  }

  function appendBubble(list, role, text, persist) {
    const row = document.createElement("div");
    row.className = "s5-msg-row s5-msg-" + role;

    const avatar = document.createElement("span");
    avatar.className = "s5-msg-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = role === "assistant" ? (persona?.display?.avatarGlyph || "S5") : "我";

    const bubble = document.createElement("div");
    bubble.className = "s5-msg-bubble";
    if (persist) bubble.dataset.persist = "1";
    setBubbleContent(bubble, role, text);

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
      const bubble = row.querySelector(".s5-msg-bubble");
      const text = bubble?.dataset.raw || bubble?.textContent || "";
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
    const emptyPage = panel.classList.contains("s5-chat-page") && list && list.childElementCount === 0;
    if (list && !emptyPage) {
      list.hidden = false;
      const note = document.createElement("div");
      note.className = "s5-offline-note";
      note.textContent = hint;
      list.appendChild(note);
      list.scrollTop = list.scrollHeight;
    }
    setStatus(panel, emptyPage ? hint : "静态模式", "warn");
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
    const page = mode === "page";
    const panel = document.createElement("section");
    panel.className = "s5-chat-panel s5-chat-" + mode;
    panel.setAttribute("aria-label", "S5·BOT AI 对话");

    const list = document.createElement("div");
    list.className = "s5-chat-log";
    list.setAttribute("role", "log");
    list.setAttribute("aria-live", "polite");
    list.setAttribute("aria-label", "对话记录");

    let hero = null;
    let composer = null;
    let historyNav = null;
    const memory = readStore();
    let activeId = memory.activeId;
    const savedMessages = memory.threads.find((thread) => thread.id === activeId)?.messages || [];

    if (page) {
      const side = document.createElement("aside");
      side.className = "s5-page-side";
      const brand = document.createElement("div");
      brand.className = "s5-page-brand";
      const mark = document.createElement("span");
      mark.className = "s5-page-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = persona?.display?.avatarGlyph || "S5";
      const brandText = document.createElement("div");
      const brandName = document.createElement("strong");
      brandName.textContent = persona?.display?.name || "S5·BOT";
      const brandTitle = document.createElement("span");
      brandTitle.textContent = persona?.display?.title || "";
      brandText.append(brandName, brandTitle);
      brand.append(mark, brandText);

      const fresh = document.createElement("button");
      fresh.type = "button";
      fresh.className = "s5-page-new";
      fresh.textContent = "新对话";
      fresh.addEventListener("click", () => resetThread());

      historyNav = document.createElement("div");
      historyNav.className = "s5-page-history";
      historyNav.setAttribute("role", "list");
      historyNav.setAttribute("aria-label", "最近对话");

      const keep = document.createElement("p");
      keep.className = "s5-page-keep";
      keep.textContent = "保存在这台浏览器，7 天内可继续";

      const note = document.createElement("p");
      note.className = "s5-page-side-note";
      note.textContent = persona?.display?.tagline || "";

      const back = document.createElement("a");
      back.className = "s5-page-back";
      back.href = "/";
      back.textContent = "返回首页";
      side.append(brand, fresh, historyNav, keep, note, back);

      const main = document.createElement("div");
      main.className = "s5-page-main";
      const stage = document.createElement("div");
      stage.className = "s5-page-stage";
      composer = document.createElement("div");
      composer.className = "s5-page-composer";
      hero = document.createElement("div");
      hero.className = "s5-page-hero";
      const hello = document.createElement("p");
      hello.className = "s5-page-hello";
      hello.textContent = persona?.display?.name || "S5·BOT";
      const lead = document.createElement("p");
      lead.className = "s5-page-lead";
      lead.textContent = persona?.greeting || "你好，我是 S5·BOT。";
      hero.append(hello, lead);
      stage.append(hero, list);
      main.append(stage, composer);
      panel.append(side, main);
      list.hidden = true;
    } else if (persona) {
      renderCardHead(panel);
      panel.appendChild(list);
    } else {
      panel.appendChild(list);
    }

    if (persona) {
      if (!page && !savedMessages.length) appendBubble(list, "assistant", persona.greeting || "你好，我是 S5·BOT。");

      const suggests = document.createElement("div");
      suggests.className = page ? "s5-page-suggestions" : "s5-suggests";
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
      if (page && hero) hero.appendChild(suggests);
      else panel.appendChild(suggests);
    } else {
      if (hero) hero.hidden = true;
      list.hidden = false;
      appendBubble(list, "assistant", "角色卡暂时无法加载，AI 对话不可用。");
      apiAvailable = false;
    }

    const status = document.createElement("div");
    status.className = "s5-chat-status";
    status.setAttribute("role", "status");
    status.hidden = true;
    (composer || panel).appendChild(status);

    const form = document.createElement("form");
    form.className = "s5-chat-form";
    const input = document.createElement("textarea");
    input.className = "s5-ask-input";
    input.setAttribute("aria-label", "输入给 S5·BOT 的消息");
    input.setAttribute("placeholder", page ? "给 S5·BOT 发消息" : "问点嵌入式 / 调试的问题…");
    input.rows = page ? 1 : 2;
    input.maxLength = 1200;
    const actions = document.createElement("div");
    actions.className = "s5-chat-actions";
    const send = document.createElement("button");
    send.type = "submit";
    send.className = "s5-send-btn";
    send.textContent = page ? "↑" : "发送";
    if (page) send.setAttribute("aria-label", "发送");
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "s5-stop-btn";
    stop.textContent = page ? "停" : "停止";
    if (page) stop.setAttribute("aria-label", "停止生成");
    stop.hidden = true;
    actions.append(stop, send);
    if (!page) {
      const openPage = document.createElement("a");
      openPage.className = "s5-open-page";
      openPage.href = "/chat/index.html";
      openPage.textContent = "完整对话";
      actions.insertBefore(openPage, actions.firstChild);
    }
    form.append(input, actions);
    (composer || panel).appendChild(form);

    function fitInput() {
      if (!page) return;
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 168) + "px";
    }

    let controller = null;
    let busy = false;
    let generation = 0;

    function persistedMessages() {
      const messages = [];
      for (const row of list.querySelectorAll(".s5-msg-row")) {
        const bubble = row.querySelector(".s5-msg-bubble");
        if (!bubble || bubble.dataset.persist !== "1") continue;
        const content = bubble.dataset.raw || "";
        if (!content) continue;
        messages.push({
          role: row.classList.contains("s5-msg-user") ? "user" : "assistant",
          content,
        });
      }
      return messages.slice(-THREAD_MESSAGE_LIMIT);
    }

    function paintHistory() {
      if (!historyNav) return;
      historyNav.replaceChildren();
      for (const thread of memory.threads) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "s5-thread" + (thread.id === activeId ? " is-active" : "");
        btn.title = thread.title;
        btn.textContent = thread.title;
        if (thread.id === activeId) btn.setAttribute("aria-current", "true");
        btn.addEventListener("click", () => openThread(thread.id));
        historyNav.appendChild(btn);
      }
    }

    function showMessages(messages) {
      list.replaceChildren();
      messages.forEach((item) => appendBubble(list, item.role, item.content, true));
      if (!messages.length) return;
      if (hero) {
        hero.hidden = true;
        list.hidden = false;
      }
      list.scrollTop = list.scrollHeight;
    }

    function commitThread() {
      const messages = persistedMessages();
      if (!messages.length) return;
      if (!activeId || !memory.threads.some((thread) => thread.id === activeId)) {
        const firstUser = messages.find((item) => item.role === "user");
        activeId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        memory.threads.unshift({
          id: activeId,
          title: (firstUser?.content || "新对话").replace(/\s+/g, " ").slice(0, 24),
          updatedAt: Date.now(),
          messages: [],
        });
      }
      const thread = memory.threads.find((item) => item.id === activeId);
      thread.messages = messages;
      thread.updatedAt = Date.now();
      memory.threads = memory.threads.filter((item) => item.id !== activeId);
      memory.threads.unshift(thread);
      memory.threads = memory.threads.slice(0, THREAD_LIMIT);
      memory.activeId = activeId;
      writeStore(memory);
      paintHistory();
    }

    function openThread(id) {
      if (busy || id === activeId) return;
      const thread = memory.threads.find((item) => item.id === id);
      if (!thread) return;
      activeId = id;
      memory.activeId = id;
      writeStore(memory);
      showMessages(thread.messages);
      paintHistory();
      input.focus();
    }

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
      fitInput();
      if (hero) {
        hero.hidden = true;
        list.hidden = false;
      }
      appendBubble(list, "user", text, true);
      commitThread();
      setBusy(true);
      setStatus(panel, "S5·BOT 正在思考…", "info");

      const history = collectHistory(list, 12).slice(0, -1);
      const messages = [...history, { role: "user", content: text }];
      const turn = generation;
      controller = new AbortController();
      let answerBubble = null;
      let answer = "";

      try {
        await streamChat({
          messages,
          signal: controller.signal,
          onDelta(delta) {
            if (turn !== generation) return;
            if (!answerBubble) {
              answerBubble = appendBubble(list, "assistant", "", true);
            }
            answer += delta;
            setBubbleContent(answerBubble, "assistant", answer);
            list.scrollTop = list.scrollHeight;
          },
        });
        if (turn === generation && !answerBubble) answerBubble = appendBubble(list, "assistant", "（无输出）", true);
        if (turn === generation) setStatus(panel, "", "");
      } catch (error) {
        if (turn !== generation) return;
        if (error && error.name === "AbortError") {
          if (answerBubble && !answer) setBubbleContent(answerBubble, "assistant", "（已停止）");
          setStatus(panel, "", "");
        } else {
          console.warn(TAG, "对话失败", error);
          if (answerBubble) setBubbleContent(answerBubble, "assistant", answer + "\n\n（回复中断，可重试）");
          degrade(panel, list);
        }
      } finally {
        if (turn !== generation) return;
        controller = null;
        setBusy(false);
        commitThread();
      }
    }

    function resetThread() {
      generation += 1;
      if (controller) controller.abort();
      controller = null;
      commitThread();
      activeId = "";
      memory.activeId = "";
      writeStore(memory);
      setBusy(false);
      list.replaceChildren();
      input.value = "";
      fitInput();
      setStatus(panel, "", "");
      if (hero) {
        hero.hidden = false;
        list.hidden = true;
      } else if (persona) {
        appendBubble(list, "assistant", persona.greeting || "你好，我是 S5·BOT。");
      }
      paintHistory();
      input.focus();
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submit();
    });
    input.addEventListener("input", fitInput);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });
    stop.addEventListener("click", () => {
      if (controller) controller.abort();
    });

    if (savedMessages.length) showMessages(savedMessages);
    paintHistory();

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

  const HOME_SLOT_ID = "homeBotChat";

  function homeSlot() {
    return document.getElementById(HOME_SLOT_ID);
  }

  function setHomeChatOpen(open, toggle) {
    const slot = homeSlot();
    if (!slot) return;
    slot.hidden = !open;
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "收起 S5·BOT AI 对话" : "打开 S5·BOT AI 对话");
      toggle.textContent = open ? "✕ 收起对话" : "✦ AI 对话";
    }
    if (open) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      slot.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
      slot.querySelector(".s5-ask-input")?.focus();
    }
  }

  function mountLauncher(host) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "s5-chat-toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", HOME_SLOT_ID);
    toggle.setAttribute("aria-label", "打开 S5·BOT AI 对话");
    toggle.textContent = "✦ AI 对话";
    host.parentElement?.insertBefore(toggle, host);

    toggle.addEventListener("click", () => {
      const slot = homeSlot();
      setHomeChatOpen(!slot || slot.hidden, toggle);
    });
    document.addEventListener("keydown", (e) => {
      const slot = homeSlot();
      if (e.key === "Escape" && slot && !slot.hidden) {
        setHomeChatOpen(false, toggle);
        toggle.focus();
      }
    });
  }

  function mountPanel(host) {
    const mode = host.getAttribute("data-bot-chat") || "panel";
    if (mode === "launcher") {
      mountLauncher(host);
      return;
    }

    const built = buildPanel(mode);
    host.appendChild(built.panel);
    mounted.push({ host, ...built });

    if (mode === "home") {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "s5-chat-close";
      close.textContent = "收起";
      close.addEventListener("click", () => {
        const toggle = document.querySelector(".s5-chat-toggle");
        setHomeChatOpen(false, toggle);
        toggle?.focus();
      });
      const head = built.panel.querySelector(".s5-persona-head");
      if (head) head.appendChild(close);
      else built.panel.insertBefore(close, built.panel.firstChild);
    }

    if (mode === "page") {
      built.panel.querySelector(".s5-ask-input")?.focus();
    }

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
