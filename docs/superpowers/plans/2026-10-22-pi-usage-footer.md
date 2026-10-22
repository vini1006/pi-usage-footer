# pi-usage-footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pi extension that replaces the footer with a configurable multi-line statusline (model, context, cwd, git, 5h/1w usage blocks) and an interactive `/pi-usage-footer` editor.

**Architecture:** Pure modules (settings, widgets/render, usage parsers/formatters) are unit-tested with `node --test`; `extension.ts` wires pi events, polling and `ctx.ui.setFooter`; `editor.ts` is a `ctx.ui.custom()` component built from pi-tui `SelectList`/`Input`.

**Tech Stack:** TypeScript run directly by Node 24 (`node --test *.test.ts`), `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui` (peer deps, no installs).

**Spec:** `docs/superpowers/specs/2026-10-22-pi-usage-footer-design.md`

## Global Constraints
- Node >= 24, no new dependencies; only Node builtins and pi peer packages.
- TUI mode only (`ctx.mode === "tui"`); other modes: no footer, no fetch, no timers.
- Usage providers: `claude-code` (Claude API) and `openai` (Codex API via `openai-codex` token). All others: usage widgets render `""`.
- Never log/store/commit tokens; Claude token only to `https://api.anthropic.com/api/oauth/usage`; Codex token only to `https://chatgpt.com/backend-api/wham/usage`; `redirect: "error"`; 10 s timeout.
- Never refresh tokens ourselves; Codex token via `ctx.modelRegistry.getApiKeyForProvider("openai-codex")`.
- Settings file: `~/.pi/agent/pi-usage-footer.json` (use `getAgentDir()` from pi-coding-agent).
- Status copy (English): loading `…`, failure `unavailable`, reset passed `waiting for reset`.
- Tests use synthetic tokens and mocked `fetch`/`execFile` only.

## Review Focus
- Terminal narrower than a line → every footer line must be `truncateToWidth`'d (Task 3 test: width 20).
- Corrupt / hand-edited settings JSON (bad JSON, unknown widget type, unknown color, empty lines) → fall back / drop entries, never throw (Task 1 tests).
- Context unknown right after compaction (`tokens: null`) → `Context: ? /1.0M` not `NaN` (Task 3 test).
- Codex 401 or no `openai-codex` login → `unavailable`, no throw, no token in error text (Task 2 test).
- Switching provider mid-fetch → stale result must not overwrite new provider's state (Task 4 test with a deferred fetch).

---

### Task 1: Package scaffold + settings

**Files:**
- Create: `package.json`, `.gitignore`, `AGENTS.md`, `settings.ts`, `settings.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type WidgetType = "model"|"thinking"|"context"|"cwd"|"git"|"block5h"|"block1w"|"sessionId"|"elapsed"|"text"|"separator";
  export const WIDGET_TYPES: readonly WidgetType[];
  export const COLORS: readonly string[]; // ["accent","text","muted","dim","success","warning","error","borderAccent","mdLink","mdCode","syntaxKeyword","syntaxString","syntaxNumber","syntaxType"]
  export type Widget = { type: WidgetType; color?: string; text?: string };
  export type Settings = { lines: Widget[][] };
  export const DEFAULT_SETTINGS: Settings;
  export function normalizeSettings(raw: unknown): Settings;
  export function loadSettings(path?: string): Settings;   // default path SETTINGS_PATH
  export function saveSettings(s: Settings, path?: string): void;
  export const SETTINGS_PATH: string;
  ```
- `DEFAULT_SETTINGS.lines` (image layout):
  1. `model`(accent) `separator` `thinking`(muted) `separator` `context`(mdLink)
  2. `cwd`(mdLink) `separator` `git`(muted)
  3. `block5h`(syntaxType)
  4. `block1w`(syntaxType)

- [ ] **Step 1:** `package.json` mirroring `~/.pi/local-extension/pi-claude-usage/package.json` (name `pi-usage-footer`, `"pi": {"extensions": ["./extension.ts"]}`, test script `node --test *.test.ts`, peerDeps `pi-coding-agent` and `pi-tui` `*`). `.gitignore`: `node_modules`. `AGENTS.md`: 6 lines on files, test command, token rules.
- [ ] **Step 2: Failing tests** `settings.test.ts`:
  - `normalizeSettings(undefined)` deep-equals `DEFAULT_SETTINGS`; `normalizeSettings("x")` too.
  - unknown widget type dropped; unknown color → `color` removed; `text` widget keeps `text` (string only, max 200 chars).
  - `{lines: []}` → `{lines: []}` (user may empty it; not defaults).
  - non-array line dropped.
  - `loadSettings(tmp)` on missing file and on `"{bad"` → `DEFAULT_SETTINGS`; `saveSettings` then `loadSettings` round-trips; `saveSettings` creates the parent dir.
