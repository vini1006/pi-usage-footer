import assert from "node:assert/strict";
import childProcess from "node:child_process";
import os from "node:os";
import { test } from "node:test";
import { readClaudeToken, fetchUsage } from "./usage.ts";

const fixture = { five_hour: { utilization: 0.5, resets_at: "2026-10-21T12:10:00Z" }, seven_day: null };
const credentials = JSON.stringify({ claudeAiOauth: { accessToken: "test-access-token", refreshToken: "never-use-this-refresh-token", expiresAt: Date.now() + 3_600_000, scopes: ["user:profile", "user:inference"] } });

function keychain(t: any, stdout = credentials) {
  t.mock.method(os, "platform", () => "darwin");
  return t.mock.method(childProcess, "execFile", (_file: string, _args: string[], _options: unknown, callback: Function) => {
    callback(null, stdout, "");
    return {};
  });
}

// Catches accidentally forwarding credentials to proxies/redirects or using the wrong auth header.
test("requests only the official usage endpoint with bearer auth and redirect rejection", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: unknown, options: any) => {
    assert.equal(url, "https://api.anthropic.com/api/oauth/usage");
    assert.equal(options.headers.Authorization, "Bearer test-access-token");
    assert.equal(options.headers["anthropic-beta"], "oauth-2025-04-20");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(fixture);
  });
  const usage = await fetchUsage("test-access-token");
  assert.equal(usage.fiveHour?.used, 0.5);
  assert.equal(usage.sevenDay, undefined);
});

for (const status of [401, 403, 429, 500]) {
  test(`HTTP ${status} is unavailable without disclosing the response body`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response("secret-token-in-error-body", { status }));
    await assert.rejects(fetchUsage("test-access-token"), (error: Error) => {
      assert.match(error.message, status === 401 || status === 403 ? /login|expired/i : new RegExp(`${status}`));
      assert.doesNotMatch(error.message, /test-access-token|secret-token/);
      return true;
    });
  });
}

test("network/redirect exceptions cannot disclose tokens", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("secret-token-in-upstream-error"); });
  await assert.rejects(fetchUsage("test-access-token"), (error: Error) => {
    assert.match(error.message, /request failed/i);
    assert.doesNotMatch(error.message, /secret-token|test-access-token/);
    return true;
  });
});

for (const body of ["secret-token-invalid-json", JSON.stringify({ error: "secret-token-in-error-envelope" })]) {
  test("malformed response is sanitized", async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response(body));
    await assert.rejects(fetchUsage("test-access-token"), /Invalid usage response/);
  });
}

test("cancellation is propagated to the fetch signal", async (t) => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | undefined;
  t.mock.method(globalThis, "fetch", (_url: unknown, options: any) => {
    requestSignal = options.signal;
    return new Promise((_resolve, reject) => requestSignal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  });
  const request = fetchUsage("test-access-token", controller.signal);
  controller.abort();
  await assert.rejects(request, /request failed/i);
  assert.equal(requestSignal?.aborted, true);
});

test("reads the current user's existing Keychain entry without writing or refreshing", async (t) => {
  const command = keychain(t);
  assert.ok((await readClaudeToken(undefined, {})) === "test-access-token", "Expected synthetic fixture token; do not print credentials");
  const [file, args, options] = command.mock.calls[0].arguments;
  assert.equal(file, "/usr/bin/security");
  assert.deepEqual(args, ["find-generic-password", "-s", "Claude Code-credentials", "-a", os.userInfo().username, "-w"]);
  assert.equal(options.timeout, 10_000);
  assert.equal(options.encoding, "utf8");
  assert.ok(options.maxBuffer <= 1_048_576);
  assert.equal(command.mock.calls.length, 1);
});

test("accepts an explicitly specified default config directory", async (t) => {
  keychain(t);
  assert.ok((await readClaudeToken(undefined, { CLAUDE_CONFIG_DIR: `${os.homedir()}/.claude` })) === "test-access-token", "Expected synthetic fixture token; do not print credentials");
});

for (const env of [{ CLAUDE_CONFIG_DIR: "/different-account" }, { PI_CLAUDE_CODE_CONFIG_DIR: "/different-account", CLAUDE_CONFIG_DIR: `${os.homedir()}/.claude` }]) {
  test("non-default config cannot silently use the default account", async (t) => {
    const command = keychain(t);
    await assert.rejects(readClaudeToken(undefined, env), /config directory/i);
    assert.equal(command.mock.calls.length, 0);
  });
}

test("non-macOS hosts do not launch security", async (t) => {
  const command = keychain(t);
  t.mock.method(os, "platform", () => "linux");
  await assert.rejects(readClaudeToken(undefined, {}), /macOS/);
  assert.equal(command.mock.calls.length, 0);
});

for (const raw of ["secret-token-invalid-json", "{}", JSON.stringify({ claudeAiOauth: { accessToken: "" } }), JSON.stringify({ claudeAiOauth: { accessToken: "bad\ntoken" } }), JSON.stringify({ claudeAiOauth: { accessToken: "test-access-token", expiresAt: "invalid" } })]) {
  test("invalid credentials fail without leaking Keychain content", async (t) => {
    keychain(t, raw);
    await assert.rejects(readClaudeToken(undefined, {}), (error: Error) => {
      assert.match(error.message, /credentials/i);
      assert.doesNotMatch(error.message, /secret-token|test-access-token|bad\ntoken/);
      return true;
    });
  });
}

test("expired token is not submitted or refreshed", async (t) => {
  const command = keychain(t, JSON.stringify({ claudeAiOauth: { accessToken: "test-access-token", expiresAt: 1 } }));
  await assert.rejects(readClaudeToken(undefined, {}), /expired/i);
  assert.equal(command.mock.calls.length, 1);
});

test("process errors are sanitized and cancellation reaches Keychain lookup", async (t) => {
  keychain(t);
  const controller = new AbortController();
  t.mock.method(childProcess, "execFile", (_file: unknown, _args: unknown, options: any, callback: Function) => {
    assert.equal(options.signal, controller.signal);
    callback(new Error("secret-token-in-process-stderr"), "", "secret-token");
    return {};
  });
  await assert.rejects(readClaudeToken(controller.signal, {}), (error: Error) => {
    assert.match(error.message, /Keychain/);
    assert.doesNotMatch(error.message, /secret-token/);
    return true;
  });
});
