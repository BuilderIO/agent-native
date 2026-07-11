import { describe, expect, it } from "vitest";

import type { CodeAgentTranscriptEvent } from "../cli/code-agent-runs.js";
import {
  isCredentialGapCodeAgentEvent,
  normalizeCodeAgentTranscript,
} from "./transcript-normalizer.js";

describe("normalizeCodeAgentTranscript", () => {
  it("coalesces legacy runner stdout and suppresses duplicate final assistant text", () => {
    const events = [
      event("evt-user", "user", "Fix the failing test."),
      event("evt-start", "status", "Agent-Native Code run started.", {
        status: "running",
        phase: "executing",
      }),
      event("evt-stdout-1", "status", "I checked", {
        source: "runner-stdout",
      }),
      event("evt-stdout-2", "status", "the specs.", {
        source: "runner-stdout",
      }),
      event("evt-final", "system", "I checked the specs.", {
        role: "assistant",
      }),
      event("evt-complete", "status", "Agent-Native Code run completed.", {
        status: "completed",
        phase: "complete",
      }),
    ];

    const transcript = normalizeCodeAgentTranscript(events);

    expect(transcript.items).toHaveLength(2);
    expect(transcript.items[0]).toMatchObject({
      type: "user",
      text: "Fix the failing test.",
    });
    expect(transcript.items[1]).toMatchObject({
      type: "assistant",
      source: "runner-stdout",
      text: "I checked the specs.",
      eventIds: ["evt-stdout-1", "evt-stdout-2", "evt-final"],
      suppressedDuplicateEventIds: ["evt-final"],
    });
    expect(transcript.hiddenEvents.map((item) => item.id)).toEqual([
      "evt-start",
      "evt-final",
      "evt-complete",
    ]);
    expect(transcript.rawEvents).toEqual(events);
  });

  it("coalesces assistant_delta system chunks and suppresses the final duplicate", () => {
    const events = [
      event("evt-user", "user", "Keep going."),
      event(
        "evt-engine",
        "system",
        "[builder-engine] → POST https://example.test\n",
        {
          type: "assistant_delta",
          seq: 0,
        },
      ),
      event("evt-delta-1", "system", "**Agent-", {
        type: "assistant_delta",
        seq: 1,
      }),
      event("evt-delta-2", "system", "Native**\n\n- `core`", {
        type: "assistant_delta",
        seq: 2,
      }),
      event("evt-delta-3", "system", " package", {
        type: "assistant_delta",
        seq: 3,
      }),
      event("evt-final", "system", "**Agent-Native**\n\n- `core` package", {
        role: "assistant",
        seq: 4,
      }),
    ];

    const transcript = normalizeCodeAgentTranscript(events);

    expect(transcript.items).toEqual([
      expect.objectContaining({ type: "user" }),
      expect.objectContaining({
        type: "assistant",
        source: "runner-stdout",
        text: "**Agent-Native**\n\n- `core` package",
        eventIds: ["evt-delta-1", "evt-delta-2", "evt-delta-3", "evt-final"],
        suppressedDuplicateEventIds: ["evt-final"],
      }),
    ]);
    expect(transcript.hiddenEvents.map((item) => item.id)).toEqual([
      "evt-engine",
      "evt-final",
    ]);
  });

  it("preserves streaming assistant_delta spaces before a final duplicate arrives", () => {
    const events = [
      event("evt-user", "user", "Check the diff."),
      event("evt-delta-1", "system", "Now let", {
        type: "assistant_delta",
        seq: 1,
      }),
      event("evt-delta-2", "system", " me check", {
        type: "assistant_delta",
        seq: 2,
      }),
      event("evt-delta-3", "system", " the remaining", {
        type: "assistant_delta",
        seq: 3,
      }),
      event("evt-delta-4", "system", " diffs to", {
        type: "assistant_delta",
        seq: 4,
      }),
      event("evt-delta-5", "system", " ", {
        type: "assistant_delta",
        seq: 5,
      }),
      event("evt-delta-6", "system", "make", {
        type: "assistant_delta",
        seq: 6,
      }),
      event("evt-delta-7", "system", " sure everything is clean.", {
        type: "assistant_delta",
        seq: 7,
      }),
    ];

    const transcript = normalizeCodeAgentTranscript(events);

    expect(transcript.items).toEqual([
      expect.objectContaining({ type: "user" }),
      expect.objectContaining({
        type: "assistant",
        source: "runner-stdout",
        text: "Now let me check the remaining diffs to make sure everything is clean.",
      }),
    ]);
  });

  it("keeps regular assistant system messages when they are not stdout duplicates", () => {
    const events = [
      event("evt-user", "user", "Summarize the changes."),
      event("evt-final", "system", "I changed the tests only.", {
        role: "assistant",
      }),
    ];

    const transcript = normalizeCodeAgentTranscript(events);

    expect(transcript.items).toEqual([
      expect.objectContaining({
        type: "user",
        text: "Summarize the changes.",
      }),
      expect.objectContaining({
        type: "assistant",
        source: "system",
        text: "I changed the tests only.",
      }),
    ]);
    expect(transcript.hiddenEvents).toEqual([]);
  });

  it("groups tool start, activity, and done events into one compact tool item", () => {
    const events = [
      event("evt-tool-start", "status", "Running exec_command.", {
        type: "tool_start",
        tool: "exec_command",
        input: { cmd: "pnpm test" },
      }),
      event("evt-tool-activity", "status", "Running tests", {
        type: "activity",
        tool: "exec_command",
      }),
      event("evt-tool-done", "status", "Finished exec_command.", {
        type: "tool_done",
        tool: "exec_command",
        result: "1 passed",
      }),
    ];

    const transcript = normalizeCodeAgentTranscript(events);

    expect(transcript.items).toEqual([
      expect.objectContaining({
        type: "tool",
        tool: "exec_command",
        label: "Running exec_command.",
        state: "completed",
        input: { cmd: "pnpm test" },
        result: "1 passed",
        activities: ["Running tests"],
        eventIds: ["evt-tool-start", "evt-tool-activity", "evt-tool-done"],
      }),
    ]);
  });

  it("merges activity before tool_start so a completed tool does not keep working forever", () => {
    const events = [
      event("evt-tool-activity", "status", "Preparing list_files action", {
        type: "activity",
        tool: "list_files",
      }),
      event("evt-tool-start", "status", "Running list_files.", {
        type: "tool_start",
        tool: "list_files",
      }),
      event("evt-tool-done", "status", "Finished list_files.", {
        type: "tool_done",
        tool: "list_files",
      }),
    ];

    const transcript = normalizeCodeAgentTranscript(events);

    expect(transcript.items).toEqual([
      expect.objectContaining({
        type: "tool",
        tool: "list_files",
        label: "Running list_files.",
        state: "completed",
        activities: ["Preparing list_files action"],
        eventIds: ["evt-tool-activity", "evt-tool-start", "evt-tool-done"],
      }),
    ]);
  });

  it("shows important approval and error statuses while hiding lifecycle noise", () => {
    const events = [
      event("evt-queued", "status", "Remote Agent-Native Code run queued.", {
        status: "queued",
        phase: "queued",
      }),
      event("evt-approval", "status", "Approval required: Run pnpm test.", {
        status: "needs-approval",
        phase: "approval-required",
        pendingApprovalId: "approval-1",
      }),
      event("evt-error", "status", "Model call failed.", {
        type: "error",
        errorCode: "provider_error",
      }),
      event("evt-mcp", "status", "Connected 2 MCP tools for this run.", {
        type: "mcp-tools-connected",
      }),
    ];

    const transcript = normalizeCodeAgentTranscript(events);

    expect(transcript.items).toEqual([
      expect.objectContaining({
        type: "status",
        level: "approval",
        text: "Approval required: Run pnpm test.",
      }),
      expect.objectContaining({
        type: "status",
        level: "error",
        text: "Model call failed.",
      }),
    ]);
    expect(transcript.hiddenEvents.map((item) => item.id)).toEqual([
      "evt-queued",
      "evt-mcp",
    ]);
  });

  it("stamps pendingApprovalKey on a completed bash call whose result carries an Approval id marker", () => {
    const events = [
      event("evt-tool-start", "status", "Running bash.", {
        type: "tool_start",
        tool: "bash",
        input: { command: "rm -rf tmp" },
      }),
      event("evt-tool-done", "status", "Finished bash.", {
        type: "tool_done",
        tool: "bash",
        result: [
          "Approval required before running this command: destructive recursive delete.",
          "Approval id: approval-20260710120000",
          "Command: rm -rf tmp",
          "The run is paused; approve from the Agent-Native Code UI/CLI if this command is intentional.",
        ].join("\n"),
      }),
    ];

    const transcript = normalizeCodeAgentTranscript(events);

    expect(transcript.items).toEqual([
      expect.objectContaining({
        type: "tool",
        tool: "bash",
        state: "completed",
        pendingApprovalKey: "approval-20260710120000",
      }),
    ]);
  });

  it("does not stamp pendingApprovalKey once a later event resolves the same approval id", () => {
    const events = [
      event("evt-tool-start", "status", "Running bash.", {
        type: "tool_start",
        tool: "bash",
        input: { command: "rm -rf tmp" },
      }),
      event("evt-tool-done", "status", "Finished bash.", {
        type: "tool_done",
        tool: "bash",
        result: [
          "Approval required before running this command: destructive recursive delete.",
          "Approval id: approval-20260710120000",
          "Command: rm -rf tmp",
          "The run is paused; approve from the Agent-Native Code UI/CLI if this command is intentional.",
        ].join("\n"),
      }),
      // Mirrors executePendingCodeAgentApproval's resolution event in
      // cli/code-agent-executor.ts — folded into hiddenEvents (status:
      // "running" reads as low-signal lifecycle noise) but still visible to
      // the raw-event resolution scan.
      event(
        "evt-approval-running",
        "status",
        "Approved command; running now.",
        {
          status: "running",
          phase: "approval-running",
          approvalId: "approval-20260710120000",
          command: "rm -rf tmp",
        },
      ),
    ];

    const transcript = normalizeCodeAgentTranscript(events);

    const toolItem = transcript.items.find((item) => item.type === "tool");
    expect(toolItem).toMatchObject({ type: "tool", tool: "bash" });
    expect(
      (toolItem as { pendingApprovalKey?: string }).pendingApprovalKey,
    ).toBeUndefined();
  });

  it("propagates structuredMeta from tool_start and tool_done into the normalized tool event", () => {
    const bashMeta = {
      toolKind: "bash",
      command: "pnpm test",
      cwd: "/workspace",
    };
    const bashMetaDone = {
      toolKind: "bash",
      command: "pnpm test",
      cwd: "/workspace",
      exitCode: 0,
      durationMs: 4200,
    };
    const events = [
      event("evt-start", "status", "Running bash.", {
        type: "tool_start",
        tool: "bash",
        input: { command: "pnpm test" },
        structuredMeta: bashMeta,
      }),
      event("evt-done", "status", "Finished bash.", {
        type: "tool_done",
        tool: "bash",
        result: "All tests passed.",
        structuredMeta: bashMetaDone,
      }),
    ];

    const transcript = normalizeCodeAgentTranscript(events);

    expect(transcript.items).toHaveLength(1);
    expect(transcript.items[0]).toMatchObject({
      type: "tool",
      tool: "bash",
      state: "completed",
      structuredMeta: bashMetaDone,
    });
  });

  it("propagates chatUI metadata from completed tool events", () => {
    const events = [
      event("evt-start", "status", "Rendering inline UI.", {
        type: "tool_start",
        tool: "render-inline-extension",
        input: { name: "Knobs" },
      }),
      event("evt-done", "status", "Rendered inline UI.", {
        type: "tool_done",
        tool: "render-inline-extension",
        result: {
          ok: true,
          inlineExtension: {
            mode: "transient",
            id: "inline-1",
            name: "Knobs",
            content: "<div>Knobs</div>",
          },
        },
        chatUI: { renderer: "core.inline-extension" },
      }),
    ];

    const transcript = normalizeCodeAgentTranscript(events);

    expect(transcript.items).toHaveLength(1);
    expect(transcript.items[0]).toMatchObject({
      type: "tool",
      tool: "render-inline-extension",
      state: "completed",
      chatUI: { renderer: "core.inline-extension" },
    });
  });

  it("preserves structuredMeta from old events that lack it (backward compat)", () => {
    const events = [
      event("evt-start", "status", "Running bash.", {
        type: "tool_start",
        tool: "bash",
        input: { command: "echo hi" },
        // no structuredMeta — old event format
      }),
      event("evt-done", "status", "Finished bash.", {
        type: "tool_done",
        tool: "bash",
        result: "hi",
        // no structuredMeta
      }),
    ];

    const transcript = normalizeCodeAgentTranscript(events);

    expect(transcript.items).toHaveLength(1);
    const item = transcript.items[0];
    expect(item.type).toBe("tool");
    if (item.type === "tool") {
      expect(item.structuredMeta).toBeUndefined();
    }
  });

  it("clears rejected assistant text while preserving completed tool events", () => {
    const events = [
      event("evt-tool-start", "status", "Running query.", {
        type: "tool_start",
        tool: "query",
        input: { sql: "select 1" },
      }),
      event("evt-tool-done", "status", "Finished query.", {
        type: "tool_done",
        tool: "query",
        result: "1",
      }),
      event("evt-draft", "system", "Rejected draft", { role: "assistant" }),
      event("evt-clear", "status", "", { agentChatEventType: "clear" }),
      event("evt-final", "system", "Corrected answer", { role: "assistant" }),
    ];

    const transcript = normalizeCodeAgentTranscript(events);

    expect(transcript.items).toEqual([
      expect.objectContaining({
        type: "tool",
        state: "completed",
        result: "1",
      }),
      expect.objectContaining({
        type: "assistant",
        text: "Corrected answer",
      }),
    ]);
    expect(transcript.hiddenEvents.map((item) => item.id)).toContain(
      "evt-clear",
    );
  });

  it("retains note and artifact events in the normal output", () => {
    const events = [
      event("evt-artifact", "artifact", "Migration dossier created.", {
        path: "/tmp/dossier",
      }),
      event("evt-note", "note", "Use the dossier with another coding agent.", {
        source: "migration-dossier",
      }),
    ];

    const transcript = normalizeCodeAgentTranscript(events);

    expect(transcript.items).toEqual([
      expect.objectContaining({
        type: "status",
        statusKind: "artifact",
        text: "Migration dossier created.",
      }),
      expect.objectContaining({
        type: "status",
        statusKind: "note",
        text: "Use the dossier with another coding agent.",
      }),
    ]);
  });

  it("carries the structured credential-gap signal onto the normalized status item", () => {
    const events = [
      {
        ...event("evt-cred", "status", "No LLM provider key was found.", {
          status: "paused",
          phase: "missing-credentials",
        }),
        signal: "credential-gap" as const,
      },
    ];

    const transcript = normalizeCodeAgentTranscript(events);

    expect(transcript.items).toEqual([
      expect.objectContaining({
        type: "status",
        signal: "credential-gap",
      }),
    ]);
  });
});

