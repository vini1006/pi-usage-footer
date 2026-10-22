import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type WidgetType = "model" | "thinking" | "context" | "cwd" | "git" | "block5h" | "block1w" | "sessionId" | "elapsed" | "text" | "separator";
export const WIDGET_TYPES: readonly WidgetType[] = ["model", "thinking", "context", "cwd", "git", "block5h", "block1w", "sessionId", "elapsed", "text", "separator"];
export const COLORS: readonly string[] = ["accent", "text", "muted", "dim", "success", "warning", "error", "borderAccent", "mdLink", "mdCode", "syntaxKeyword", "syntaxString", "syntaxNumber", "syntaxType"];
export type Widget = { type: WidgetType; color?: string; text?: string };
export type Settings = { lines: Widget[][] };

const w = (type: WidgetType, color?: string): Widget => (color ? { type, color } : { type });
const sep = w("separator");
export const DEFAULT_SETTINGS: Settings = {
  lines: [
    [w("model", "accent"), sep, w("thinking", "muted"), sep, w("context", "mdLink")],
    [w("cwd", "mdLink"), sep, w("git", "muted")],
    [w("block5h", "syntaxType")],
    [w("block1w", "syntaxType")],
  ],
};

export const SETTINGS_PATH = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "pi-usage-footer.json");

export function normalizeSettings(raw: unknown): Settings {
  const lines = (raw as { lines?: unknown } | null)?.lines;
  if (!Array.isArray(lines)) return structuredClone(DEFAULT_SETTINGS);
  const out: Widget[][] = [];
  for (const line of lines) {
    if (!Array.isArray(line)) continue;
    const widgets: Widget[] = [];
    for (const item of line) {
      const { type, color, text } = (item ?? {}) as Record<string, unknown>;
      if (!WIDGET_TYPES.includes(type as WidgetType)) continue;
      const widget: Widget = { type: type as WidgetType };
      if (typeof color === "string" && COLORS.includes(color)) widget.color = color;
      if (type === "text" && typeof text === "string") widget.text = text.slice(0, 200);
      widgets.push(widget);
    }
    out.push(widgets);
  }
  return { lines: out };
}

export function loadSettings(path = SETTINGS_PATH): Settings {
  try {
    return normalizeSettings(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings, path = SETTINGS_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(s, null, 2) + "\n");
}
