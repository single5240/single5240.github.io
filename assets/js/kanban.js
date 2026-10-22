(function () {
  "use strict";
  const S = window.KanbanStore;
  const $ = (id) => document.getElementById(`kb-${id}`);
  const app = document.getElementById("kanban-app");
  if (!app) return;
  const priorities = { high: "高优先级", normal: "普通", low: "低优先级" };
  const history = [];
  let state, editTask = null, editColumn = null, boardMode = "new", dragId = null;
  let storageWritable = true;
  let storageConflict = false;
  let lastRaw = null;
  let notice = "";
  const current = () => state.boards.find((board) => board.id === state.active);
  function announce(message) { $("status").textContent = message; }
  function warning(message) { $("warning").hidden = !message; $("warning").textContent = message; }
  function persist() {
    if (!storageWritable || storageConflict) return;
    try {
      const raw = localStorage.getItem(S.KEY);
      if (raw !== lastRaw) {
        storageConflict = true;
        warning("另一标签页已更新看板。本页后续编辑仅临时保留在页面内，请先导出需要保留的内容，再刷新读取最新数据。");
        return;
      }
      lastRaw = JSON.stringify(state);
      localStorage.setItem(S.KEY, lastRaw);
    } catch {
      storageWritable = false;
      warning("浏览器无法保存数据，当前仅在此页面临时使用。关闭或刷新会丢失，请及时导出。");
    }
  }
  function ensureBoards() {
    if (!state.boards.length) state.boards.push(S.createBoard());
    if (!current()) state.active = state.boards[0].id;
  }
  function expire() {
    const remaining = state.boards.filter((board) => board.expiresAt > Date.now());
    if (remaining.length === state.boards.length) return false;
    state.boards = remaining;
    ensureBoards();
    history.length = 0;
    document.querySelectorAll(".kb-dialog[open]").forEach((dialog) => dialog.close());
    persist(); render(); announce("到期看板已清理，已为你准备可用看板。");
    return true;
  }
  function change(action, message, focusId) {
    if (expire()) return;
    const before = S.clone(state);
    try {
      action();
      state.boards.forEach(S.validateBoard);
      if (state.boards.length > 10) throw new Error("最多同时使用 10 个临时看板");
    } catch (error) {
      state = before; announce(error.message);
      const dialog = document.querySelector(".kb-dialog[open]");
      if (dialog) {
        let feedback = dialog.querySelector(".kb-form-error");
        if (!feedback) { feedback = element("p", "kb-form-error kb-danger"); feedback.setAttribute("role", "alert"); dialog.querySelector("form").append(feedback); }
        feedback.textContent = error.message;
      }
      return false;
    }
    history.push(before);
    if (history.length > 20) history.shift();
    persist(); render(); announce(storageConflict ? `${message}（仅本页暂存，请导出）` : message);
    if (focusId) document.querySelector(`[data-task-id="${focusId}"] [data-action="edit-task"]`)?.focus();
    return true;
  }
  function element(tag, className, content) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (content !== undefined) el.textContent = content;
    return el;
  }
  function button(label, action, id, title = label) {
    const el = element("button", "kb-btn kb-icon-btn", label);
    el.type = "button"; el.dataset.action = action; el.dataset.id = id; el.title = title; el.setAttribute("aria-label", title);
    return el;
  }
  function options(select, values, selected) {
    select.replaceChildren(...values.map((value) => new Option(value.name, value.id)));
    if (selected) select.value = selected;
  }
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function renderCard(task, list, index) {
    const card = element("article", "kb-card"); card.dataset.taskId = task.id; card.dataset.dragId = task.id; card.draggable = true;
    const top = element("div", "kb-card-top");
    top.append(element("span", `kb-priority-label kb-priority-${task.priority}`, priorities[task.priority]));
    const handle = element("span", "kb-drag-handle", "⠿"); handle.title = "拖拽移动任务"; handle.setAttribute("aria-hidden", "true"); top.append(handle);
    card.append(top, element("h3", "", task.title));
    if (task.notes) card.append(element("p", "kb-card-notes", task.notes));
    const tags = element("div", "kb-tags"); task.tags.forEach((tag) => tags.append(element("span", "kb-tag", tag))); if (task.tags.length) card.append(tags);
    const meta = element("div", "kb-card-meta");
    if (task.owner) meta.append(element("span", "", `负责人：${task.owner}`));
    if (task.due) { const date = element("span", task.due < today() ? "kb-overdue" : "", `截止 ${task.due}`); meta.append(date); }
    if (meta.childNodes.length) card.append(meta);
    const footer = element("div", "kb-card-footer");
    const up = button("↑", "up-task", task.id, `上移任务：${task.title}`); up.disabled = index === 0;
    const down = button("↓", "down-task", task.id, `下移任务：${task.title}`); down.disabled = index === list.length - 1;
    footer.append(up, down, button("编辑", "edit-task", task.id, `编辑任务：${task.title}`)); card.append(footer);
    return card;
  }
  function render() {
    const board = current();
    options($("board"), state.boards, board.id);
    $("expiry").textContent = `到期 ${new Date(board.expiresAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${board.days} 天有效`;
    $("undo").disabled = !history.length;
    const query = $("search").value.trim().toLocaleLowerCase();
    const priority = $("priority").value;
    const visible = board.tasks.filter((task) => (!priority || task.priority === priority) && [task.title, task.notes, task.owner, ...task.tags].join(" ").toLocaleLowerCase().includes(query));
    $("summary").textContent = query || priority ? `显示 ${visible.length} / ${board.tasks.length} 项` : `${board.columns.length} 个分组 · ${board.tasks.length} 项任务`;
    $("columns").replaceChildren(...board.columns.map((column, index) => {
      const section = element("section", "kb-column"); section.dataset.columnId = column.id;
      const header = element("div", "kb-column-header");
      const heading = element("h2", "", column.name); heading.id = `kb-col-${column.id}`; section.setAttribute("aria-labelledby", heading.id);
      const tasks = visible.filter((task) => task.column === column.id);
      const left = button("←", "left-column", column.id, `左移分组：${column.name}`); left.disabled = index === 0;
      const right = button("→", "right-column", column.id, `右移分组：${column.name}`); right.disabled = index === board.columns.length - 1;
      header.append(heading, element("span", "kb-count", String(tasks.length)), left, right, button("···", "edit-column", column.id, `设置分组：${column.name}`));
      const list = element("div", "kb-task-list");
      tasks.forEach((task, index) => list.append(renderCard(task, tasks, index)));
      if (!tasks.length) list.append(element("p", "kb-empty", query || priority ? "没有匹配的任务" : "还没有任务，记下第一件事"));
      const form = element("form", "kb-quick-form"); form.dataset.columnId = column.id;
      const input = element("input"); input.name = "title"; input.required = true; input.maxLength = 160; input.placeholder = "＋ 添加任务，回车保存"; input.setAttribute("aria-label", `在${column.name}快速添加任务`);
      const add = element("button", "kb-btn", "＋"); add.type = "submit"; add.setAttribute("aria-label", `添加到${column.name}`);
      form.append(input, add); section.append(header, list, form); return section;
    }));
  }
  function clearFilters() { $("search").value = ""; $("priority").value = ""; }
  function clearFormError(dialog) { dialog.querySelector(".kb-form-error")?.remove(); }
  function openTask(id = null, column = current().columns[0].id) {
    if (expire()) return;
    editTask = id;
    const form = $("task-form"); form.reset();
    clearFormError($("task-dialog"));
    const task = id ? current().tasks.find((task) => task.id === id) : null;
    options(form.elements.column, current().columns, task?.column || column);
    if (task) for (const key of ["title", "notes", "owner", "due", "priority"]) form.elements[key].value = task[key];
    form.elements.tags.value = task ? task.tags.join("，") : "";
    $("task-heading").textContent = task ? "编辑任务" : "新建任务"; $("delete-task").hidden = !task;
    $("task-dialog").showModal(); form.elements.title.focus();
  }
  function openBoard(mode) {
    if (expire()) return;
    boardMode = mode;
    const form = $("board-form"); form.reset();
    clearFormError($("board-dialog"));
    if (mode === "edit") { form.elements.name.value = current().name; form.elements.days.value = current().days; }
    $("board-heading").textContent = mode === "edit" ? "看板设置" : "新看板";
    $("delete-board").hidden = mode !== "edit";
    $("board-dialog").showModal(); form.elements.name.focus();
  }
  function openColumn(id = null) {
    if (expire()) return;
    editColumn = id; const form = $("column-form"); form.reset();
    clearFormError($("column-dialog"));
    if (id) form.elements.name.value = current().columns.find((column) => column.id === id).name;
    const canDelete = Boolean(id && current().columns.length > 1);
    options(form.elements.target, current().columns.filter((column) => column.id !== id));
    $("column-heading").textContent = id ? "分组设置" : "新建分组";
    $("delete-column").hidden = !canDelete; $("column-target-wrap").hidden = !canDelete;
    $("column-dialog").showModal(); form.elements.name.focus();
  }
  async function confirmDelete(message) {
    $("confirm-text").textContent = message; const dialog = $("confirm-dialog"); dialog.returnValue = "cancel";
    const answer = new Promise((resolve) => dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true }));
    dialog.showModal(); return answer;
  }
  $("task-form").addEventListener("submit", (event) => {
    event.preventDefault(); const form = event.currentTarget;
    const title = form.elements.title.value.trim();
    if (!title) { form.elements.title.setCustomValidity("请填写任务标题"); form.elements.title.reportValidity(); return; }
    const task = { id: editTask || S.uid(), title, notes: form.elements.notes.value.trim(), owner: form.elements.owner.value.trim(), due: form.elements.due.value, priority: form.elements.priority.value, column: form.elements.column.value, tags: [...new Set(form.elements.tags.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))] };
    if (change(() => {
      const board = current(); const old = board.tasks.find((item) => item.id === editTask);
      if (old) {
        if (old.column !== task.column) S.moveTask(board, old.id, task.column);
        Object.assign(old, task);
      } else board.tasks.push(task);
    }, "任务已保存")) { $("task-dialog").close(); document.querySelector(`[data-task-id="${task.id}"] [data-action="edit-task"]`)?.focus(); }
  });
  $("task-form").elements.title.addEventListener("input", (event) => event.target.setCustomValidity(""));
  $("board-form").addEventListener("submit", (event) => {
    event.preventDefault(); const form = event.currentTarget; const name = form.elements.name.value.trim(); const days = Number(form.elements.days.value);
    if (change(() => {
      if (boardMode === "new") { const board = S.createBoard(name, days); state.boards.push(board); state.active = board.id; clearFilters(); }
      else { const board = current(); board.name = name; if (board.days !== days) { board.days = days; board.expiresAt = Date.now() + days * S.DAY; } }
    }, "看板已保存")) $("board-dialog").close();
  });
  $("column-form").addEventListener("submit", (event) => {
    event.preventDefault(); const name = event.currentTarget.elements.name.value.trim();
    if (change(() => { if (editColumn) current().columns.find((column) => column.id === editColumn).name = name; else current().columns.push({ id: S.uid(), name }); }, "分组已保存")) $("column-dialog").close();
  });
  $("delete-task").addEventListener("click", async () => {
    const id = editTask;
    if (await confirmDelete("删除这项任务？可以使用撤销恢复。")) if (change(() => { current().tasks = current().tasks.filter((task) => task.id !== id); }, "任务已删除，可撤销")) $("task-dialog").close();
  });
  $("delete-board").addEventListener("click", async () => {
    const id = state.active;
    if (await confirmDelete("删除当前看板及其中所有任务？可以使用撤销恢复。")) if (change(() => { state.boards = state.boards.filter((board) => board.id !== id); ensureBoards(); clearFilters(); }, "看板已删除，可撤销")) $("board-dialog").close();
  });
  $("delete-column").addEventListener("click", async () => {
    const id = editColumn; const target = $("column-form").elements.target.value;
    if (await confirmDelete("删除此分组？其中任务会移到选中的分组。")) if (change(() => { const board = current(); board.tasks.filter((task) => task.column === id).forEach((task) => { task.column = target; }); board.columns = board.columns.filter((column) => column.id !== id); }, "分组已删除，任务已移动")) $("column-dialog").close();
  });
  app.addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) { event.target.closest("dialog").close(); return; }
    const control = event.target.closest("[data-action]"); if (!control) return;
    const { action, id } = control.dataset;
    if (action === "edit-task") openTask(id);
    else if (action === "edit-column") openColumn(id);
    else if (action.endsWith("-column")) change(() => {
      const columns = current().columns; const index = columns.findIndex((column) => column.id === id); const target = index + (action === "left-column" ? -1 : 1);
      if (target >= 0 && target < columns.length) [columns[index], columns[target]] = [columns[target], columns[index]];
    }, "分组顺序已更新");
    else if (action.endsWith("-task")) change(() => {
      const board = current(); const task = board.tasks.find((task) => task.id === id);
      const siblings = board.tasks.filter((item) => item.column === task.column); const index = siblings.findIndex((item) => item.id === id);
      const next = action === "up-task" ? siblings[index - 1]?.id : siblings[index + 2]?.id;
      S.moveTask(board, id, task.column, next);
    }, "任务顺序已更新", id);
  });
  $("columns").addEventListener("submit", (event) => {
    const form = event.target.closest(".kb-quick-form"); if (!form) return; event.preventDefault();
    const title = form.elements.title.value.trim(); if (!title) return;
    const column = form.dataset.columnId;
    if (change(() => { current().tasks.push({ id: S.uid(), column, title, notes: "", owner: "", due: "", priority: "normal", tags: [] }); clearFilters(); }, "任务已添加")) document.querySelector(`.kb-quick-form[data-column-id="${column}"] input`)?.focus();
  });
  $("new-board").onclick = () => openBoard("new"); $("settings").onclick = () => openBoard("edit");
  $("add-column").onclick = () => openColumn(); $("add-task").onclick = () => openTask();
  $("search").oninput = render; $("priority").onchange = render;
  $("board").onchange = (event) => { if (expire()) return; state.active = event.target.value; clearFilters(); persist(); render(); };
  $("undo").onclick = () => {
    if (expire() || !history.length) return;
    state = history.pop(); state.boards = state.boards.filter((board) => board.expiresAt > Date.now()); ensureBoards(); persist(); render(); announce("已撤销上一步操作");
  };
  $("export").onclick = () => {
    if (expire()) return;
    const blob = new Blob([JSON.stringify({ version: 1, kind: "s5-kanban-board", board: current() }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = element("a"); link.href = url; link.download = `临时看板-${today()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); announce("已导出当前看板；导出的文件由你自行保管，不会自动到期。");
  };
  $("import").onclick = () => $("file").click();
  $("file").onchange = async (event) => {
    const file = event.target.files[0]; event.target.value = ""; if (!file) return;
    try {
      if (file.size > 3 * 1024 * 1024) throw new Error("文件过大，请使用 3 MiB 以内的看板 JSON");
      const board = S.importBoard(await file.text());
      change(() => { state.boards.push(board); state.active = board.id; clearFilters(); }, "已导入为独立新看板，保存期限从现在起计算");
    } catch (error) { announce(`导入失败：${error.message}`); }
  };
  $("columns").addEventListener("dragstart", (event) => {
    const handle = event.target.closest("[data-drag-id]"); if (!handle || expire()) { event.preventDefault(); return; }
    dragId = handle.dataset.dragId; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", dragId);
    handle.closest(".kb-card").classList.add("kb-dragging");
  });
  function clearDrop() { document.querySelectorAll(".kb-drop-target, .kb-dragging").forEach((el) => el.classList.remove("kb-drop-target", "kb-dragging")); }
  $("columns").addEventListener("dragover", (event) => {
    const column = event.target.closest(".kb-column"); if (!dragId || !column) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "move";
    document.querySelectorAll(".kb-drop-target").forEach((el) => el.classList.remove("kb-drop-target"));
    (event.target.closest(".kb-card") || column).classList.add("kb-drop-target");
    const bounds = $("columns").getBoundingClientRect();
    if (event.clientX > bounds.right - 50) $("columns").scrollLeft += 16;
    if (event.clientX < bounds.left + 50) $("columns").scrollLeft -= 16;
  });
  $("columns").addEventListener("drop", (event) => {
    const column = event.target.closest(".kb-column"); if (!dragId || !column) return;
    event.preventDefault(); const id = dragId; const card = event.target.closest(".kb-card"); let before = card?.dataset.taskId || null;
    if (card && before !== id && event.clientY > card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2) {
      const siblings = current().tasks.filter((task) => task.column === column.dataset.columnId); before = siblings[siblings.findIndex((task) => task.id === before) + 1]?.id || null;
    }
    change(() => S.moveTask(current(), id, column.dataset.columnId, before), "任务已移动", id); dragId = null; clearDrop();
  });
  $("columns").addEventListener("dragend", () => { dragId = null; clearDrop(); });
  window.addEventListener("storage", (event) => {
    if (event.key !== S.KEY && event.key !== null) return;
    const editing = document.querySelector(".kb-dialog[open]");
    if (editing || storageConflict) { storageConflict = true; warning("另一标签页已修改看板。本页编辑仅临时保留在页面内；可保存任务并导出，再刷新获取最新数据。"); return; }
    try {
      lastRaw = localStorage.getItem(S.KEY);
      state = lastRaw ? S.decode(lastRaw) : { version: 1, boards: [] };
      ensureBoards(); history.length = 0; render(); announce("已同步此浏览器另一标签页的修改");
    } catch { storageConflict = true; warning("另一标签页的数据无法读取，请导出本页后刷新。"); }
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) expire(); });
  setInterval(expire, 30000);
  try {
    lastRaw = localStorage.getItem(S.KEY);
    state = lastRaw ? S.decode(lastRaw) : { version: 1, boards: [] };
    if (lastRaw && JSON.parse(lastRaw).boards.length > state.boards.length) notice = "到期看板已清理。";
  } catch {
    storageWritable = false;
    state = { version: 1, boards: [] };
    warning("本地数据不可读取或存储不可用。本页暂用临时模式，不会覆盖原数据；请导出新内容后再关闭。");
  }
  ensureBoards(); persist(); render(); announce(notice || (current().tasks.length ? "已恢复本地看板" : "准备好了，添加第一项任务吧。"));
})();
