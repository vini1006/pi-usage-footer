import { DEFAULT_SETTINGS, type Settings, type Widget, type WidgetType } from "./settings.ts";

export type View = "lines" | "widgets" | "addWidget" | "color" | "text";
export type EditorState = { settings: Settings; view: View; line: number; widget: number; dirty: boolean };
export type Key = "up" | "down" | "enter" | "esc" | "a" | "d" | "[" | "]" | "c" | "t" | "r" | "s";

export const initialState = (settings: Settings): EditorState => ({ settings: structuredClone(settings), view: "lines", line: 0, widget: 0, dirty: false });

const clamp = (n: number, len: number) => Math.max(0, Math.min(n, len - 1));

/** Pure keyboard reducer. `pick` is the value chosen in a picker/input when `enter` is pressed there. */
export function reduce(prev: EditorState, key: Key, pick?: string): EditorState | "save" | "cancel" {
  const s: EditorState = { ...prev, settings: structuredClone(prev.settings) };
  const lines = s.settings.lines;
  const widgets = (): Widget[] => lines[s.line] ?? [];
  const edit = (next: Partial<EditorState>): EditorState => ({ ...s, ...next, dirty: true });

  switch (s.view) {
    case "lines":
      if (key === "up") return { ...s, line: clamp(s.line - 1, lines.length) };
      if (key === "down") return { ...s, line: clamp(s.line + 1, lines.length) };
      if (key === "enter") return lines.length ? { ...s, view: "widgets", widget: 0 } : s;
      if (key === "a") { lines.push([]); return edit({ line: lines.length - 1 }); }
      if (key === "d" && lines.length) { lines.splice(s.line, 1); return edit({ line: clamp(s.line, lines.length) }); }
      if (key === "r") return edit({ settings: structuredClone(DEFAULT_SETTINGS), line: 0 });
      if (key === "s") return "save";
      if (key === "esc") return "cancel";
      return s;
    case "widgets": {
      const ws = widgets();
      if (key === "esc") return { ...s, view: "lines" };
      if (key === "up") return { ...s, widget: clamp(s.widget - 1, ws.length) };
      if (key === "down") return { ...s, widget: clamp(s.widget + 1, ws.length) };
      if (key === "a") return { ...s, view: "addWidget" };
      if (key === "c") return { ...s, view: "color" };
      if (key === "t") return ws[s.widget]?.type === "text" ? { ...s, view: "text" } : s;
      if (key === "d" && ws.length) {
        ws.splice(s.widget, 1);
        return edit({ widget: clamp(s.widget, ws.length) });
      }
      if (key === "[" || key === "]") {
        const to = s.widget + (key === "[" ? -1 : 1);
        if (to < 0 || to >= ws.length) return s;
        [ws[s.widget], ws[to]] = [ws[to], ws[s.widget]];
        return edit({ widget: to });
      }
      return s;
    }
    case "addWidget":
      if (key === "esc") return { ...s, view: "widgets" };
      if (key === "enter" && pick) {
        const ws = widgets();
        const at = ws.length ? s.widget + 1 : 0;
        ws.splice(at, 0, { type: pick as WidgetType });
        return edit({ view: "widgets", widget: at });
      }
      return s;
    case "color":
      if (key === "esc") return { ...s, view: "widgets" };
      if (key === "enter" && pick) {
        const w = widgets()[s.widget];
        if (w) { if (pick === "(none)") delete w.color; else w.color = pick; }
        return edit({ view: "widgets" });
      }
      return s;
    case "text":
      if (key === "esc") return { ...s, view: "widgets" };
      if (key === "enter" && pick !== undefined) {
        const w = widgets()[s.widget];
        if (w) w.text = pick.slice(0, 200);
        return edit({ view: "widgets" });
      }
      return s;
  }
}
