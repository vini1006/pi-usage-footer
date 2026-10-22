import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, type Settings } from "./settings.ts";
import { initialState, reduce, type EditorState } from "./editor-state.ts";

const st = (settings: Settings, over: Partial<EditorState> = {}): EditorState => ({ ...initialState(settings), ...over });
const ok = (r: ReturnType<typeof reduce>): EditorState => { assert.equal(typeof r, "object"); return r as EditorState; };
const two: Settings = { lines: [[{ type: "model" }, { type: "git" }, { type: "cwd" }], [{ type: "text", text: "x" }]] };

test("lines view: a adds an empty line and selects it; d removes", () => {
  let s = ok(reduce(st(two), "a"));
  assert.equal(s.settings.lines.length, 3);
  assert.deepEqual(s.settings.lines[2], []);
  assert.equal(s.line, 2);
  s = ok(reduce(s, "d"));
  assert.equal(s.settings.lines.length, 2);
  assert.equal(s.line, 1);
  assert.equal(s.dirty, true);
});

test("lines view: up/down clamp, r resets to defaults, s saves, esc cancels", () => {
  assert.equal(ok(reduce(st(two), "up")).line, 0);
  assert.equal(ok(reduce(st(two), "down")).line, 1);
  assert.equal(ok(reduce(st(two, { line: 1 }), "down")).line, 1);
  assert.deepEqual(ok(reduce(st(two), "r")).settings, DEFAULT_SETTINGS);
  assert.equal(reduce(st(two), "s"), "save");
  assert.equal(reduce(st(two), "esc"), "cancel");
});

test("enter opens widgets view (also for an empty line, so widgets can be added); esc returns", () => {
  assert.equal(ok(reduce(st(two), "enter")).view, "widgets");
  assert.equal(ok(reduce(st({ lines: [[]] }), "enter")).view, "widgets");
  assert.equal(ok(reduce(st({ lines: [] }), "enter")).view, "lines");
  assert.equal(ok(reduce(st(two, { view: "widgets" }), "esc")).view, "lines");
});

test("widgets view: ] swaps right, [ at index 0 is a no-op, selection follows", () => {
  let s = ok(reduce(st(two, { view: "widgets" }), "]"));
  assert.deepEqual(s.settings.lines[0].map((w) => w.type), ["git", "model", "cwd"]);
  assert.equal(s.widget, 1);
  s = ok(reduce(st(two, { view: "widgets" }), "["));
  assert.deepEqual(s.settings.lines[0].map((w) => w.type), ["model", "git", "cwd"]);
  assert.equal(s.widget, 0);
});

test("widgets view: d deletes and clamps selection; deleting the last widget leaves an empty line in widgets view", () => {
  const s = ok(reduce(st(two, { view: "widgets", widget: 2 }), "d"));
  assert.equal(s.widget, 1);
  const last = ok(reduce(st(two, { view: "widgets", line: 1 }), "d"));
  assert.equal(last.view, "widgets");
  assert.deepEqual(last.settings.lines[1], []);
  assert.equal(ok(reduce({ ...last, view: "widgets" }, "d")).view, "widgets");
});

test("add picker inserts after current widget; on an empty line appends", () => {
  let s = ok(reduce(st(two, { view: "widgets" }), "a"));
  assert.equal(s.view, "addWidget");
  s = ok(reduce(s, "enter", "git"));
  assert.deepEqual(s.settings.lines[0].map((w) => w.type), ["model", "git", "git", "cwd"]);
  assert.equal(s.view, "widgets");
  assert.equal(s.widget, 1);
  const e = ok(reduce(ok(reduce(st({ lines: [[]] }, { view: "widgets" }), "a")), "enter", "model"));
  assert.deepEqual(e.settings.lines[0], [{ type: "model" }]);
});

test("adding a line from lines view then a widget works end to end", () => {
  let s = ok(reduce(st(two), "a"));
  s = ok(reduce(s, "enter")); // empty new line opens the widget view so widgets can be added
  assert.equal(s.view, "widgets");
  s = ok(reduce(ok(reduce(s, "a")), "enter", "model"));
  assert.deepEqual(s.settings.lines[2], [{ type: "model" }]);
});

test("color picker sets or clears color", () => {
  let s = ok(reduce(st(two, { view: "widgets" }), "c"));
  assert.equal(s.view, "color");
  s = ok(reduce(s, "enter", "accent"));
  assert.equal(s.settings.lines[0][0].color, "accent");
  assert.equal(s.view, "widgets");
  s = ok(reduce(ok(reduce(s, "c")), "enter", "(none)"));
  assert.equal("color" in s.settings.lines[0][0], false);
});

test("t only works on text widgets and sets text; esc in a picker returns to widgets", () => {
  assert.equal(ok(reduce(st(two, { view: "widgets" }), "t")).view, "widgets");
  let s = ok(reduce(st(two, { view: "widgets", line: 1 }), "t"));
  assert.equal(s.view, "text");
  s = ok(reduce(s, "enter", "hello"));
  assert.equal(s.settings.lines[1][0].text, "hello");
  assert.equal(ok(reduce(ok(reduce(st(two, { view: "widgets" }), "a")), "esc")).view, "widgets");
});

test("reduce never mutates its input", () => {
  const before = st(two);
  const snapshot = structuredClone(before);
  reduce(before, "a"); reduce({ ...before, view: "widgets" }, "]"); reduce({ ...before, view: "widgets" }, "d");
  assert.deepEqual(before, snapshot);
});
