import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_SETTINGS } from "./settings.ts";
import { bar, formatDuration, formatTokens, renderLines, type FooterInput } from "./render.ts";

const now = Date.parse("2026-10-22T10:00:00Z");
const id = (_c: string | undefined, t: string) => t;
const base = (over: Partial<FooterInput> = {}): FooterInput => ({
  modelName: "Sonnet 5.5", thinking: "high",
  context: { tokens: 0, contextWindow: 1_000_000, percent: 0 },
  cwd: "/Users/me/proj", home: "/Users/me", branch: "main", now,
  usage: { status: "ok", usage: { fiveHour: { used: 0, resetsAt: now + (4 * 60 + 48) * 60e3 } } },
  ...over,
});

test("default layout matches the reference image; missing window hides its line", () => {
  const lines = renderLines(DEFAULT_SETTINGS, base(), 200, id);
  assert.deepEqual(lines, [
    "Sonnet 5.5 | high | Context: ░░░░░░░░░░ 0/1.0M (0%)",
    "cwd: ~/proj | ⎇ main",
    "5hr block: ░░░░░░░░░░ 0.0% | 4hr 48m",
  ]);
});

test("usage none hides both usage lines", () => {
  assert.equal(renderLines(DEFAULT_SETTINGS, base({ usage: { status: "none" } }), 200, id).length, 2);
});

test("no git, no thinking, unknown context tokens", () => {
  const lines = renderLines(DEFAULT_SETTINGS, base({ branch: null, thinking: undefined, context: { tokens: null, contextWindow: 1_000_000, percent: null } }), 200, id);
  assert.equal(lines[0], "Sonnet 5.5 | Context: ░░░░░░░░░░ ?/1.0M");
  assert.ok(lines[1].endsWith("⎇ no git"));
});

test("loading, failed and expired usage states", () => {
  const l = (usage: FooterInput["usage"]) => renderLines(DEFAULT_SETTINGS, base({ usage }), 200, id).at(-1);
  assert.equal(l({ status: "loading" }), "1w block: …");
  assert.equal(l({ status: "failed" }), "1w block: unavailable");
  assert.equal(renderLines(DEFAULT_SETTINGS, base({ usage: { status: "ok", usage: { fiveHour: { used: 3, resetsAt: now - 1 } } } }), 200, id)[2], "5hr block: … | waiting for reset");
});

test("narrow terminal truncates every line", () => {
  for (const line of renderLines(DEFAULT_SETTINGS, base(), 20, id)) assert.ok(visibleWidth(line) <= 20);
});

test("color painting, text and extra widgets", () => {
  const s = { lines: [[{ type: "text" as const, text: "hi", color: "accent" }, { type: "separator" as const }, { type: "sessionId" as const }, { type: "separator" as const }, { type: "elapsed" as const }]] };
  const lines = renderLines(s, base({ sessionId: "abc", startedAt: now - 5 * 60e3 }), 200, (c, t) => (c ? `<${c}>${t}</>` : t));
  assert.deepEqual(lines, ["<accent>hi</> | abc | 5m"]);
});

test("helpers", () => {
  assert.equal(formatDuration(3 * 864e5 + 3 * 36e5 + 8 * 6e4), "3d 3hr 8m");
  assert.equal(formatDuration((4 * 60 + 48) * 6e4), "4hr 48m");
  assert.equal(formatDuration(30e3), "<1m");
  assert.equal(bar(50), "█████░░░░░");
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1500), "1.5k");
  assert.equal(formatTokens(1_000_000), "1.0M");
});
