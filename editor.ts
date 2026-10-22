import { DynamicBorder, getSelectListTheme, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey, SelectList, truncateToWidth, type Component, type Focusable, type KeyId } from "@earendil-works/pi-tui";
import { initialState, reduce, type EditorState, type Key } from "./editor-state.ts";
import { COLORS, WIDGET_TYPES, type Settings } from "./settings.ts";

const KEYS: [KeyId, Key][] = [["up", "up"], ["down", "down"], ["return", "enter"], ["escape", "esc"]];
const CHARS: Key[] = ["a", "d", "[", "]", "c", "t", "r", "s"];
const HINTS: Record<EditorState["view"], string> = {
  lines: "↑↓ select · enter edit line · a add line · d delete · r reset · s save · esc cancel",
  widgets: "↑↓ select · a add · d delete · [ ] move · c color · t text · esc back",
  addWidget: "↑↓ choose widget · enter add · esc back",
  color: "↑↓ choose color · enter set · esc back",
  text: "type text · enter set · esc back",
};

/** Interactive editor. Resolves to the edited settings on save, undefined on cancel. */
export function openEditor(ctx: ExtensionCommandContext, current: Settings, preview: (s: Settings, width: number) => string[]): Promise<Settings | undefined> {
  return ctx.ui.custom<Settings | undefined>((tui, theme, _kb, done) => {
    let state = initialState(current);
    let picker: SelectList | undefined;
    let input: Input | undefined;
    let focused = false;

    const redraw = () => tui.requestRender();
    const apply = (key: Key, pick?: string) => {
      const r = reduce(state, key, pick);
      if (r === "save") return done(state.settings);
      if (r === "cancel") return done(undefined);
      const entering = r.view !== state.view;
      state = r;
      picker = input = undefined;
      if (entering && (state.view === "addWidget" || state.view === "color")) {
        const values = state.view === "addWidget" ? [...WIDGET_TYPES] : [...COLORS, "(none)"];
        picker = new SelectList(values.map((v) => ({ value: v, label: v })), 8, getSelectListTheme());
        picker.onSelect = (item) => { apply("enter", item.value); redraw(); };
        picker.onCancel = () => { apply("esc"); redraw(); };
      } else if (entering && state.view === "text") {
        input = new Input({ prompt: "text: " });
        input.setValue(state.settings.lines[state.line][state.widget].text ?? "");
        input.focused = focused;
        input.onSubmit = (v) => { apply("enter", v); redraw(); };
        input.onEscape = () => { apply("esc"); redraw(); };
      }
    };

    const list = (width: number): string[] => {
      const out: string[] = [];
      if (state.view === "lines" || state.view === "widgets") {
        state.settings.lines.forEach((line, i) => {
          const sel = i === state.line;
          const mark = sel && state.view === "lines" ? theme.fg("accent", "› ") : "  ";
          out.push(`${mark}${theme.fg(sel ? "text" : "dim", `Line ${i + 1}`)}  ${theme.fg("muted", line.map((w) => w.type).join(" ") || "(empty)")}`);
          if (sel && state.view === "widgets") {
            line.forEach((w, j) => {
              const cur = j === state.widget;
              const detail = [w.color && `color: ${w.color}`, w.type === "text" && `"${w.text ?? ""}"`].filter(Boolean).join(", ");
              out.push(`    ${cur ? theme.fg("accent", "› ") : "  "}${theme.fg(cur ? "text" : "dim", w.type)}${detail ? theme.fg("muted", `  ${detail}`) : ""}`);
            });
            if (!line.length) out.push(theme.fg("dim", "      (empty — press a to add a widget)"));
          }
        });
        if (!state.settings.lines.length) out.push(theme.fg("dim", "  (no lines — press a to add one)"));
      }
      if (picker) out.push("", ...picker.render(width));
      if (input) out.push("", ...input.render(width));
      return out;
    };

    const component: Component & Focusable & { dispose(): void } = {
      get focused() { return focused; },
      set focused(v: boolean) { focused = v; if (input) input.focused = v; },
      invalidate() { picker?.invalidate(); },
      dispose() { done(undefined); }, // settles the command if pi tears the screen down externally
      render(width: number): string[] {
        const border = new DynamicBorder((s: string) => theme.fg("accent", s)).render(width);
        const lines = [
          ...border,
          theme.fg("accent", theme.bold(" pi-usage-footer") + (state.dirty ? " *" : "")),
          "",
          theme.fg("dim", " Preview"),
          ...preview(state.settings, width - 2).map((l) => " " + l),
          "",
          ...list(width),
          "",
          theme.fg("dim", " " + HINTS[state.view]),
          ...border,
        ];
        return lines.map((l) => truncateToWidth(l, width));
      },
      handleInput(data: string) {
        if (input) input.handleInput(data);
        else if (picker) picker.handleInput(data);
        else {
          const hit = KEYS.find(([k]) => matchesKey(data, k));
          if (hit) apply(hit[1]);
          else {
            const ch = CHARS.find((c) => matchesKey(data, c as KeyId));
            if (!ch) return;
            apply(ch);
          }
        }
        redraw();
      },
    };
    return component;
  });
}
