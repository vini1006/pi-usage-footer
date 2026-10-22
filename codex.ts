import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentDir } from "./settings.ts";
import type { Usage, UsageWindow } from "./usage.ts";

const URL = "https://chatgpt.com/backend-api/wham/usage";

export function parseCodexUsage(json: unknown): Usage {
  const invalid = () => new Error("Invalid usage response");
  const rate = (json as { rate_limit?: Record<string, unknown> } | null)?.rate_limit;
  if (!rate || typeof rate !== "object") throw invalid();
  const window = (value: unknown): UsageWindow | undefined => {
    if (value == null) return undefined;
    const { used_percent, reset_at } = value as Record<string, unknown>;
    if (typeof used_percent !== "number" || !Number.isFinite(used_percent) || used_percent < 0 || used_percent > 100 || typeof reset_at !== "number" || !Number.isFinite(reset_at)) throw invalid();
    return { used: used_percent, resetsAt: reset_at * 1000 };
  };
  const usage = { fiveHour: window(rate.primary_window), sevenDay: window(rate.secondary_window) };
  if (!usage.fiveHour && !usage.sevenDay) throw invalid();
  return usage;
}

export async function fetchCodexUsage(token: string, accountId: string | undefined, signal?: AbortSignal): Promise<Usage> {
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(10_000);
    response = await fetch(URL, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "codex-cli", ...(accountId ? { "ChatGPT-Account-Id": accountId } : {}) },
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    throw new Error("Usage request failed (network, timeout or redirect)");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Usage request failed (HTTP ${response.status})`);
  }
  try {
    return parseCodexUsage(await response.json());
  } catch {
    throw new Error("Invalid usage response");
  }
}

// Non-secret account id only; the access token comes from pi's model registry.
export function readCodexAccountId(authPath = join(agentDir(), "auth.json")): string | undefined {
  try {
    const id = JSON.parse(readFileSync(authPath, "utf8"))?.["openai-codex"]?.accountId;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}
