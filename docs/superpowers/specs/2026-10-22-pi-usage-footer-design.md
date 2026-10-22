# pi-usage-footer — Design

## Intent
Replace pi's footer with a multi-line, configurable statusline (in the spirit of
[ccstatusline](https://github.com/sirmalloc/ccstatusline)) that shows model, context,
cwd, git and — for subscription providers — 5-hour and weekly usage blocks.
The user wants to see subscription headroom at a glance while working.

Reference look (default layout):
```
Sonnet 5.5: high | Context: ███████░░░ 0/1.0M (0%)
cwd: ~/vini-projects/pi-usage-footer | ⎇ no git
5hr block: ██████░░░░ 0.0% | 4hr 48m
1w block:  ██████░░░░ 1.0% | 3d 3hr 8m
```

## Goals
- Override pi's footer via `ctx.ui.setFooter` (TUI mode only).
- Configurable lines; each line is an ordered list of widgets; per-widget text color.
- Interactive editor via `/pi-usage-footer`; settings saved to local JSON.
- Usage blocks for `claude-code` and `openai` providers.
- Absorb `~/.pi/local-extension/pi-claude-usage` (remove it after this ships).

## Non-goals
- Powerline style, background colors (explicitly dropped by user).
- Usage for any other provider (lines for usage widgets hidden).
- Non-TUI modes (print/json/rpc): no footer, no fetches, no timers.

## Anti-goals
- Never print, log, store, or commit tokens.
- Never refresh/rotate tokens ourselves (could break pi's stored login).
- Never send a token anywhere but its usage endpoint.

## Constraints
- Node 24+, run `*.ts` directly (same as pi-claude-usage); no new dependencies.
  Use only `@earendil-works/pi-coding-agent` / `pi-tui` APIs (peer deps).
- macOS (Claude token is read from Keychain).
- Usage APIs are private and may change; failures must degrade to a short "unavailable" text.

## Approaches considered

### Usage source for `openai`
- **A. Response headers** (`after_provider_response`) — rejected: spike showed the `openai`
  provider (`api.openai.com/v1/responses` with ChatGPT OAuth) returns no usage headers or
  stream events.
- **B. `wham/usage` with the `openai` token** — rejected: 401 `rejected_by_access_enforcement`.
- **C. pi-usage method (chosen by user):** `GET https://chatgpt.com/backend-api/wham/usage`
  with the **`openai-codex`** OAuth token (kept logged in solely for this), headers
  `Authorization: Bearer`, `Accept: application/json`, `User-Agent: codex-cli`,
  `ChatGPT-Account-Id: <accountId>`. Spike: 200 with
  `rate_limit.primary_window` (5h) / `secondary_window` (weekly):
  `used_percent`, `reset_at` (epoch s), `reset_after_seconds`.
  - Deviation from pi-usage: get the token via
    `ctx.modelRegistry.getApiKeyForProvider("openai-codex")` (pi refreshes and persists),
    not a hand-rolled refresh. `accountId` read from `~/.pi/agent/auth.json`
    `openai-codex.accountId` (non-secret).
  - Unverified: whether `openai` provider requests draw from the same quota.

### Usage source for `claude-code`
Reuse pi-claude-usage `usage.ts` as-is (Keychain `Claude Code-credentials` →
`GET https://api.anthropic.com/api/oauth/usage`), including its config-dir guard.

### Settings UI
- **A. Compose pi-tui built-ins inside `ctx.ui.custom()` (chosen).** `SelectList` + `Input`,
  pi theme and keybindings.
- B. One hand-rolled component handling all keys — rejected: more code, more bugs.

## Decided design

### Widgets
| id | renders | notes |
|---|---|---|
| `model` | `ctx.model.name` | |
| `thinking` | thinking level | hidden if model has no reasoning |
| `context` | `Context: <bar> used/window (pct%)` | `ctx.getContextUsage()` |
| `cwd` | `cwd: ~/…` | home → `~` |
| `git` | `⎇ <branch>` / `⎇ no git` | `footerData.getGitBranch()`, re-render on change |
| `block5h` | `5hr block: <bar> x.x% \| 4hr 48m` | usage providers only |
| `block1w` | `1w block: <bar> x.x% \| 3d 3hr 8m` | usage providers only |
| `sessionId`, `elapsed` | session id, time since session start | not in default layout |
| `text` | user-typed literal | |
| `separator` | ` \| ` | |

A line whose non-separator widgets all render empty is omitted (so usage lines
disappear for other providers). Lines are truncated to terminal width.

Usage states: loading → `…`; failed → `unavailable`; reset passed → `waiting for reset`.

### Polling
Same as pi-claude-usage, generalized per provider: fetch on session start / model switch
when provider ∈ {claude-code, openai}; every 5 min; on `turn_start` if stale (>5 min,
30 s after failure); repaint every 60 s with no fetch; abort in-flight on switch/shutdown.
`/pi-usage-footer refresh` forces a fetch.

### Settings
File: `~/.pi/agent/pi-usage-footer.json`
```json
{ "lines": [[{ "type": "model", "color": "accent" }, { "type": "separator" }, …], …] }
```
Colors are pi theme color names (`theme.fg(name, text)`). Missing/invalid file → defaults
(image layout); invalid entries are dropped, not fatal. Written only from the editor.

### Editor (`/pi-usage-footer`)
`ctx.ui.custom()` screen: live preview at top, then:
- Lines list: `↑↓` select, `enter` edit line, `a` add line, `d` delete line.
- Line's widgets: `↑↓` select, `a` add (pick from widget list), `d` delete,
  `[`/`]` move, `c` pick color, `t` edit text (for `text`), `esc` back.
- Top level: `s` save & close, `r` reset to defaults, `esc` cancel without saving.

## Left to the builder
- Exact bar width/characters and default colors (match the image as closely as theme allows).
- File split, as long as it stays small (e.g. `extension.ts`, `widgets.ts`, `usage-claude.ts`,
  `usage-codex.ts`, `settings.ts`, `editor.ts`).
- Tests: parsers, formatters, settings validation, line-omission rule; mocked fetch/exec only.
