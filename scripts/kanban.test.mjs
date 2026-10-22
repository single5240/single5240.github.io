import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("../assets/js/kanban-store.js");
const now = Date.now();
function task(board, title, column = board.columns[0].id) {
  return { id: S.uid(), title, column, notes: "", owner: "", due: "", priority: "normal", tags: [] };
}
function stored(boards, active = boards[0]?.id) { return JSON.stringify({ version: 1, active, boards }); }
test("independent boards and fixed 24-hour expiry; edits do not extend retention", () => {
  const a = S.createBoard("项目 A", 1, now), b = S.createBoard("项目 B", 3, now);
  a.tasks.push(task(a, "只属于 A"));
  assert.notEqual(a.id, b.id);
  assert.equal(b.tasks.length, 0);
  assert.equal(S.decode(stored([a, b]), now + S.DAY - 1).boards.length, 2);
  assert.equal(S.decode(stored([a, b]), now + S.DAY).boards.length, 1);
  assert.equal(S.decode(stored([a, b]), now + 3 * S.DAY).boards.length, 0);
});
test("expiry rejects unexpected retention beyond seven days and selects remaining board", () => {
  const a = S.createBoard("A", 1, now), b = S.createBoard("B", 7, now);
  const result = S.decode(stored([a, b]), now + S.DAY);
  assert.equal(result.active, b.id);
  b.expiresAt = now + 8 * S.DAY;
  assert.equal(S.decode(stored([b]), now).boards.length, 0);
});
test("drag between columns, insert before target, append and self-drop preserve tasks", () => {
  const board = S.createBoard();
  const a = task(board, "A"), b = task(board, "B"), c = task(board, "C", board.columns[1].id);
  board.tasks.push(a, b, c);
  S.moveTask(board, b.id, c.column, c.id);
  assert.deepEqual(board.tasks.filter((t) => t.column === c.column).map((t) => t.title), ["B", "C"]);
  S.moveTask(board, b.id, c.column);
  assert.deepEqual(board.tasks.filter((t) => t.column === c.column).map((t) => t.title), ["C", "B"]);
  S.moveTask(board, a.id, a.column, a.id);
  assert.equal(board.tasks.length, 3);
  assert.equal(S.validateBoard(board).tasks.length, 3);
});
test("JSON roundtrip preserves content; imported copy has fresh identity and expiry", () => {
  const board = S.createBoard("中文项目", 3, now);
  board.tasks.push({ ...task(board, '<img src=x onerror="alert(1)">'), notes: "多行\n文本", owner: "测试人", tags: ["开发"], due: "2026-10-23" });
  const imported = S.importBoard(JSON.stringify({ version: 1, kind: "s5-kanban-board", board }), now + S.DAY);
  assert.notEqual(imported.id, board.id);
  assert.notEqual(imported.tasks[0].id, board.tasks[0].id);
  assert.equal(imported.tasks[0].column, imported.columns[0].id);
  assert.equal(imported.expiresAt, now + 4 * S.DAY);
  assert.equal(imported.tasks[0].title, board.tasks[0].title);
  assert.equal(S.decode(stored([imported]), now + S.DAY).boards[0].tasks[0].notes, "多行\n文本");
});
test("external JSON rejects invalid references, duplicate IDs, invalid dates and size limits", () => {
  const board = S.createBoard(); board.tasks.push(task(board, "A"));
  for (const mutate of [
    (b) => { b.tasks[0].column = "missing"; },
    (b) => { b.columns.push(b.columns[0]); },
    (b) => { b.tasks.push(b.tasks[0]); },
    (b) => { b.tasks[0].due = "2026-02-30"; },
    (b) => { b.tasks[0].title = " "; },
    (b) => { b.days = 999; },
    (b) => { b.tasks[0].tags = Array(9).fill("tag"); },
    (b) => { b.tasks[0].notes = "x".repeat(4001); },
    (b) => { b.columns = []; },
    (b) => { b.tasks = Array(501).fill(b.tasks[0]); },
  ]) { const copy = S.clone(board); mutate(copy); assert.throws(() => S.validateBoard(copy)); }
  assert.throws(() => S.decode(stored([board, board])));
  assert.throws(() => S.decode(stored(Array(11).fill(board))));
  assert.throws(() => S.importBoard('{"version":2}'));
  assert.throws(() => S.importBoard("not json"));
});
