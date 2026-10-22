/* Shared data boundary for the browser UI and dependency-free Node regression tests. */
(function (root) {
  "use strict";
  const DAY = 86400000;
  const KEY = "s5-temporary-kanban-v1";
  const uid = () => globalThis.crypto.randomUUID();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function createBoard(name = "今天的工作", days = 1, now = Date.now()) {
    return { id: uid(), name, days, expiresAt: now + days * DAY, columns: ["待办", "进行中", "已完成"].map((name) => ({ id: uid(), name })), tasks: [] };
  }
  function text(value, max, required = false) {
    if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new Error("文字字段缺失或超出长度限制");
    return value;
  }
  function validDate(value) {
    return value === "" || (/^(20\d{2})-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
  }
  function validateBoard(value) {
    if (!value || ![1, 3, 7].includes(value.days) || !Number.isFinite(value.expiresAt) || value.expiresAt <= 0 || !Array.isArray(value.columns) || value.columns.length < 1 || value.columns.length > 20 || !Array.isArray(value.tasks) || value.tasks.length > 500) throw new Error("看板格式不正确，或超过 20 个分组 / 500 个任务");
    const id = text(value.id, 80, true);
    const ids = new Set();
    const columns = value.columns.map((column) => {
      const id = text(column.id, 80, true);
      if (ids.has(id)) throw new Error("分组编号重复");
      ids.add(id);
      return { id, name: text(column.name, 60, true) };
    });
    const taskIds = new Set();
    const tasks = value.tasks.map((task) => {
      const id = text(task.id, 80, true);
      if (taskIds.has(id) || !ids.has(task.column) || !["normal", "high", "low"].includes(task.priority) || !validDate(task.due) || !Array.isArray(task.tags) || task.tags.length > 8) throw new Error("任务分组、优先级、日期或标签不正确");
      taskIds.add(id);
      return { id, title: text(task.title, 160, true), notes: text(task.notes, 4000), owner: text(task.owner, 60), due: task.due, priority: task.priority, column: task.column, tags: task.tags.map((tag) => text(tag, 30, true)) };
    });
    return { id, name: text(value.name, 80, true), days: value.days, expiresAt: value.expiresAt, columns, tasks };
  }
  function decode(raw, now = Date.now()) {
    const value = JSON.parse(raw);
    if (value.version !== 1 || !Array.isArray(value.boards) || value.boards.length > 10) throw new Error("不支持的看板数据格式");
    const boards = value.boards.map(validateBoard).filter((board) => board.expiresAt > now && board.expiresAt <= now + 7 * DAY);
    if (new Set(boards.map((board) => board.id)).size !== boards.length) throw new Error("看板编号重复");
    return { version: 1, active: boards.some((board) => board.id === value.active) ? value.active : boards[0]?.id, boards };
  }
  function importBoard(raw, now = Date.now()) {
    const value = JSON.parse(raw);
    if (value.version !== 1 || value.kind !== "s5-kanban-board") throw new Error("请选择此工具导出的看板 JSON 文件");
    const board = validateBoard(value.board);
    const columnIds = new Map(board.columns.map((column) => [column.id, uid()]));
    board.id = uid();
    board.expiresAt = now + board.days * DAY;
    board.columns.forEach((column) => { column.id = columnIds.get(column.id); });
    board.tasks.forEach((task) => { task.id = uid(); task.column = columnIds.get(task.column); });
    return board;
  }
  function moveTask(board, id, column, beforeId = null) {
    const task = board.tasks.find((task) => task.id === id);
    if (!task || !board.columns.some((item) => item.id === column) || beforeId === id) return;
    board.tasks = board.tasks.filter((item) => item.id !== id);
    task.column = column;
    const index = board.tasks.findIndex((item) => item.id === beforeId && item.column === column);
    board.tasks.splice(index < 0 ? board.tasks.length : index, 0, task);
  }
  const api = { DAY, KEY, uid, clone, createBoard, validateBoard, decode, importBoard, moveTask };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KanbanStore = api;
})(globalThis);
