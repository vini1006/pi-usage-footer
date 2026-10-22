import childProcess from "node:child_process";
import os from "node:os";
import { resolve } from "node:path";

export async function readClaudeToken(signal?: AbortSignal, env: Record<string, string | undefined> = process.env): Promise<string> {
  if (os.platform() !== "darwin") throw new Error("Usage lookup currently requires macOS Keychain");
  const configDir = env.PI_CLAUDE_CODE_CONFIG_DIR || env.CLAUDE_CONFIG_DIR;
  // shortcut: custom Claude config uses a different Keychain service; add verified account matching before supporting it.
  if (configDir && resolve(configDir) !== resolve(os.homedir(), ".claude")) throw new Error("Non-default Claude config directory is not supported");

  let raw: string;
  try {
    raw = await new Promise<string>((resolve, reject) => {
      childProcess.execFile("/usr/bin/security", [
        "find-generic-password", "-s", "Claude Code-credentials", "-a", os.userInfo().username, "-w",
      ], { encoding: "utf8", timeout: 10_000, maxBuffer: 262_144, signal }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
  } catch {
    throw new Error("Cannot read Claude Code Keychain login; check access and run claude auth login");
  }

  let credentials;
  try {
    credentials = JSON.parse(raw)?.claudeAiOauth;
  } catch {
    throw new Error("Invalid Claude Code credentials");
  }
  const token = credentials?.accessToken;
  const expires = credentials?.expiresAt;
  if (typeof token !== "string" || !token || /\s/.test(token) || (expires !== undefined && (typeof expires !== "number" || !Number.isFinite(expires)))) throw new Error("Invalid Claude Code credentials");
  if (expires !== undefined && expires <= Date.now()) throw new Error("Claude Code login expired; run Claude Code to refresh it");
  return token;
}

export async function fetchUsage(token: string, signal?: AbortSignal): Promise<Usage> {
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(10_000);
    response = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20", Accept: "application/json" },
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    throw new Error("Usage request failed (network, timeout or redirect)");
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) throw new Error("Claude Code login expired or lacks usage permission; run Claude Code to check login");
    throw new Error(`Usage request failed (HTTP ${response.status})`);
  }
  try {
    return parseUsage(await response.json());
  } catch {
    throw new Error("Invalid usage response");
  }
}

export type UsageWindow = { used: number; resetsAt: number };
export type Usage = { fiveHour?: UsageWindow; sevenDay?: UsageWindow };

export function parseUsage(value: unknown): Usage {
  const invalid = () => new Error("Invalid usage response");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const data = value as Record<string, unknown>;
  const window = (value: unknown): UsageWindow | undefined => {
    if (value == null) return undefined;
    if (typeof value !== "object" || Array.isArray(value)) throw invalid();
    const { utilization, resets_at } = value as Record<string, unknown>;
    if (typeof utilization !== "number" || !Number.isFinite(utilization) || utilization < 0 || utilization > 100 || typeof resets_at !== "string") throw invalid();
    const resetsAt = Date.parse(resets_at);
    if (!Number.isFinite(resetsAt)) throw invalid();
    return { used: utilization, resetsAt };
  };
  const usage = { fiveHour: window(data.five_hour), sevenDay: window(data.seven_day) };
  if (!usage.fiveHour && !usage.sevenDay) throw invalid();
  return usage;
}

export function formatUsage(usage: Usage, now = Date.now()): string {
  const window = (label: string, value?: UsageWindow): string => {
    if (!value) return `${label} —`;
    if (value.resetsAt <= now) return `${label} 갱신 대기`;
    const minutes = Math.ceil((value.resetsAt - now) / 60_000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const reset = days ? `${days}d${hours % 24 ? `${hours % 24}h` : ""}` : hours ? `${hours}h${minutes % 60 ? `${minutes % 60}m` : ""}` : `${minutes}m`;
    return `${label} ${Number(value.used.toFixed(1))}% ↻${reset}`;
  };
  return `Claude ${window("5h", usage.fiveHour)} | ${window("7d", usage.sevenDay)}`;
}
