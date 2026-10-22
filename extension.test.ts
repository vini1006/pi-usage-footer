import assert from "node:assert/strict";
import childProcess from "node:child_process";
import os from "node:os";
import { test } from "node:test";
import extension from "./extension.ts";

const now = Date.parse("2026-10-21T10:00:00Z");
const claudeFixture = { five_hour: { utilization: 32, resets_at: "2026-10-21T12:10:00Z" }, seven_day: { utilization: 48, resets_at: "2026-10-24T10:00:00Z" } };
const codexFixture = { rate_limit: { primary_window: { used_percent: 7, reset_at: now / 1000 + 3600 }, secondary_window: { used_percent: 9, reset_at: now / 1000 + 86400 } } };
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(t: any, provider = "claude-code", mode = "tui", codexKey: string | null = "codex-synthetic") {
  t.mock.method(Date, "now", () => now);
  t.mock.method(os, "platform", () => "darwin");
  t.mock.method(childProcess, "execFile", (_f: unknown, _a: unknown, _o: unknown, cb: Function) => {
    cb(null, JSON.stringify({ claudeAiOauth: { accessToken: "test-access-token", expiresAt: now + 3_600_000 } }), "");
    return {};
  });
  let respond: () => Promise<Response> = async () => Response.json(provider === "openai" ? codexFixture : claudeFixture);
  const request = t.mock.method(globalThis, "fetch", () => respond());
  const timers = new Map<any, { callback: Function; ms: number }>();
  t.mock.method(globalThis, "setInterval", (callback: Function, ms: number) => { const timer = { unref() {} }; timers.set(timer, { callback, ms }); return timer; });
  t.mock.method(globalThis, "clearInterval", (timer: unknown) => { timers.delete(timer); });
  const events = new Map<string, Function>();
  let factory: any;
  const ctx: any = {
    mode, cwd: "/Users/me/proj", model: { provider, id: "m", name: "Test Model", reasoning: true },
    getContextUsage: () => ({ tokens: 10, contextWindow: 1000, percent: 1 }),
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, env: {} }), getApiKeyForProvider: async () => codexKey ?? undefined },
    sessionManager: { getSessionId: () => "sid", getHeader: () => ({ timestamp: new Date(now).toISOString() }) },
    ui: { setFooter: (f: unknown) => { factory = f; } },
  };
  extension({ on: (n: string, h: Function) => events.set(n, h), getThinkingLevel: () => "high", registerCommand() {} } as any);
  const render = () => {
    const c = factory({ requestRender() {} }, { fg: (_c: string, t: string) => t }, { getGitBranch: () => "main", onBranchChange: () => () => {} });
    return c.render(200) as string[];
  };
  return {
    ctx, timers, request, render, hasFooter: () => factory !== undefined, setRespond: (fn: () => Promise<Response>) => { respond = fn; },
    emit: async (name: string, event = {}) => { await events.get(name)?.(event, ctx); await flush(); },
  };
}

test("loading extension has no side effects", (t) => {
  const h = setup(t);
  assert.equal(h.request.mock.calls.length, 0);
  assert.equal(h.timers.size, 0);
});

for (const mode of ["print", "rpc", "json"]) {
  test(`no footer or fetch in ${mode} mode`, async (t) => {
    const h = setup(t, "claude-code", mode);
    await h.emit("session_start");
    assert.equal(h.hasFooter(), false);
    assert.equal(h.request.mock.calls.length, 0);
    assert.equal(h.timers.size, 0);
  });
}

test("claude-code shows usage blocks after fetch", async (t) => {
  const h = setup(t);
  await h.emit("session_start");
  const lines = h.render();
  assert.equal(lines[0], "Test Model | high | Context: ░░░░░░░░░░ 10/1.0k (1%)");
  assert.equal(lines[2], "5hr block: ███░░░░░░░ 32.0% | 2hr 10m");
  assert.equal(lines[3], "1w block: █████░░░░░ 48.0% | 3d 0hr 0m");
});

test("openai uses the openai-codex token via registry", async (t) => {
  const h = setup(t, "openai");
  await h.emit("session_start");
  assert.equal(h.request.mock.calls[0].arguments[1].headers.Authorization, "Bearer codex-synthetic");
  assert.match(h.render()[2], /^5hr block: .* 7\.0% \| 1hr 0m$/);
});

test("openai without openai-codex login shows unavailable", async (t) => {
  const h = setup(t, "openai", "tui", null);
  await h.emit("session_start");
  assert.equal(h.render().at(-1), "1w block: unavailable");
  assert.equal(h.request.mock.calls.length, 0);
});

test("other providers: footer but no usage lines, fetch, or poll timer", async (t) => {
  const h = setup(t, "anthropic");
  await h.emit("session_start");
  assert.equal(h.render().length, 2);
  assert.equal(h.request.mock.calls.length, 0);
  assert.equal([...h.timers.values()].some((x) => x.ms === 300_000), false);
});

test("stale fetch after provider switch does not leak into new provider", async (t) => {
  const h = setup(t);
  let release!: () => void;
  h.setRespond(() => new Promise((r) => { release = () => r(Response.json(claudeFixture)); }));
  await h.emit("session_start");
  h.ctx.model = { ...h.ctx.model, provider: "anthropic" };
  await h.emit("model_select", { model: h.ctx.model });
  release();
  await flush();
  assert.equal(h.render().length, 2);
});

test("shutdown clears timers", async (t) => {
  const h = setup(t);
  await h.emit("session_start");
  assert.ok(h.timers.size > 0);
  await h.emit("session_shutdown");
  assert.equal(h.timers.size, 0);
});
