import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  findRunsThatBecameUnread,
  getProviderGate,
  getCodeAgentPickerOptions,
  getCodeAgentSelection,
  getCodeAgentWorktreeRecoveryState,
  groupCodeAgentModelOptions,
  normalizeModelSelection,
  resolveCodeAgentsPrimaryTab,
  resolveNewSessionExtensionComposerState,
  shouldShowCodeAgentCredentialCallout,
  shouldCloseWatchedChatFirstSession,
  type CodeAgentsNewSessionExtension,
} from "./CodeAgentsApp.js";
import {
  getChatFirstNumericAppShortcut,
  resolveChatFirstKeyboardNavigationTarget,
} from "./keyboard-navigation.js";
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

describe("CodeAgentsApp worktree recovery", () => {
  it("offers restore when cleanup removed a recoverable checkout", () => {
    expect(
      getCodeAgentWorktreeRecoveryState({
        path: "/tmp/missing-worktree",
        pathAvailable: false,
        state: "recoverable",
        lastCleanupError: "Worktree contains commits after its base.",
      }),
    ).toEqual({
      wasPreserved: false,
      needsRecovery: true,
      needsNotice: true,
    });
  });

  it("keeps an available dirty checkout in the preserved state", () => {
    expect(
      getCodeAgentWorktreeRecoveryState({
        path: "/tmp/available-worktree",
        pathAvailable: true,
        state: "recoverable",
        lastCleanupError: "Worktree has uncommitted changes.",
      }),
    ).toEqual({
      wasPreserved: true,
      needsRecovery: false,
      needsNotice: true,
    });
  });
});

describe("CodeAgentsApp credential recovery", () => {
  it("blocks only a confirmed missing provider and exempts local terminal and Portal targets", () => {
    const missingProvider = {
      status: "ok" as const,
      llmProvider: { configured: false },
    };

    expect(getProviderGate(missingProvider).blocked).toBe(true);
    expect(getProviderGate({ status: "ok" }).blocked).toBe(false);
    expect(getProviderGate({ status: "unavailable" }).blocked).toBe(false);
    expect(
      getProviderGate(missingProvider, { terminalMode: true }).blocked,
    ).toBe(false);
    expect(
      getProviderGate(missingProvider, { portalTarget: true }).blocked,
    ).toBe(false);
    expect(
      getProviderGate({
        status: "ok",
        llmProvider: { configured: true },
      }).blocked,
    ).toBe(false);
  });

  it("shows setup when the selected run reports missing credentials", () => {
    expect(
      shouldShowCodeAgentCredentialCallout({
        providerBlocked: false,
        hasCredentialHistory: true,
        phase: "missing-credentials",
      }),
    ).toBe(true);
  });

  it("does not keep a stale credential callout after the provider is ready", () => {
    expect(
      shouldShowCodeAgentCredentialCallout({
        providerBlocked: false,
        hasCredentialHistory: true,
        phase: "completed",
      }),
    ).toBe(false);
  });

  it("shows the connection gate before a run has recorded credential errors", () => {
    expect(
      shouldShowCodeAgentCredentialCallout({
        providerBlocked: true,
        hasCredentialHistory: false,
        phase: "running",
      }),
    ).toBe(true);
  });

  it("does not show app-key recovery for Portal runs", () => {
    expect(
      shouldShowCodeAgentCredentialCallout({
        providerBlocked: false,
        hasCredentialHistory: true,
        phase: "missing-credentials",
        providerExempt: true,
      }),
    ).toBe(false);
  });
});

describe("chat-first keyboard navigation", () => {
  const appIds = ["mail", "calendar", "design"];
  const chatIds = ["chat-1", "chat-2"];

  it("maps Cmd+number positions to the ordered app list", () => {
    expect(getChatFirstNumericAppShortcut(appIds, "1")).toBe("mail");
    expect(getChatFirstNumericAppShortcut(appIds, "3")).toBe("design");
    expect(getChatFirstNumericAppShortcut(appIds, "4")).toBeNull();
  });

  it("crosses from apps into chats and cycles back through the full sequence", () => {
    expect(
      resolveChatFirstKeyboardNavigationTarget({
        appIds,
        activeAppId: "design",
        chatIds,
        direction: 1,
      }),
    ).toEqual({ kind: "chat", id: "chat-1" });
    expect(
      resolveChatFirstKeyboardNavigationTarget({
        appIds,
        chatIds,
        selectedChatId: "chat-1",
        direction: 1,
      }),
    ).toEqual({ kind: "chat", id: "chat-2" });
    expect(
      resolveChatFirstKeyboardNavigationTarget({
        appIds,
        chatIds,
        selectedChatId: "chat-2",
        direction: 1,
      }),
    ).toEqual({ kind: "app", id: "mail" });
    expect(
      resolveChatFirstKeyboardNavigationTarget({
        appIds,
        activeAppId: "mail",
        chatIds,
        direction: -1,
      }),
    ).toEqual({ kind: "chat", id: "chat-2" });
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
      model: "gpt-6-luna",
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

describe("resolveCodeAgentsPrimaryTab", () => {
  it("activates Search while its panel owns the main area", () => {
    expect(
      resolveCodeAgentsPrimaryTab({
        chatFirstMainKind: "code",
        searchPanelOpen: true,
        hostActiveTab: "new-chat",
      }),
    ).toBe("search");
  });

  it("keeps the host tab when the search panel is closed", () => {
    expect(
      resolveCodeAgentsPrimaryTab({
        chatFirstMainKind: "code",
        searchPanelOpen: false,
        hostActiveTab: "scheduled",
      }),
    ).toBe("scheduled");
  });

  it("releases Search when another surface takes the main area", () => {
    expect(
      resolveCodeAgentsPrimaryTab({
        chatFirstMainKind: "agent",
        searchPanelOpen: true,
      }),
    ).toBeUndefined();
  });

  it("resolves no tab when nothing owns the rail", () => {
    expect(
      resolveCodeAgentsPrimaryTab({
        chatFirstMainKind: "code",
        searchPanelOpen: false,
      }),
    ).toBeUndefined();
  });
});
