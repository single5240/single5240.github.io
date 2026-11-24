(function (root) {
  const GAP = 6;
  const STORE_LAYOUT = "s5-porthole-layout-v2";
  const STORE_NICK = "s5-porthole-nick";
  const STORE_POSTS = "s5-porthole-posts";
  const PATH = "/porthole";
  const PAGE_SIZE = 12;
  const REQUEST_TIMEOUT_MS = 12_000;
  const HOUR_MS = 60 * 60 * 1000;
  const MINUTE_MS = 60 * 1000;
  const HOUR_LIMIT = 10;
  const COLORS = ["#007aff", "#34c759", "#ff9500", "#ff2d55", "#af52de", "#5ac8fa"];

  function overlap(a, b) {
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox <= 0 || oy <= 0) return null;
    return { ox: ox, oy: oy };
  }

  function outsideRect(plate, bounds) {
    const pad = bounds.pad || 0;
    return plate.x < pad - 1
      || plate.y < pad - 1
      || plate.x + plate.w > bounds.width - pad + 1
      || plate.y + plate.h > bounds.height - pad + 1;
  }

  function clampIntoRect(plate, bounds) {
    const pad = bounds.pad || 0;
    const maxX = Math.max(pad, bounds.width - plate.w - pad);
    const maxY = Math.max(pad, bounds.height - plate.h - pad);
    const x = Math.min(Math.max(plate.x, pad), maxX);
    const y = Math.min(Math.max(plate.y, pad), maxY);
    const changed = Math.abs(x - plate.x) > 0.4 || Math.abs(y - plate.y) > 0.4;
    plate.x = x;
    plate.y = y;
    return changed;
  }

  function pushPair(a, b, pinnedId) {
    const hit = overlap(a, b);
    if (!hit) return false;
    const aPin = a.id === pinnedId;
    const bPin = b.id === pinnedId;
    if (hit.ox < hit.oy) {
      const dir = (a.x + a.w / 2) <= (b.x + b.w / 2) ? -1 : 1;
      const dist = hit.ox + GAP;
      if (aPin && !bPin) b.x -= dir * dist;
      else if (bPin && !aPin) a.x += dir * dist;
      else {
        a.x += dir * dist / 2;
        b.x -= dir * dist / 2;
      }
    } else {
      const dir = (a.y + a.h / 2) <= (b.y + b.h / 2) ? -1 : 1;
      const dist = hit.oy + GAP;
      if (aPin && !bPin) b.y -= dir * dist;
      else if (bPin && !aPin) a.y += dir * dist;
      else {
        a.y += dir * dist / 2;
        b.y -= dir * dist / 2;
      }
    }
    return true;
  }

  function separate(plates, pinnedId, bounds) {
    const contacts = [];
    const seen = new Set();
    for (let n = 0; n < 22; n++) {
      let moved = false;
      for (let i = 0; i < plates.length; i++) {
        for (let j = i + 1; j < plates.length; j++) {
          const hit = overlap(plates[i], plates[j]);
          if (!hit) continue;
          const key = plates[i].id < plates[j].id
            ? plates[i].id + "|" + plates[j].id
            : plates[j].id + "|" + plates[i].id;
          if (!seen.has(key)) {
            seen.add(key);
            contacts.push({
              key: key,
              x: (Math.max(plates[i].x, plates[j].x) + Math.min(plates[i].x + plates[i].w, plates[j].x + plates[j].w)) / 2,
              y: (Math.max(plates[i].y, plates[j].y) + Math.min(plates[i].y + plates[i].h, plates[j].y + plates[j].h)) / 2,
              a: plates[i],
              b: plates[j]
            });
          }
          if (pushPair(plates[i], plates[j], pinnedId)) moved = true;
        }
      }
      for (let i = 0; i < plates.length; i++) {
        if (plates[i].id === pinnedId) continue;
        if (clampIntoRect(plates[i], bounds)) moved = true;
      }
      if (pinnedId) {
        const pin = plates.find((plate) => plate.id === pinnedId);
        if (pin) clampIntoRect(pin, bounds);
      }
      if (!moved) break;
    }
    if (pinnedId) {
      const pin = plates.find((plate) => plate.id === pinnedId);
      if (pin) {
        for (let n = 0; n < 24; n++) {
          let blocked = false;
          for (let i = 0; i < plates.length; i++) {
            if (plates[i] === pin) continue;
            const hit = overlap(pin, plates[i]);
            if (!hit) continue;
            blocked = true;
            if (hit.ox < hit.oy) {
              const dir = (pin.x + pin.w / 2) <= (plates[i].x + plates[i].w / 2) ? 1 : -1;
              plates[i].x += dir * (hit.ox + GAP);
            } else {
              const dir = (pin.y + pin.h / 2) <= (plates[i].y + plates[i].h / 2) ? 1 : -1;
              plates[i].y += dir * (hit.oy + GAP);
            }
            clampIntoRect(plates[i], bounds);
            const still = overlap(pin, plates[i]);
            if (!still) continue;
            if (still.ox < still.oy) {
              const back = (pin.x + pin.w / 2) <= (plates[i].x + plates[i].w / 2) ? -1 : 1;
              pin.x += back * (still.ox + GAP);
            } else {
              const back = (pin.y + pin.h / 2) <= (plates[i].y + plates[i].h / 2) ? -1 : 1;
              pin.y += back * (still.oy + GAP);
            }
            clampIntoRect(pin, bounds);
          }
          if (!blocked) break;
        }
        for (let n = 0; n < 16; n++) {
          let moved = false;
          for (let i = 0; i < plates.length; i++) {
            for (let j = i + 1; j < plates.length; j++) {
              if (pushPair(plates[i], plates[j], pinnedId)) moved = true;
            }
          }
          for (let i = 0; i < plates.length; i++) {
            if (plates[i].id === pinnedId) continue;
            if (clampIntoRect(plates[i], bounds)) moved = true;
          }
          if (!moved) break;
        }
      }
    }
    return contacts;
  }

  function fits(plates, bounds) {
    for (let i = 0; i < plates.length; i++) {
      if (outsideRect(plates[i], bounds)) return false;
      for (let j = i + 1; j < plates.length; j++) {
        if (overlap(plates[i], plates[j])) return false;
      }
    }
    return true;
  }

  root.PortholePhysics = {
    overlap: overlap,
    separate: separate,
    clampIntoRect: clampIntoRect,
    fits: fits,
    outsideRect: outsideRect
  };

  if (typeof document === "undefined") return;

  function noteColor(value) {
    const color = String(value || "").toLowerCase();
    return COLORS.indexOf(color) >= 0 ? color : "";
  }

  function readNote(raw) {
    const cleaned = plain(raw);
    const match = cleaned.match(/ %%#([0-9a-f]{6})$/i);
    if (!match) return { text: cleaned.slice(0, 42), color: "" };
    const color = noteColor("#" + match[1]);
    if (!color) return { text: cleaned.slice(0, 42), color: "" };
    return { text: cleaned.slice(0, match.index).trim().slice(0, 42), color: color };
  }

  function plain(value) {
    return String(value || "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/\s+/g, " ")
      .trim();
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      /* Private mode can reject storage; the plates still work this visit. */
    }
  }

  function boot() {
    const board = document.getElementById("portholeBoard");
    const glass = document.getElementById("portholeGlass");
    const form = document.getElementById("portholeForm");
    const statusEl = document.getElementById("portholeStatus");
    const submitBtn = document.getElementById("portholeSubmit");
    if (!board || !glass || !form || !statusEl || !submitBtn) return;
    if (glass.clientWidth < 40 || glass.clientHeight < 40) {
      window.requestAnimationFrame(boot);
      return;
    }

    const nickInput = document.getElementById("porthole-nick");
    const mailInput = document.getElementById("porthole-mail");
    const textInput = document.getElementById("porthole-text");
    const overflow = document.getElementById("portholeOverflow");
    const readStatus = document.getElementById("portholeReadStatus");
    const previous = document.getElementById("portholePrev");
    const next = document.getElementById("portholeNext");
    const refresh = document.getElementById("portholeRefresh");
    const serverUrl = (board.dataset.serverUrl || "").replace(/\/$/, "");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const plates = [];
    let dragging = null;
    let pointerOffsetX = 0;
    let pointerOffsetY = 0;
    let knownPairs = new Set();
    let layoutReady = false;
    let currentPage = 1;
    let totalPages = 1;
    let loadSequence = 0;
    let loading = false;
    let notes = [];
    let posting = false;

    if (nickInput && !nickInput.value) nickInput.value = readJson(STORE_NICK, "");

    function bounds() {
      return {
        width: glass.clientWidth,
        height: glass.clientHeight,
        pad: 12
      };
    }

    function setStatus(text, kind) {
      statusEl.textContent = text;
      statusEl.className = "porthole-status" + (kind ? " is-" + kind : "");
    }

    function paint(plate) {
      plate.el.style.left = plate.x + "px";
      plate.el.style.top = plate.y + "px";
      const tilt = reduceMotion ? 0 : Math.max(-5.5, Math.min(5.5, plate.vx * 0.007));
      plate.el.style.transform = tilt ? "rotate(" + tilt.toFixed(2) + "deg)" : "";
      const box = bounds();
      if (box.width && box.height) {
        plate.fx = plate.x / box.width;
        plate.fy = plate.y / box.height;
      }
    }

    function flash(plate) {
      plate.el.classList.remove("is-bump");
      void plate.el.offsetWidth;
      plate.el.classList.add("is-bump");
      window.setTimeout(() => plate.el.classList.remove("is-bump"), 280);
    }

    function spark(x, y) {
      if (reduceMotion) return;
      const node = document.createElement("span");
      node.className = "porthole-spark";
      node.style.left = x + "px";
      node.style.top = y + "px";
      glass.appendChild(node);
      window.setTimeout(() => node.remove(), 300);
    }

    function relayout(pinnedId) {
      const contacts = separate(plates, pinnedId || null, bounds());
      plates.forEach(paint);
      if (layoutReady) {
        contacts.forEach((contact) => {
          if (knownPairs.has(contact.key)) return;
          flash(contact.a);
          flash(contact.b);
          spark(contact.x, contact.y);
        });
      }
      knownPairs = new Set(contacts.map((contact) => contact.key));
    }

    function saveLayout() {
      const items = { ...readJson(STORE_LAYOUT, null)?.items };
      plates.forEach((plate) => {
        items[plate.id] = [Number(plate.fx.toFixed(4)), Number(plate.fy.toFixed(4))];
      });
      const displayed = new Set(plates.map((plate) => plate.id));
      const recent = Object.entries(items).filter(([id]) => !displayed.has(id)).slice(-120);
      displayed.forEach((id) => recent.push([id, items[id]]));
      writeJson(STORE_LAYOUT, { v: 1, items: Object.fromEntries(recent) });
    }

    function spotFor(index, width, height) {
      const box = bounds();
      const angle = index * 2.399963;
      const spread = Math.sqrt(index + 1) / 7;
      const plate = {
        id: "spot",
        x: box.width / 2 + Math.cos(angle) * spread * box.width * 0.42 - width / 2,
        y: box.height / 2 + Math.sin(angle) * spread * box.height * 0.42 - height / 2,
        w: width,
        h: height
      };
      clampIntoRect(plate, box);
      return plate;
    }

    function occupy(width, height) {
      for (let i = 0; i < 56; i++) {
        const trial = spotFor(i, width, height);
        const box = bounds();
        if (outsideRect(trial, box)) continue;
        if (!plates.some((plate) => overlap(trial, plate))) return trial;
      }
      return null;
    }

    function track(plate, x, y) {
      const now = performance.now();
      plate.trail.push({ x: x, y: y, t: now });
      const cutoff = now - 90;
      while (plate.trail.length > 1 && plate.trail[0].t < cutoff) plate.trail.shift();
      const first = plate.trail[0];
      const last = plate.trail[plate.trail.length - 1];
      const dt = Math.max(0.016, (last.t - first.t) / 1000);
      plate.vx = (last.x - first.x) / dt;
      plate.vy = (last.y - first.y) / dt;
    }

    function settleVelocity(plate) {
      const last = plate.trail[plate.trail.length - 1];
      if (!last || performance.now() - last.t > 48) {
        plate.vx = 0;
        plate.vy = 0;
        return;
      }
      const speed = Math.hypot(plate.vx, plate.vy);
      const max = 860;
      if (speed > max) {
        plate.vx *= max / speed;
        plate.vy *= max / speed;
      }
    }

    function wire(plate) {
      plate.el.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        const rect = glass.getBoundingClientRect();
        dragging = plate;
        plate.vx = 0;
        plate.vy = 0;
        plate.trail = [{ x: plate.x, y: plate.y, t: performance.now() }];
        plate.el.classList.add("is-held");
        plate.el.classList.remove("is-glide");
        pointerOffsetX = event.clientX - rect.left - plate.x;
        pointerOffsetY = event.clientY - rect.top - plate.y;
        try { plate.el.setPointerCapture(event.pointerId); } catch (error) { /* Synthetic events have no capture. */ }
        event.preventDefault();
      });
      plate.el.addEventListener("keydown", (event) => {
        const step = event.shiftKey ? 16 : 8;
        let dx = 0;
        let dy = 0;
        if (event.key === "ArrowLeft") dx = -step;
        else if (event.key === "ArrowRight") dx = step;
        else if (event.key === "ArrowUp") dy = -step;
        else if (event.key === "ArrowDown") dy = step;
        else return;
        event.preventDefault();
        plate.x += dx;
        plate.y += dy;
        relayout(plate.id);
        saveLayout();
      });
    }

    function createPlate(data, spot) {
      const el = document.createElement("article");
      el.className = "porthole-plate";
      if (data.color) {
        el.dataset.color = data.color;
        el.style.setProperty("--plate", data.color);
      }
      el.tabIndex = 0;
      el.setAttribute("role", "group");
      el.setAttribute("aria-label", data.nick + "：" + data.text + "。方向键可移动");
      const nick = document.createElement("span");
      nick.className = "porthole-plate-nick";
      nick.textContent = data.nick;
      const text = document.createElement("span");
      text.className = "porthole-plate-text";
      text.textContent = data.text;
      el.appendChild(nick);
      el.appendChild(text);
      glass.appendChild(el);
      const plate = {
        id: data.id,
        nick: data.nick,
        text: data.text,
        el: el,
        x: spot.x,
        y: spot.y,
        w: el.offsetWidth,
        h: el.offsetHeight,
        fx: 0,
        fy: 0,
        vx: 0,
        vy: 0,
        trail: []
      };
      plates.push(plate);
      wire(plate);
      paint(plate);
      return plate;
    }

    let coastFrame = 0;
    let coastStamp = 0;

    function armCoast() {
      if (coastFrame || reduceMotion) return;
      coastStamp = performance.now();
      coastFrame = window.requestAnimationFrame(coast);
    }

    function coast(now) {
      coastFrame = 0;
      const dt = Math.min(0.034, Math.max(0.001, (now - coastStamp) / 1000));
      coastStamp = now;
      const box = bounds();
      const pad = box.pad;
      let alive = false;
      plates.forEach((plate) => {
        if (plate === dragging) return;
        if (Math.hypot(plate.vx, plate.vy) < 36) {
          if (plate.vx || plate.vy) {
            plate.vx = 0;
            plate.vy = 0;
            plate.el.classList.remove("is-glide");
          }
          return;
        }
        alive = true;
        plate.el.classList.add("is-glide");
        plate.x += plate.vx * dt;
        plate.y += plate.vy * dt;
        const maxX = Math.max(pad, box.width - plate.w - pad);
        const maxY = Math.max(pad, box.height - plate.h - pad);
        if (plate.x < pad) {
          plate.x = pad;
          plate.vx = Math.abs(plate.vx) * 0.34;
        } else if (plate.x > maxX) {
          plate.x = maxX;
          plate.vx = -Math.abs(plate.vx) * 0.34;
        }
        if (plate.y < pad) {
          plate.y = pad;
          plate.vy = Math.abs(plate.vy) * 0.34;
        } else if (plate.y > maxY) {
          plate.y = maxY;
          plate.vy = -Math.abs(plate.vy) * 0.34;
        }
        const damp = Math.exp(-3.15 * dt);
        plate.vx *= damp;
        plate.vy *= damp;
      });
      const snapshot = plates.map((plate) => ({ x: plate.x, y: plate.y }));
      relayout(dragging ? dragging.id : null);
      plates.forEach((plate, index) => {
        if (plate === dragging) return;
        const dx = plate.x - snapshot[index].x;
        const dy = plate.y - snapshot[index].y;
        const shove = Math.hypot(dx, dy);
        if (shove < 0.4) return;
        const gain = Math.min(680, shove / dt);
        plate.vx = plate.vx * 0.22 + (dx / shove) * gain * 0.58;
        plate.vy = plate.vy * 0.22 + (dy / shove) * gain * 0.58;
        plate.el.classList.add("is-glide");
        alive = true;
      });
      if (alive) {
        coastFrame = window.requestAnimationFrame(coast);
      } else {
        plates.forEach((plate) => plate.el.classList.remove("is-glide"));
        saveLayout();
      }
    }

    function releaseDrag() {
      if (!dragging) return;
      const plate = dragging;
      plate.el.classList.remove("is-held");
      settleVelocity(plate);
      dragging = null;
      if (reduceMotion || Math.hypot(plate.vx, plate.vy) < 140) {
        plate.vx = 0;
        plate.vy = 0;
        plate.el.classList.remove("is-glide");
        paint(plate);
        saveLayout();
        return;
      }
      plate.el.classList.add("is-glide");
      armCoast();
    }

    window.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const rect = glass.getBoundingClientRect();
      dragging.x = event.clientX - rect.left - pointerOffsetX;
      dragging.y = event.clientY - rect.top - pointerOffsetY;
      track(dragging, dragging.x, dragging.y);
      relayout(dragging.id);
    });
    window.addEventListener("pointerup", releaseDrag);
    window.addEventListener("pointercancel", releaseDrag);

    function measureText(nick, text) {
      const probe = document.createElement("article");
      probe.className = "porthole-plate";
      probe.style.visibility = "hidden";
      const nickNode = document.createElement("span");
      nickNode.className = "porthole-plate-nick";
      nickNode.textContent = nick;
      const textNode = document.createElement("span");
      textNode.className = "porthole-plate-text";
      textNode.textContent = text;
      probe.appendChild(nickNode);
      probe.appendChild(textNode);
      glass.appendChild(probe);
      const size = { w: probe.offsetWidth, h: probe.offsetHeight };
      probe.remove();
      return size;
    }

    function renderNotes() {
      if (dragging) releaseDrag();
      window.cancelAnimationFrame(coastFrame);
      coastFrame = 0;
      saveLayout();
      plates.splice(0).forEach((plate) => plate.el.remove());
      overflow.replaceChildren();
      layoutReady = false;
      const saved = readJson(STORE_LAYOUT, null)?.items || {};

      notes.forEach((note) => {
        const size = measureText(note.nick, note.text);
        const position = saved[note.id];
        const box = bounds();
        const preferred = Array.isArray(position) && position.every(Number.isFinite)
          ? { x: position[0] * box.width, y: position[1] * box.height, ...size }
          : null;
        const spot = preferred && !outsideRect(preferred, box) && !plates.some((plate) => overlap(preferred, plate))
          ? preferred
          : occupy(size.w, size.h);
        if (spot) {
          createPlate(note, spot);
          return;
        }
        const item = document.createElement("li");
        if (note.color) {
          item.dataset.color = note.color;
          item.style.setProperty("--plate", note.color);
        }
        item.textContent = note.nick + "：" + note.text;
        overflow.appendChild(item);
      });

      overflow.hidden = !overflow.childElementCount;
      relayout(null);
      layoutReady = true;
      saveLayout();
    }

    async function fetchComments(query, options) {
      if (!serverUrl) throw new Error("missing comments server");
      const response = await fetch(serverUrl + "/api/comment" + query, {
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...options
      });
      const payload = await response.json();
      if (!response.ok || Number(payload?.errno) !== 0) {
        throw new Error(payload?.errmsg || "comment request failed");
      }
      return payload.data;
    }

    function readRow(row) {
      if (!row || row.status !== "approved") return null;
      const id = String(row.objectId ?? row.id ?? "");
      const note = readNote(row.comment);
      if (!id || !note.text) return null;
      return { ...note, id, nick: plain(row.nick).slice(0, 12) || "访客" };
    }

    async function loadRemote(page) {
      const sequence = ++loadSequence;
      loading = true;
      if (!notes.length) readStatus.textContent = "正在读取留言…";
      const query = new URLSearchParams({ path: PATH, page, pageSize: PAGE_SIZE, sortBy: "insertedAt_desc" });
      try {
        const data = await fetchComments("?" + query);
        if (!Array.isArray(data?.data) || !Number.isInteger(data.totalPages) || data.totalPages < 0
          || !Number.isInteger(data.count) || data.count < 0) {
          throw new Error("invalid comments list");
        }
        if (sequence !== loadSequence) return;
        totalPages = Math.max(1, data.totalPages);
        if (page > totalPages) return loadRemote(totalPages);
        const received = new Map();
        data.data.map(readRow).forEach((note) => {
          if (note) received.set(note.id, note);
        });
        const updated = Array.from(received.values());
        if (page !== currentPage || JSON.stringify(updated) !== JSON.stringify(notes)) {
          notes = updated;
          renderNotes();
        }
        currentPage = page;
        previous.hidden = currentPage <= 1;
        next.hidden = currentPage >= totalPages;
        readStatus.textContent = notes.length
          ? "第 " + currentPage + " / " + totalPages + " 页 · 共 " + data.count + " 条留言"
          : "还没有公开留言。";
      } catch {
        if (sequence === loadSequence) readStatus.textContent = "读取留言失败，请刷新留言后重试。";
      } finally {
        if (sequence === loadSequence) loading = false;
      }
    }

    function refreshVisible() {
      if (!document.hidden && !dragging && !posting && !loading && !glass.contains(document.activeElement)) {
        void loadRemote(currentPage);
      }
    }

    previous.addEventListener("click", () => void loadRemote(currentPage - 1));
    next.addEventListener("click", () => void loadRemote(currentPage + 1));
    refresh.addEventListener("click", () => void loadRemote(currentPage));
    document.addEventListener("visibilitychange", refreshVisible);
    window.setInterval(refreshVisible, MINUTE_MS);
    refresh.disabled = false;
    void loadRemote(currentPage);

    function recentPosts() {
      const now = Date.now();
      const list = readJson(STORE_POSTS, []);
      return (Array.isArray(list) ? list : []).filter((stamp) => now - stamp < HOUR_MS);
    }

    function postGate() {
      const stamps = recentPosts();
      const now = Date.now();
      if (stamps.some((stamp) => now - stamp < MINUTE_MS)) return "minute";
      if (stamps.length >= HOUR_LIMIT) return "hour";
      return "";
    }

    function markPost() {
      writeJson(STORE_POSTS, recentPosts().concat(Date.now()).slice(-HOUR_LIMIT));
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (posting) return;
      const nick = nickInput.value.trim().slice(0, 12);
      const mail = mailInput.value.trim();
      const text = textInput.value.trim().slice(0, 42);
      const color = noteColor((form.querySelector('input[name="porthole-color"]:checked') || {}).value);
      if (!text) {
        setStatus("写一句话就可以。", "error");
        return;
      }
      const gate = postGate();
      if (gate === "minute") {
        setStatus("一分钟内只能留一条。", "error");
        return;
      }
      if (gate === "hour") {
        setStatus("一小时内最多留 10 条。", "error");
        return;
      }
      if (nick) writeJson(STORE_NICK, nick);
      posting = true;
      submitBtn.disabled = true;
      setStatus("正在提交…");
      const comment = color ? text + " %%#" + color.slice(1) : text;

      try {
        const record = await fetchComments("", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nick: nick || "访客", mail, comment, url: PATH })
        });
        if (!(record?.objectId ?? record?.id)) throw new Error("missing comment id");

        markPost();
        if (textInput.value.trim() === text) textInput.value = "";
        if (record.status === "approved") {
          setStatus("留言已公开。", "ok");
          void loadRemote(1);
        } else {
          setStatus(record.status === "waiting" ? "留言已提交，审核通过后公开。" : "留言已提交，暂未公开。", "ok");
        }
      } catch (error) {
        if (error.message === "Comment too fast!") {
          setStatus("同一网络提交过快，请稍后再试。", "error");
        } else if (error.message === "Duplicate Content") {
          setStatus("这条留言已提交过。", "error");
          void loadRemote(1);
        } else {
          setStatus("未能确认提交结果。请先刷新留言，再决定是否重试。", "error");
        }
      } finally {
        posting = false;
        submitBtn.disabled = false;
      }
    });
    submitBtn.disabled = false;

    window.addEventListener("resize", () => {
      const box = bounds();
      plates.forEach((plate) => {
        plate.w = plate.el.offsetWidth;
        plate.h = plate.el.offsetHeight;
        plate.x = plate.fx * box.width;
        plate.y = plate.fy * box.height;
      });
      relayout(null);
      if (!fits(plates, box) || overflow.childElementCount) renderNotes();
      else saveLayout();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof globalThis !== "undefined" ? globalThis : this);
