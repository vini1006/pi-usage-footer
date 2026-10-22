import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fetchCodexUsage, parseCodexUsage, readCodexAccountId } from "./codex.ts";

const payload = { rate_limit: { primary_window: { used_percent: 0, reset_at: 1792692397 }, secondary_window: { used_percent: 5, reset_at: 1793108960 } } };

test("maps primary to 5h and secondary to weekly", () => {
  assert.deepEqual(parseCodexUsage(payload), { fiveHour: { used: 0, resetsAt: 1792692397000 }, sevenDay: { used: 5, resetsAt: 1793108960000 } });
});

test("rejects empty and out-of-range payloads", () => {
  assert.throws(() => parseCodexUsage({}), /Invalid usage response/);
  assert.throws(() => parseCodexUsage({ rate_limit: { primary_window: { used_percent: 150, reset_at: 1 } } }), /Invalid usage response/);
});

test("fetch sends expected request and never leaks the token in errors", async (t) => {
  let seen: { url: unknown; init: any } | undefined;
  t.mock.method(globalThis, "fetch", async (url: unknown, init: any) => { seen = { url, init }; return new Response("no", { status: 401 }); });
  await assert.rejects(fetchCodexUsage("tok-SYNTHETIC", "acct-1"), (e: Error) => !e.message.includes("tok-SYNTHETIC"));
  assert.equal(seen!.url, "https://chatgpt.com/backend-api/wham/usage");
  assert.deepEqual(seen!.init.headers, { Authorization: "Bearer tok-SYNTHETIC", Accept: "application/json", "User-Agent": "codex-cli", "ChatGPT-Account-Id": "acct-1" });
  assert.equal(seen!.init.redirect, "error");
});

test("fetch parses a 200 and omits account header when unknown", async (t) => {
  let headers: any;
  t.mock.method(globalThis, "fetch", async (_u: unknown, init: any) => { headers = init.headers; return Response.json(payload); });
  assert.equal((await fetchCodexUsage("t", undefined)).sevenDay?.used, 5);
  assert.equal("ChatGPT-Account-Id" in headers, false);
});

test("readCodexAccountId", () => {
  const dir = mkdtempSync(join(tmpdir(), "puf-"));
  const p = join(dir, "auth.json");
  assert.equal(readCodexAccountId(p), undefined);
  writeFileSync(p, JSON.stringify({ "openai-codex": { accountId: "a1", access: "x" } }));
  assert.equal(readCodexAccountId(p), "a1");
  writeFileSync(p, JSON.stringify({ openai: {} }));
  assert.equal(readCodexAccountId(p), undefined);
});
