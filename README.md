# pi-usage-footer

Replaces pi's footer with a configurable multi-line statusline, in the spirit of
[ccstatusline](https://github.com/sirmalloc/ccstatusline).

```text
Sonnet 5.5 | high | Context: ░░░░░░░░░░ 0/1.0M (0%)
cwd: ~/vini-projects/pi-usage-footer | ⎇ main
5hr block: ██░░░░░░░░ 25.0% | 4hr 48m
1w block:  ████░░░░░░ 40.0% | 3d 3hr 8m
```

## Install

Requires Node 24+, macOS, a current pi.

```sh
pi install /Users/viniyoon/vini-projects/pi-usage-footer
```

Then `/reload`. If you also run `pi-claude-usage`, remove it (`pi remove ~/.pi/local-extension/pi-claude-usage`); this package replaces it.

## Widgets

`model`, `thinking`, `context`, `cwd`, `git`, `block5h`, `block1w`, `sessionId`, `elapsed`, `statuses` (other extensions' footer statuses, e.g. ponytail), `text` (your own string), `separator`.
A line is hidden when none of its widgets has anything to show, so usage lines vanish on unsupported providers.

## Configure: `/pi-usage-footer`

| View | Keys |
|---|---|
| Lines | `↑↓` select · `enter` edit line · `a` add line · `d` delete · `r` reset · `s` save · `esc` cancel |
| Widgets | `↑↓` select · `a` add · `d` delete · `[` `]` move · `c` color · `t` text · `esc` back |

Saved to `~/.pi/agent/pi-usage-footer.json`. Hand edits are fine; invalid entries are dropped on load.
`/pi-usage-footer refresh` refetches usage immediately.

## Usage blocks

| Provider | Source |
|---|---|
| `claude-code` | macOS Keychain item `Claude Code-credentials` → `api.anthropic.com/api/oauth/usage` (same as pi-claude-usage) |
| `openai` | `chatgpt.com/backend-api/wham/usage` using the **`openai-codex`** login (`/login` → ChatGPT Codex). The `openai` login itself is rejected by that API. |

Other providers show no usage lines. Fetched at startup, every 5 minutes, and at turn start when stale; the countdown repaints every minute.

Caveats:
- Both endpoints are private and may change. Failures show `unavailable`.
- For `openai` models the numbers are the Codex account's. Whether `openai` requests draw from the same quota is **unverified**.
- Tokens are never stored, logged, or refreshed by this extension; the Codex token comes from pi's model registry.

## Develop

```sh
ln -s <global node_modules>/@earendil-works node_modules/@earendil-works   # so node --test can resolve pi packages
npm test
```
