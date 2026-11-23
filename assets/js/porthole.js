(function (root) {
  const GAP = 6;
  const STORE_LAYOUT = "s5-porthole-layout";
  const STORE_LOCAL = "s5-porthole-local";
  const STORE_NICK = "s5-porthole-nick";
  const PATH = "/porthole";

  function overlap(a, b) {
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox <= 0 || oy <= 0) return null;
    return { ox: ox, oy: oy };
  }

  function cornerExcess(plate, cx, cy, r) {
    const points = [
      [plate.x, plate.y],
      [plate.x + plate.w, plate.y],
      [plate.x, plate.y + plate.h],
      [plate.x + plate.w, plate.y + plate.h]
    ];
    let excess = 0;
    for (let i = 0; i < points.length; i++) {
      const over = Math.hypot(points[i][0] - cx, points[i][1] - cy) - r;
      if (over > excess) excess = over;
    }
    return excess;
  }

  function clampIntoCircle(plate, cx, cy, r) {
    let changed = false;
    for (let i = 0; i < 24; i++) {
      const excess = cornerExcess(plate, cx, cy, r);
      if (excess <= 0.4) break;
      changed = true;
      const dx = plate.x + plate.w / 2 - cx;
      const dy = plate.y + plate.h / 2 - cy;
      const len = Math.hypot(dx, dy) || 1;
      const step = Math.max(1, excess * 0.85);
      plate.x -= (dx / len) * step;
      plate.y -= (dy / len) * step;
    }
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
        if (clampIntoCircle(plates[i], bounds.cx, bounds.cy, bounds.r)) moved = true;
      }
      if (pinnedId) {
        const pin = plates.find((plate) => plate.id === pinnedId);
        if (pin) clampIntoCircle(pin, bounds.cx, bounds.cy, bounds.r);
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
              const dir = (pin.x + pin.w / 2) <= (plates[i].x + plates[i].w / 2) ? -1 : 1;
              pin.x += dir * (hit.ox + GAP);
            } else {
              const dir = (pin.y + pin.h / 2) <= (plates[i].y + plates[i].h / 2) ? -1 : 1;
              pin.y += dir * (hit.oy + GAP);
            }
          }
          clampIntoCircle(pin, bounds.cx, bounds.cy, bounds.r);
          if (!blocked) break;
        }
      }
    }
    return contacts;
  }

  function fits(plates, bounds) {
    for (let i = 0; i < plates.length; i++) {
      if (cornerExcess(plates[i], bounds.cx, bounds.cy, bounds.r) > 1) return false;
      for (let j = i + 1; j < plates.length; j++) {
        if (overlap(plates[i], plates[j])) return false;
      }
    }
    return true;
  }

  root.PortholePhysics = {
    overlap: overlap,
    separate: separate,
    clampIntoCircle: clampIntoCircle,
    fits: fits,
    cornerExcess: cornerExcess
  };

  if (typeof document === "undefined") return;

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
    if (glass.clientWidth < 40) {
      window.requestAnimationFrame(boot);
      return;
    }

    const nickInput = document.getElementById("porthole-nick");
    const mailInput = document.getElementById("porthole-mail");
    const textInput = document.getElementById("porthole-text");
    const serverUrl = (board.dataset.serverUrl || "").replace(/\/$/, "");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const plates = [];
    let dragging = null;
    let pointerOffsetX = 0;
    let pointerOffsetY = 0;
    let knownPairs = new Set();
    let layoutReady = false;

    if (nickInput && !nickInput.value) nickInput.value = readJson(STORE_NICK, "");

    function bounds() {
      const size = glass.clientWidth;
      return { cx: size / 2, cy: size / 2, r: size / 2 - 10, size: size };
    }

    function setStatus(text, kind) {
      statusEl.textContent = text;
      statusEl.className = "porthole-status" + (kind ? " is-" + kind : "");
    }

    function paint(plate) {
      plate.el.style.left = plate.x + "px";
      plate.el.style.top = plate.y + "px";
      const box = bounds();
      if (box.size) {
        plate.fx = plate.x / box.size;
        plate.fy = plate.y / box.size;
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
      const items = {};
      plates.forEach((plate) => {
        items[plate.id] = [Number(plate.fx.toFixed(4)), Number(plate.fy.toFixed(4))];
      });
      writeJson(STORE_LAYOUT, { v: 1, items: items });
    }

    function spotFor(index, width, height) {
      const box = bounds();
      const angle = index * 2.399963;
      const radius = 28 + Math.sqrt(index + 1) * 36;
      const plate = {
        id: "spot",
        x: box.cx + Math.cos(angle) * radius - width / 2,
        y: box.cy + Math.sin(angle) * radius - height / 2,
        w: width,
        h: height
      };
      clampIntoCircle(plate, box.cx, box.cy, box.r);
      return plate;
    }

    function occupy(width, height) {
      for (let i = 0; i < 56; i++) {
        const trial = spotFor(i, width, height);
        const box = bounds();
        if (cornerExcess(trial, box.cx, box.cy, box.r) > 1) continue;
        if (!plates.some((plate) => overlap(trial, plate))) return trial;
      }
      return null;
    }

    function wire(plate) {
      plate.el.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        const rect = glass.getBoundingClientRect();
        dragging = plate;
        pointerOffsetX = event.clientX - rect.left - plate.x;
        pointerOffsetY = event.clientY - rect.top - plate.y;
        plate.el.setPointerCapture(event.pointerId);
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
      el.className = "porthole-plate" + (data.fixture ? " is-fixture" : "");
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
        x: spot ? spot.x : 0,
        y: spot ? spot.y : 0,
        w: el.offsetWidth,
        h: el.offsetHeight,
        fx: 0,
        fy: 0
      };
      if (!spot) {
        const saved = readJson(STORE_LAYOUT, { items: {} }).items || {};
        const at = saved[plate.id];
        if (at && Number.isFinite(at[0]) && Number.isFinite(at[1])) {
          const box = bounds();
          plate.x = at[0] * box.size;
          plate.y = at[1] * box.size;
        } else {
          const fresh = spotFor(plates.length, plate.w, plate.h);
          plate.x = fresh.x;
          plate.y = fresh.y;
        }
      }
      plates.push(plate);
      wire(plate);
      paint(plate);
      return plate;
    }

    function rememberLocal(item) {
      const list = readJson(STORE_LOCAL, []);
      const next = (Array.isArray(list) ? list : []).filter((entry) => entry && entry.id !== item.id);
      next.push({ id: item.id, nick: item.nick, text: item.text });
      writeJson(STORE_LOCAL, next.slice(-24));
    }

    window.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const rect = glass.getBoundingClientRect();
      dragging.x = event.clientX - rect.left - pointerOffsetX;
      dragging.y = event.clientY - rect.top - pointerOffsetY;
      relayout(dragging.id);
    });
    window.addEventListener("pointerup", () => {
      if (!dragging) return;
      dragging = null;
      saveLayout();
    });
    window.addEventListener("pointercancel", () => {
      if (!dragging) return;
      dragging = null;
      saveLayout();
    });

    createPlate({ id: "fixture-port", nick: "PORT", text: "拖一拖这些铁片", fixture: true }, null);
    const locals = readJson(STORE_LOCAL, []);
    (Array.isArray(locals) ? locals : []).forEach((item) => {
      if (!item || !item.id || !item.text) return;
      createPlate({
        id: String(item.id),
        nick: plain(item.nick).slice(0, 12) || "访客",
        text: plain(item.text).slice(0, 42)
      }, null);
    });
    relayout(null);
    layoutReady = true;
    saveLayout();

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

    async function loadRemote() {
      if (!serverUrl) return;
      const response = await fetch(serverUrl + "/api/comment?path=" + encodeURIComponent(PATH) + "&page=1&pageSize=24&sortBy=insertedAt_asc", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      const rows = payload && payload.data && Array.isArray(payload.data.data) ? payload.data.data : [];
      const known = new Set(plates.map((plate) => plate.id));
      rows.forEach((row) => {
        const id = String(row.objectId || row.id || "");
        const text = plain(row.comment).slice(0, 42);
        const nick = plain(row.nick).slice(0, 12) || "访客";
        if (!id || !text || known.has(id) || plates.some((plate) => plate.nick === nick && plate.text === text)) return;
        const size = measureText(nick, text);
        const spot = occupy(size.w, size.h);
        if (!spot) return;
        createPlate({ id: id, nick: nick, text: text }, spot);
        known.add(id);
      });
      relayout(null);
      saveLayout();
    }

    loadRemote().catch(() => {});

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const nick = plain(nickInput.value).slice(0, 12);
      const mail = mailInput.value.trim();
      const text = plain(textInput.value).slice(0, 42);
      if (!nick || !mail || !text) {
        setStatus("请填写称呼、邮箱和一句话。", "error");
        return;
      }
      const size = measureText(nick, text);
      const spot = occupy(size.w, size.h);
      if (!spot) {
        setStatus("舷窗已经排满，拖开一些铁片再试。", "error");
        return;
      }

      writeJson(STORE_NICK, nick);
      submitBtn.disabled = true;
      setStatus("正在把铁片铆上去…");
      let remoteId = "";
      try {
        if (!serverUrl) throw new Error("offline");
        const response = await fetch(serverUrl + "/api/comment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nick: nick, mail: mail, comment: text, url: PATH })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (payload && payload.errmsg === "Comment too fast!") {
            setStatus("铆得太快了，稍等一下再试。", "error");
            submitBtn.disabled = false;
            return;
          }
          throw new Error("failed");
        }
        remoteId = String((payload.data && (payload.data.objectId || payload.data.id)) || payload.objectId || payload.id || "");
      } catch (error) {
        remoteId = "";
      }

      const id = remoteId || ("local-" + Date.now());
      createPlate({ id: id, nick: nick, text: text }, spot);
      rememberLocal({ id: id, nick: nick, text: text });
      relayout(null);
      saveLayout();
      textInput.value = "";
      submitBtn.disabled = false;
      setStatus(remoteId ? "已经铆在舷窗上。" : "已留在这扇舷窗上，别人暂时还看不到。", remoteId ? "ok" : "error");
    });

    window.addEventListener("resize", () => {
      const box = bounds();
      plates.forEach((plate) => {
        plate.w = plate.el.offsetWidth;
        plate.h = plate.el.offsetHeight;
        plate.x = plate.fx * box.size;
        plate.y = plate.fy * box.size;
      });
      relayout(null);
      saveLayout();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof globalThis !== "undefined" ? globalThis : this);