- [ ] **Step 3:** Run `npm test` → FAIL.
- [ ] **Step 4:** Implement `settings.ts` (`fs.mkdirSync(recursive)`, write JSON with 2-space indent).
- [ ] **Step 5:** `npm test` → PASS. Commit `feat: settings`.

### Task 2: Usage providers (Claude + Codex)

**Files:**
- Create: `usage.ts` (copy of `~/.pi/local-extension/pi-claude-usage/usage.ts` minus `formatUsage`), `usage.test.ts` (port that repo's `usage.test.ts` + `usage-io.test.ts`, dropping `formatUsage` cases), `codex.ts`, `codex.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // usage.ts (unchanged from source)
  export type UsageWindow = { used: number; resetsAt: number }; // used 0..100, resetsAt epoch ms
  export type Usage = { fiveHour?: UsageWindow; sevenDay?: UsageWindow };
  export function readClaudeToken(signal?, env?): Promise<string>;
  export function fetchUsage(token: string, signal?): Promise<Usage>; // Claude
  // codex.ts
  export function parseCodexUsage(json: unknown): Usage;
  export function fetchCodexUsage(token: string, accountId: string | undefined, signal?: AbortSignal): Promise<Usage>;
  export function readCodexAccountId(authPath?: string): string | undefined; // ~/.pi/agent/auth.json["openai-codex"].accountId
  ```
- Codex request: `GET https://chatgpt.com/backend-api/wham/usage`, headers `Authorization: Bearer <t>`, `Accept: application/json`, `User-Agent: codex-cli`, `ChatGPT-Account-Id` when present; `redirect: "error"`; `AbortSignal.any([signal, AbortSignal.timeout(10_000)])`.
- Mapping: `rate_limit.primary_window` → `fiveHour`, `secondary_window` → `sevenDay`; `used = used_percent`, `resetsAt = reset_at * 1000`. Window invalid if `used_percent` not finite 0..100 or `reset_at` not finite number. Both missing → throw `Invalid usage response`.

- [ ] **Step 1: Failing tests** `codex.test.ts`:
  - parse of spike payload `{rate_limit:{primary_window:{used_percent:0,reset_at:1792692397},secondary_window:{used_percent:5,reset_at:1793108960}}}` → `{fiveHour:{used:0,resetsAt:1792692397000},sevenDay:{used:5,resetsAt:1793108960000}}`.
  - parse `{}` throws; `used_percent: 150` throws.
  - `fetchCodexUsage` with mocked `globalThis.fetch`: asserts URL, the 4 headers, `redirect: "error"`; 401 → rejects with message not containing the token (`"tok-SYNTHETIC"`).
  - `readCodexAccountId` on a temp file with/without the entry.
- [ ] **Step 2:** Port Claude tests into `usage.test.ts`; run `npm test` → codex FAIL, usage PASS.
- [ ] **Step 3:** Implement `codex.ts`.
- [ ] **Step 4:** `npm test` → PASS. Commit `feat: claude and codex usage fetchers`.

### Task 3: Widget rendering

**Files:**
- Create: `render.ts`, `render.test.ts`

**Interfaces:**
- Consumes: `Settings`, `Widget`, `Usage`, `UsageWindow`.
- Produces:
  ```ts
  export type UsageState = { status: "none" } | { status: "loading" } | { status: "failed" } | { status: "ok"; usage: Usage };
  export type FooterInput = {
    modelName?: string; thinking?: string;               // thinking undefined when model has no reasoning
    context?: { tokens: number | null; contextWindow: number; percent: number | null };
    cwd: string; home: string; branch?: string | null;
    sessionId?: string; startedAt?: number; now: number;
    usage: UsageState;
  };
  export type Paint = (color: string | undefined, text: string) => string; // wraps theme.fg; identity in tests
  export function renderWidget(w: Widget, input: FooterInput): string;    // plain text, "" = hidden
  export function renderLines(s: Settings, input: FooterInput, width: number, paint: Paint): string[];
  export function bar(pct: number, width?: number): string;               // default width 10, "█"/"░"
  export function formatDuration(ms: number): string;                     // "3d 3hr 8m", "4hr 48m", "5m", "<1m"
  export function formatTokens(n: number): string;                       // 999 → "999", 1500 → "1.5k", 1_000_000 → "1.0M"
  ```
- Widget text (exact):
  - `model` → name; `thinking` → level; `cwd` → `cwd: ` + path with `home` → `~`
  - `context` → `Context: ${bar(pct)} ${tok}/${win} (${pct}%)`; tokens null → `Context: ${bar(0)} ?/${win}`; no context → `""`
  - `git` → `⎇ ${branch}` or `⎇ no git`
  - `block5h`/`block1w` → `5hr block: ` / `1w block: ` + `${bar(used)} ${used.toFixed(1)}% | ${formatDuration(resetsAt-now)}`; reset passed → `… | waiting for reset`; status `loading` → `5hr block: …`; `failed` → `5hr block: unavailable`; `none` or window missing → `""`
  - `sessionId` → id; `elapsed` → `formatDuration(now-startedAt)`; `text` → `w.text ?? ""`; `separator` → ` | `
- Line assembly: drop separators that end up leading, trailing or doubled after empty widgets are removed; a line with no non-empty non-separator widget is omitted; each line `truncateToWidth(line, width)`.

- [ ] **Step 1: Failing tests** `render.test.ts` (paint = identity):
  - default settings, claude ok usage `{fiveHour:{used:0,resetsAt:now+(4*60+48)*60e3}}`, context `{tokens:0,contextWindow:1_000_000,percent:0}` → line 1 `Sonnet 5.5 | high | Context: ░░░░░░░░░░ 0/1.0M (0%)`, line 3 `5hr block: ░░░░░░░░░░ 0.0% | 4hr 48m`, `sevenDay` missing → no line 4 (3 lines total).
  - usage `none` → exactly 2 lines.
  - `branch: null` → contains `⎇ no git`; cwd under home → `cwd: ~/x`.
  - `thinking: undefined` → line 1 is `Sonnet 5.5 | Context: …` (no `| |`).
  - tokens null → `?/1.0M`, no `NaN`.
  - width 20 → every line `visibleWidth <= 20`.
  - `formatDuration(3*864e5+3*36e5+8*6e4)` = `3d 3hr 8m`; `formatDuration(30e3)` = `<1m`; `bar(50)` = `█████░░░░░`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement `render.ts` (import `truncateToWidth` from `@earendil-works/pi-tui`).
- [ ] **Step 4:** `npm test` → PASS. Commit `feat: widget rendering`.

### Task 4: Extension wiring (footer + polling)

**Files:**
- Create: `extension.ts`, `extension.test.ts` (port structure of `pi-claude-usage/extension.test.ts`: fake `pi`/`ctx`, fake timers via `t.mock.timers`)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: default export `(pi: ExtensionAPI) => void`; internal `getFooterInput(ctx, footerData): FooterInput`; exported for editor: `openEditor` is in Task 5, and extension calls `reinstallFooter()` after save.
- Behaviour:
  - `session_start`: if TUI, `loadSettings()`, `ctx.ui.setFooter(factory)`; factory subscribes `footerData.onBranchChange` → `tui.requestRender()`; `render(width)` = `renderLines(settings, getFooterInput(...), width, (c,t) => c ? theme.fg(c,t) : t)`; `dispose` unsubscribes.
  - usage polling = pi-claude-usage `start/stop/refresh` generalized: provider `claude-code` → `readClaudeToken` + `fetchUsage`; provider `openai` → `getApiKeyForProvider("openai-codex")` (missing → failed) + `readCodexAccountId()` + `fetchCodexUsage`; else state `none`, no timers. Intervals: poll 300 000 ms, repaint 60 000 ms (calls `tui.requestRender()`), `turn_start` stale check 300 000 / 30 000 after failure. `model_select` → restart; `session_shutdown` → stop, abort in-flight.
  - Stale guard: a finished fetch whose state object is no longer current is ignored.
- [ ] **Step 1: Failing tests** `extension.test.ts`:
  - non-TUI mode: `setFooter` never called, `fetch` never called.
  - TUI + `claude-code`: `setFooter` called once; rendered lines include `5hr block:` after fetch resolves.
  - TUI + `anthropic`: rendered output has no `block` line, no fetch.
  - `openai` with `getApiKeyForProvider` → `undefined`: renders `5hr block: unavailable`.
  - provider switch mid-fetch (deferred Claude fetch, then `model_select` to `anthropic`, then resolve) → still no block line.
  - `session_shutdown` clears intervals (no fetch after advancing 600 000 ms).
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement `extension.ts`.
- [ ] **Step 4:** `npm test` → PASS. Commit `feat: footer extension wiring`.

### Task 5: Interactive editor `/pi-usage-footer`

**Files:**
- Create: `editor.ts`, `editor.test.ts`
- Modify: `extension.ts` (register command)

**Interfaces:**
- Consumes: `Settings`, `WIDGET_TYPES`, `COLORS`, `DEFAULT_SETTINGS`, `renderLines`, `saveSettings`.
- Produces:
  ```ts
  // pure state machine, unit-tested without a TUI
  export type EditorState = { settings: Settings; view: "lines" | "widgets" | "addWidget" | "color" | "text"; line: number; widget: number; dirty: boolean };
  export function reduce(s: EditorState, key: "up"|"down"|"enter"|"esc"|"a"|"d"|"["|"]"|"c"|"t"|"r", pick?: string): EditorState | "save" | "cancel";
  export function openEditor(ctx: ExtensionCommandContext, current: Settings, preview: (s: Settings, width: number) => string[]): Promise<Settings | undefined>;
  ```
- Keys (spec): lines view `↑↓` select, `enter` → widgets, `a` add empty line, `d` delete line, `r` reset to defaults, `s` → `"save"`, `esc` → `"cancel"`. Widgets view `↑↓`, `a` → addWidget picker (SelectList of `WIDGET_TYPES`, enter appends after selection), `d` delete, `[`/`]` move left/right, `c` → color picker (SelectList of `COLORS` + `"(none)"`), `t` → text input (only on `text` widget; pi-tui `Input`, propagate `focused`), `esc` → lines view.
- Rendering: `DynamicBorder`, title `pi-usage-footer`, live preview = `preview(state.settings, width)`, then the current list, then a dim key-hint line. Pickers use `getSelectListTheme()`.
- Command: `pi.registerCommand("pi-usage-footer", …)`: args `refresh` → force usage refresh + notify; otherwise TUI-only, `openEditor`, on result `saveSettings` + update in-memory settings + re-render + notify `Saved to <path>`.
- [ ] **Step 1: Failing tests** `editor.test.ts` on `reduce`:
  - lines view `a` adds `[]` line and selects it; `d` removes; `r` equals defaults and `dirty`.
  - widgets view `]` on index 0 swaps with 1; `[` on index 0 is a no-op.
  - `addWidget` with pick `"git"` inserts after current widget.
  - `color` with pick `"(none)"` deletes `color`.
  - `t` on non-`text` widget is a no-op.
  - `esc` in lines view → `"cancel"`; `s` → `"save"`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement `reduce`, then `openEditor` UI around it (`ctx.ui.custom`), then register the command.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Manual check:** `pi install /Users/viniyoon/vini-projects/pi-usage-footer`, `/reload`; with `claude-code` model see 4 lines; with `openai` model see 4 lines (or `unavailable` if not logged into openai-codex); `/pi-usage-footer`: add a `text` widget, color it, save, confirm `~/.pi/agent/pi-usage-footer.json` and footer update. Commit `feat: interactive footer editor`.

### Task 6: README + retire pi-claude-usage

**Files:**
- Create: `README.md`
- External: `pi remove ~/.pi/local-extension/pi-claude-usage` (settings.json `packages` entry)

- [ ] **Step 1:** README: what it shows, install, `/pi-usage-footer` keys, settings file, provider support, `openai-codex` login requirement and the unverified quota-sharing caveat, token handling.
- [ ] **Step 2:** Ask user before removing `pi-claude-usage`; then `pi remove …`, `/reload`, confirm footer still shows Claude usage.
- [ ] **Step 3:** `npm test` → PASS. Commit `docs: readme`.
