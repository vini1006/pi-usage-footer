import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Settings, Widget } from "./settings.ts";
import type { Usage, UsageWindow } from "./usage.ts";

export type UsageState = { status: "none" } | { status: "loading" } | { status: "failed" } | { status: "ok"; usage: Usage };
export type FooterInput = {
  modelName?: string;
  thinking?: string;
  context?: { tokens: number | null; contextWindow: number; percent: number | null };
  cwd: string;
  home: string;
  branch?: string | null;
  sessionId?: string;
  startedAt?: number;
  now: number;
  usage: UsageState;
};
export type Paint = (color: string | undefined, text: string) => string;

export function bar(pct: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function formatDuration(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 1) return "<1m";
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d) return `${d}d ${h}hr ${m}m`;
  if (h) return `${h}hr ${m}m`;
  return `${m}m`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function block(label: string, pick: (u: Usage) => UsageWindow | undefined, input: FooterInput): string {
  const u = input.usage;
  if (u.status === "none") return "";
  if (u.status === "loading") return `${label}: …`;
  if (u.status === "failed") return `${label}: unavailable`;
  const win = pick(u.usage);
  if (!win) return "";
  if (win.resetsAt <= input.now) return `${label}: … | waiting for reset`;
  return `${label}: ${bar(win.used)} ${win.used.toFixed(1)}% | ${formatDuration(win.resetsAt - input.now)}`;
}

// Settings/pasted text must not inject terminal control sequences (OSC52, cursor moves) into the footer.
const clean = (t: string) => t.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b\[[0-?]*[ -\/]*[@-~]|\x1b./g, "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ");

export function renderWidget(w: Widget, i: FooterInput): string {
  switch (w.type) {
    case "model": return i.modelName ?? "";
    case "thinking": return i.thinking ?? "";
    case "context": {
      const c = i.context;
      if (!c) return "";
      if (c.tokens === null || c.percent === null) return `Context: ${bar(0)} ?/${formatTokens(c.contextWindow)}`;
      return `Context: ${bar(c.percent)} ${formatTokens(c.tokens)}/${formatTokens(c.contextWindow)} (${Math.round(c.percent)}%)`;
    }
    case "cwd": return `cwd: ${i.cwd === i.home || i.cwd.startsWith(i.home + "/") ? "~" + i.cwd.slice(i.home.length) : i.cwd}`;
    case "git": return `⎇ ${i.branch || "no git"}`;
    case "block5h": return block("5hr block", (u) => u.fiveHour, i);
    case "block1w": return block("1w block", (u) => u.sevenDay, i);
    case "sessionId": return i.sessionId ?? "";
    case "elapsed": return i.startedAt === undefined ? "" : formatDuration(i.now - i.startedAt);
    case "text": return clean(w.text ?? "");
    case "separator": return " | ";
  }
}

export function renderLines(s: Settings, input: FooterInput, width: number, paint: Paint): string[] {
  const out: string[] = [];
  for (const line of s.lines) {
    // Keep separators only between two visible widgets.
    const parts: { sep: boolean; text: string; w: Widget }[] = [];
    for (const w of line) {
      const text = renderWidget(w, input);
      if (!text) continue;
      const sep = w.type === "separator";
      if (sep && (!parts.length || parts.at(-1)!.sep)) continue;
      parts.push({ sep, text, w });
    }
    while (parts.at(-1)?.sep) parts.pop();
    if (!parts.some((p) => !p.sep)) continue;
    out.push(truncateToWidth(parts.map((p) => paint(p.w.color, p.text)).join(""), width));
  }
  return out;
}
