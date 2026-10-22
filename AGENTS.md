# AGENTS.md

Pi extension: configurable multi-line footer with Claude Code / OpenAI usage blocks.

- `extension.ts` wiring + polling, `render.ts` widgets, `settings.ts` JSON config, `editor.ts` `/pi-usage-footer` UI, `usage.ts` Claude fetch, `codex.ts` Codex fetch.
- Test: `npm test` (Node 24+). Tests use synthetic tokens and mocked fetch/execFile only.
- Never log, store, or commit credentials. Claude token only to api.anthropic.com, Codex token only to chatgpt.com/backend-api/wham/usage.
- No new dependencies.
