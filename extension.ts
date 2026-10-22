import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { fetchCodexUsage, readCodexAccountId } from "./codex.ts";
import { openEditor } from "./editor.ts";
import { renderLines, type FooterInput, type UsageState } from "./render.ts";
import { loadSettings, saveSettings, SETTINGS_PATH, type Settings } from "./settings.ts";
import { fetchUsage, readClaudeToken, type Usage } from "./usage.ts";

type Model = NonNullable<ExtensionContext["model"]>;
type State = { ctx: ExtensionContext; model: Model; usage: UsageState; failed: boolean; fetchedAt?: number };

const POLL_MS = 300_000;
const REPAINT_MS = 60_000;
const FAILURE_BACKOFF_MS = 30_000;
// Sample data so usage widgets are visible in the editor preview even on providers without usage.
const previewUsage = (): UsageState => ({ status: "ok", usage: { fiveHour: { used: 25, resetsAt: Date.now() + 3 * 3_600_000 }, sevenDay: { used: 40, resetsAt: Date.now() + 3 * 86_400_000 } } });
const hasUsage = (provider?: string) => provider === "claude-code" || provider === "openai";

export default function (pi: ExtensionAPI) {
  let settings: Settings = loadSettings();
  let current: State | undefined;
  let pending: { controller: AbortController; promise: Promise<void> } | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let repaint: ReturnType<typeof setInterval> | undefined;
  let requestRender: (() => void) | undefined;
  let ctxNow: ExtensionContext | undefined;
  let model: Model | undefined;

  async function loadUsage(state: State, signal: AbortSignal): Promise<Usage> {
    if (state.model.provider === "claude-code") {
      const auth = await state.ctx.modelRegistry.getApiKeyAndHeaders(state.model);
      signal.throwIfAborted();
      if (!auth.ok) throw new Error("Claude Code configuration unavailable");
      const token = await readClaudeToken(signal, { ...process.env, ...auth.env });
      signal.throwIfAborted();
      return fetchUsage(token, signal);
    }
    // openai: ChatGPT usage is only reachable with the openai-codex login (token refresh is pi's job).
    const token = await state.ctx.modelRegistry.getApiKeyForProvider("openai-codex");
    signal.throwIfAborted();
    if (!token) throw new Error("openai-codex login missing");
    return fetchCodexUsage(token, readCodexAccountId(), signal);
  }

  function refresh(): Promise<void> {
    if (!current) return Promise.resolve();
    if (pending) return pending.promise;
    const state = current;
    state.fetchedAt = Date.now();
    const controller = new AbortController();
    const promise = Promise.resolve().then(async () => {
      try {
        const usage = await loadUsage(state, controller.signal);
        if (current !== state) return;
        state.usage = { status: "ok", usage };
        state.failed = false;
      } catch {
        if (current !== state) return;
        state.usage = { status: "failed" };
        state.failed = true;
      } finally {
        if (pending?.controller === controller) pending = undefined;
      }
      requestRender?.();
    });
    pending = { controller, promise };
    return promise;
  }

  function stop() {
    if (poll) clearInterval(poll);
    if (repaint) clearInterval(repaint);
    poll = repaint = undefined;
    pending?.controller.abort();
    pending = undefined;
    current = undefined;
  }

  function start(ctx: ExtensionContext, next = ctx.model) {
    stop();
    ctxNow = ctx;
    model = next;
    if (ctx.mode !== "tui" || !next || !hasUsage(next.provider)) return;
    current = { ctx, model: next, usage: { status: "loading" }, failed: false };
    poll = setInterval(() => { void refresh(); }, POLL_MS);
    repaint = setInterval(() => requestRender?.(), REPAINT_MS);
    poll.unref();
    repaint.unref();
    void refresh();
  }

  function input(branch: string | null, statuses?: ReadonlyMap<string, string>): FooterInput {
    const ctx = ctxNow!;
    const contextUsage = ctx.getContextUsage();
    return {
      modelName: model?.name ?? model?.id,
      thinking: model?.reasoning ? pi.getThinkingLevel() : undefined,
      context: contextUsage ?? undefined,
      cwd: ctx.cwd,
      home: homedir(),
      branch,
      sessionId: ctx.sessionManager.getSessionId(),
      startedAt: Date.parse(ctx.sessionManager.getHeader()?.timestamp ?? "") || undefined,
      now: Date.now(),
      usage: current?.usage ?? { status: "none" },
      statuses,
    };
  }

  function installFooter(ctx: ExtensionContext) {
    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
      return {
        invalidate() {},
        render: (width: number) => renderLines(settings, input(footerData.getGitBranch(), footerData.getExtensionStatuses()), width, (c, t) => (c ? theme.fg(c as never, t) : t)),
        dispose() {
          unsubscribe();
          requestRender = undefined;
        },
      };
    });
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    settings = loadSettings();
    installFooter(ctx);
    start(ctx);
  });
  pi.on("turn_start", (_event, ctx) => {
    ctxNow = ctx;
    if (!current || ctx.model?.provider !== current.model.provider) return;
    current.ctx = ctx;
    if (Date.now() - (current.fetchedAt ?? 0) >= (current.failed ? FAILURE_BACKOFF_MS : POLL_MS)) void refresh();
  });
  pi.on("model_select", (event, ctx) => {
    if (ctx.mode !== "tui") return;
    start(ctx, event.model);
    requestRender?.();
  });
  pi.on("session_shutdown", () => stop());

  pi.registerCommand("pi-usage-footer", {
    description: "Edit the footer layout (or `refresh` to refetch usage)",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/pi-usage-footer requires interactive mode", "warning");
        return;
      }
      if (args.trim() === "refresh") {
        if (!current) { ctx.ui.notify("No usage for the current provider", "info"); return; }
        const state = current;
        state.fetchedAt = undefined;
        await refresh();
        if (current !== state) return; // session/model changed meanwhile; ctx may be stale
        ctx.ui.notify(state.usage.status === "ok" ? "Usage refreshed" : "Usage unavailable", state.usage.status === "ok" ? "info" : "warning");
        return;
      }
      const edited = await openEditor(ctx, settings, (s, width) => renderLines(s, { ...input(null), usage: current?.usage ?? previewUsage() }, width, (_c, t) => t));
      if (!edited) return;
      try {
        saveSettings(edited);
      } catch (e) {
        ctx.ui.notify(`Could not save ${SETTINGS_PATH}: ${(e as Error).message}`, "error");
        return;
      }
      settings = edited;
      requestRender?.();
      ctx.ui.notify(`Saved to ${SETTINGS_PATH}`, "info");
    },
  });
}
