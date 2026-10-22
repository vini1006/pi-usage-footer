import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";
import { agentDir, DEFAULT_SETTINGS, normalizeSettings, loadSettings, saveSettings } from "./settings.ts";

test("non-object input gives defaults", () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings("x"), DEFAULT_SETTINGS);
});

test("drops unknown widget types, bad colors, non-array lines", () => {
  const s = normalizeSettings({ lines: [[{ type: "nope" }, { type: "model", color: "pink" }, { type: "git", color: "dim" }], "x"] });
  assert.deepEqual(s, { lines: [[{ type: "model" }, { type: "git", color: "dim" }]] });
});

test("text widget keeps string text capped at 200 chars; non-string dropped", () => {
  const s = normalizeSettings({ lines: [[{ type: "text", text: "a".repeat(300) }, { type: "text", text: 5 }]] });
  assert.equal(s.lines[0][0].text?.length, 200);
  assert.equal(s.lines[0][1].text, undefined);
});

test("empty lines array is respected", () => {
  assert.deepEqual(normalizeSettings({ lines: [] }), { lines: [] });
});

test("load/save round trip, missing and corrupt files", () => {
  const dir = mkdtempSync(join(tmpdir(), "puf-"));
  const p = join(dir, "sub", "s.json");
  assert.deepEqual(loadSettings(p), DEFAULT_SETTINGS);
  const s = { lines: [[{ type: "model" as const, color: "accent" }]] };
  saveSettings(s, p);
  assert.deepEqual(loadSettings(p), s);
  writeFileSync(p, "{bad");
  assert.deepEqual(loadSettings(p), DEFAULT_SETTINGS);
});

test("agentDir expands ~ like pi", () => {
  assert.equal(agentDir("~/.pi-custom"), join(homedir(), ".pi-custom"));
  assert.equal(agentDir("/x/y"), "/x/y");
  assert.equal(agentDir(undefined), join(homedir(), ".pi", "agent"));
});
