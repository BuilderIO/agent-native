import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  findRunsThatBecameUnread,
  getCodeAgentPickerOptions,
  getCodeAgentSelection,
  groupCodeAgentModelOptions,
  normalizeModelSelection,
  resolveNewSessionExtensionComposerState,
  shouldCloseWatchedChatFirstSession,
  type CodeAgentsNewSessionExtension,
} from "./CodeAgentsApp.js";
import {
  mergeSessionWatchTranscriptEvents,
  SESSION_WATCH_TRANSCRIPT_EVENT_LIMIT,
} from "./SessionWatchPanel.js";
import type { CodeAgentModelOption } from "./types.js";
import type { CodeAgentRun } from "./types.js";
import type { CodeAgentTranscriptEvent } from "./types.js";

const extension: CodeAgentsNewSessionExtension = {
  active: true,
  async submit() {
    return { ok: true };
  },
};

describe("CodeAgentsApp new-session extension seam", () => {
  it("hands an active extension the existing composer without showing a second model selector", () => {
    expect(resolveNewSessionExtensionComposerState(extension)).toEqual({
      active: true,
      useDefaultModeControl: false,
      showModelSelector: false,
    });
  });

  it("keeps the standard composer available when no extension is installed", () => {
    expect(resolveNewSessionExtensionComposerState()).toEqual({
      active: false,
      useDefaultModeControl: true,
      showModelSelector: true,
    });
  });
});