describe("isCredentialGapCodeAgentEvent", () => {
  it("detects the structured signal regardless of message text", () => {
    expect(
      isCredentialGapCodeAgentEvent({
        signal: "credential-gap",
        message: "some unrelated status text",
      }),
    ).toBe(true);
    expect(
      isCredentialGapCodeAgentEvent({
        signal: "credential-gap",
        text: "some unrelated status text",
      }),
    ).toBe(true);
  });

  it("falls back to matching the legacy hint text when no signal is present", () => {
    expect(
      isCredentialGapCodeAgentEvent({
        message: "No LLM provider key was found.",
      }),
    ).toBe(true);
    expect(
      isCredentialGapCodeAgentEvent({
        text: "Missing credentials for a provider.",
      }),
    ).toBe(true);
  });

  it("does not flag unrelated status events", () => {
    expect(
      isCredentialGapCodeAgentEvent({
        message: "Agent-Native Code run started.",
      }),
    ).toBe(false);
    expect(isCredentialGapCodeAgentEvent({})).toBe(false);
  });
});

function event(
  id: string,
  kind: CodeAgentTranscriptEvent["kind"],
  message: string,
  metadata?: Record<string, unknown>,
): CodeAgentTranscriptEvent {
  return {
    schemaVersion: 1,
    id,
    runId: "run-1",
    kind,
    message,
    createdAt: `2026-05-17T12:${id.length.toString().padStart(2, "0")}:00.000Z`,
    metadata,
  };
}