describe("CodeAgentsApp full-page chat width", () => {
  it("keeps the empty and loading chat rails on the shared wide max", () => {
    const css = readFileSync("src/styles.css", "utf8");

    expect(css).toContain("--code-agents-chat-max: 750px;");
    expect(css).toMatch(
      /\.code-agents-start\s*\{[\s\S]*?max-width: var\(--code-agents-chat-max\);/,
    );
    expect(css).toMatch(
      /\.code-agents-overview-skeleton\s*\{[\s\S]*?max-width: var\(--code-agents-chat-max\);/,
    );
    expect(css).toMatch(
      /\.code-agents-project-picker--bar\s*\{[\s\S]*?width: min\(100%, var\(--code-agents-chat-max\)\);/,
    );
    expect(css).toMatch(
      /\.code-agents-project-picker--bar\s*\{[\s\S]*?margin-top: 8px;/,
    );
    expect(css).toMatch(
      /\.code-agents-project-picker--bar \.code-agents-project-select\s*\{[\s\S]*?flex: 0 1 auto;/,
    );
  });
});

describe("CodeAgentsApp chat-first rail scrolling", () => {
  it("keeps navigation, apps, and chats in one scroll body above the footer", () => {
    const source = readFileSync("src/CodeAgentsApp.tsx", "utf8");
    const css = readFileSync("src/styles.css", "utf8");

    expect(source).toContain('className="code-agents-rail-scroll"');
    expect(source).toContain('className="code-agents-rail-footer"');
    expect(css).toMatch(
      /\.code-agents-rail-scroll\s*\{[\s\S]*?overflow-y: auto;/,
    );
  });
});

describe("CodeAgentsApp transcript selection", () => {
  it("does not let an older transcript read replace a newly selected chat", () => {
    const source = readFileSync("src/CodeAgentsApp.tsx", "utf8");
    const loadTranscriptStart = source.indexOf("const loadTranscript =");
    const loadProjectsStart = source.indexOf("const loadProjects =");
    const loadTranscriptSource = source.slice(
      loadTranscriptStart,
      loadProjectsStart,
    );

    expect(loadTranscriptSource).toContain(
      "const transcriptRequestId = ++transcriptRequestRef.current;",
    );
    expect(loadTranscriptSource).toContain(
      "transcriptRequestId !== transcriptRequestRef.current ||",
    );
    expect(loadTranscriptSource).toContain(
      "runId !== selectedRunIdRef.current",
    );
    expect(loadTranscriptSource).toContain(
      "transcriptRequestId === transcriptRequestRef.current &&",
    );
    expect(source).toContain(
      "<RunDetailCard\n                            key={selectedRun.id}",
    );
  });
});

describe("CodeAgentsApp project folder picker", () => {
  it("keeps folder creation in the dropdown instead of duplicating its action", () => {
    const source = readFileSync("src/CodeAgentsApp.tsx", "utf8");
    const css = readFileSync("src/styles.css", "utf8");

    expect(source).toContain("<span>Add folder...</span>");
    expect(source).not.toContain('aria-label="Add folder"');
    expect(source).toContain('value="remote"');
    expect(source).toContain("onRemoteSelect?.();");
    expect(source).toContain('description="Use the selected folder directly"');
    expect(source.indexOf('aria-label="Select working folder"')).toBeLessThan(
      source.indexOf('aria-label="Select workspace"'),
    );
    expect(css).toContain("margin-top: 8px;");
    expect(css).toContain("box-shadow: 0 18px 44px hsl(0 0% 0% / 0.42);");
  });
});

describe("CodeAgentsApp unread run state", () => {
  const run = (id: string, status: CodeAgentRun["status"]) =>
    ({ id, status }) as CodeAgentRun;

  it("does not infer unread state from the first historical run list", () => {
    expect(
      findRunsThatBecameUnread(undefined, [run("old-1", "completed")]),
    ).toEqual([]);
  });

  it("only marks a run unread when an observed active run becomes terminal", () => {
    expect(
      findRunsThatBecameUnread(
        [run("run-1", "running")],
        [run("run-1", "completed")],
      ),
    ).toEqual(["run-1"]);
    expect(
      findRunsThatBecameUnread(
        [run("run-1", "running")],
        [run("run-1", "completed")],
        "run-1",
      ),
    ).toEqual([]);
    expect(
      findRunsThatBecameUnread(
        [run("run-1", "completed")],
        [run("run-1", "completed")],
      ),
    ).toEqual([]);
  });
});

describe("code-agent model selection", () => {
  const models: CodeAgentModelOption[] = [
    {
      engine: "claude-cli",
      engineLabel: "Anthropic",
      model: "claude-sonnet-5",
      label: "Claude Sonnet 5",
      configured: true,
      statusLabel: "Claude subscription",
      isSubscription: true,
    },
  ];

  it("migrates the legacy Auto selection to a concrete model", () => {
    expect(
      normalizeModelSelection(
        { engine: "auto", model: "auto", effort: "medium" },
        models,
      ),
    ).toEqual({
      engine: "claude-cli",
      model: "claude-sonnet-5",
      effort: "medium",
    });
  });

  it("keeps Luna out of Claude Code and prefers Sonnet", () => {
    const mixedModels: CodeAgentModelOption[] = [
      {
        engine: "claude-cli",
        engineLabel: "Anthropic",
        model: "gpt-5.6-luna",
        label: "GPT-5.6 Luna",
        configured: true,
      },
      ...models,
    ];

    expect(
      normalizeModelSelection(
        { engine: "claude-cli", model: "gpt-5.6-luna", effort: "high" },
        mixedModels,
      ),
    ).toMatchObject({ engine: "claude-cli", model: "claude-sonnet-5" });
    expect(
      getCodeAgentSelection(
        "claude-code",
        { engine: "codex-cli", model: "gpt-5.6-luna", effort: "high" },
        mixedModels,
      ),
    ).toMatchObject({ engine: "claude-cli", model: "claude-sonnet-5" });
  });

  it("keeps Luna as the default for non-Claude Code agents", () => {
    const mixedModels: CodeAgentModelOption[] = [
      ...models,
      {
        engine: "codex-cli",
        engineLabel: "OpenAI",
        model: "gpt-5.6-luna",
        label: "GPT-5.6 Luna",
        configured: true,
      },
    ];
    expect(
      getCodeAgentSelection(
        "codex",
        { engine: "claude-cli", model: "claude-sonnet-5", effort: "high" },
        mixedModels,
      ),
    ).toMatchObject({ engine: "codex-cli", model: "gpt-5.6-luna" });
  });

  it("defaults an empty selection to Luna with high effort", () => {
    expect(normalizeModelSelection({}, [])).toEqual({
      engine: "ai-sdk:openai",
      model: "gpt-5.6-luna",
      effort: "high",
    });
  });

  it("migrates a legacy Auto effort to high", () => {
    expect(
      normalizeModelSelection(
        { engine: "auto", model: "auto", effort: "auto" },
        models,
      ),
    ).toMatchObject({ effort: "high" });
  });

  it("keeps native subscription status on the right-aligned provider group", () => {
    expect(groupCodeAgentModelOptions(models)).toEqual([
      {
        engine: "claude-cli",
        label: "Anthropic",
        models: ["claude-sonnet-5"],
        configured: true,
        statusLabel: "Claude subscription",
        isSubscription: true,
      },
    ]);
  });

  it("lets Default enter the hosted model list before a provider is configured", () => {
    const hostedModels: CodeAgentModelOption[] = [
      {
        engine: "anthropic",
        engineLabel: "Anthropic",
        model: "claude-sonnet-5",
        label: "Claude Sonnet 5",
        configured: false,
      },
      {
        engine: "builder",
        engineLabel: "Builder.io",
        model: "claude-sonnet-5",
        label: "Claude Sonnet 5",
        configured: true,
      },
    ];

    expect(
      getCodeAgentSelection(
        "default",
        { engine: "codex-cli", model: "gpt-5.6-luna", effort: "high" },
        hostedModels,
      ),
    ).toEqual({
      engine: "builder",
      model: "claude-sonnet-5",
      effort: "high",
    });

    expect(
      getCodeAgentSelection(
        "default",
        { engine: "codex-cli", model: "gpt-5.6-luna", effort: "high" },
        hostedModels.slice(0, 1),
      ),
    ).toEqual({
      engine: "anthropic",
      model: "claude-sonnet-5",
      effort: "high",
    });
  });

  it("keeps Remote out of the agent runtime list", () => {
    expect(
      getCodeAgentPickerOptions(models).find((agent) => agent.id === "remote"),
    ).toBeUndefined();
  });
});

describe("session watch transcript reconciliation", () => {
  it("keeps a live event that arrives before an older snapshot resolves", () => {
    const liveEvent: CodeAgentTranscriptEvent = {
      id: "live",
      runId: "run-1",
      type: "status",
      createdAt: "2026-08-09T20:00:02.000Z",
      text: "live update",
      metadata: { seq: 2 },
    };
    const snapshotEvent: CodeAgentTranscriptEvent = {
      id: "snapshot",
      runId: "run-1",
      type: "status",
      createdAt: "2026-08-09T20:00:01.000Z",
      text: "initial snapshot",
      metadata: { seq: 1 },
    };

    expect(
      mergeSessionWatchTranscriptEvents([liveEvent], [snapshotEvent]).map(
        (event) => event.id,
      ),
    ).toEqual(["snapshot", "live"]);
  });

  it("bounds long-running watched transcripts", () => {
    const events = Array.from(
      { length: SESSION_WATCH_TRANSCRIPT_EVENT_LIMIT + 1 },
      (_, index) => ({
        id: `event-${index}`,
        runId: "run-1",
        type: "status" as const,
        createdAt: "2026-08-09T20:00:00.000Z",
        text: `event ${index}`,
        metadata: { seq: index },
      }),
    );

    const merged = mergeSessionWatchTranscriptEvents([], events);
    expect(merged).toHaveLength(SESSION_WATCH_TRANSCRIPT_EVENT_LIMIT);
    expect(merged[0]?.id).toBe("event-1");
    expect(merged.at(-1)?.id).toBe(
      `event-${SESSION_WATCH_TRANSCRIPT_EVENT_LIMIT}`,
    );
  });
});

describe("chat-first session watch bounds", () => {
  it("only closes when runs have loaded and a code-agent watch target is still missing", () => {
    expect(
      shouldCloseWatchedChatFirstSession({
        runsLoaded: false,
        targetSessionId: "run-1",
        targetKind: "code-agent",
        watchedRunPresent: false,
      }),
    ).toBe(false);
    expect(
      shouldCloseWatchedChatFirstSession({
        runsLoaded: true,
        targetSessionId: "run-1",
        targetKind: "agent-chat",
        watchedRunPresent: false,
      }),
    ).toBe(false);
    expect(
      shouldCloseWatchedChatFirstSession({
        runsLoaded: true,
        targetSessionId: "run-1",
        targetKind: "external",
        watchedRunPresent: false,
      }),
    ).toBe(false);
    expect(
      shouldCloseWatchedChatFirstSession({
        runsLoaded: true,
        targetSessionId: "run-1",
        targetKind: "code-agent",
        watchedRunPresent: false,
      }),
    ).toBe(true);
    expect(
      shouldCloseWatchedChatFirstSession({
        runsLoaded: true,
        targetSessionId: "run-1",
        targetKind: "code-agent",
        watchedRunPresent: true,
      }),
    ).toBe(false);
  });
});
