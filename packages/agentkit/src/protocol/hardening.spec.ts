import { describe, expect, it } from "vitest";

import {
  AGENTKIT_PROTOCOL_VERSION,
  AgentKitProtocolError,
  AgentProtocolValidationError,
  createAgentKitProtocolVersionOffer,
  createAgentProtocolEnvelope,
  createCapabilityUnavailableError,
  createCapabilityUnsupportedError,
  createRequestAbortedError,
  getAgentCapabilityStatus,
  negotiateAgentKitProtocolVersion,
  parseAgentCapabilitiesDiscovery,
  parseAgentCapabilities,
  parseAgentDurableThreadSnapshot,
  parseAgentProtocolEnvelope,
  parseAgentProtocolVersionOffer,
  parseAgentRequestContext,
  parseAgentThreadSnapshot,
  parseSubscribeToRunInput,
  requireAgentCapability,
} from "./index.js";

const occurredAt = "2026-08-29T00:00:00.000Z";

describe("AgentKit protocol hardening", () => {
  it("negotiates versions and exposes explicit capability status", () => {
    const protocol = negotiateAgentKitProtocolVersion(
      createAgentKitProtocolVersionOffer(),
    );
    const discovery = parseAgentCapabilitiesDiscovery({
      protocol,
      discoveredAt: occurredAt,
      expiresAt: "2026-08-29T00:05:00.000Z",
      capabilities: [
        { id: "activities", state: "available" },
        {
          id: "resumableRuns",
          state: "degraded",
          error: createCapabilityUnavailableError("resumableRuns", {
            message: "Replay is temporarily limited to the latest checkpoint.",
            retryable: true,
            correlationId: "correlation-1",
          }),
        },
        {
          id: "codeExecution",
          state: "unsupported",
          error: createCapabilityUnsupportedError("codeExecution"),
        },
      ],
      legacy: { activities: true, codeExecution: false },
    });

    expect(protocol).toMatchObject({
      status: "compatible",
      selectedVersion: AGENTKIT_PROTOCOL_VERSION,
    });
    expect(getAgentCapabilityStatus(discovery, "resumableRuns")).toMatchObject({
      state: "degraded",
      error: { retryable: true, correlationId: "correlation-1" },
    });
    expect(requireAgentCapability(discovery, "activities").state).toBe(
      "available",
    );
    expect(() => requireAgentCapability(discovery, "codeExecution")).toThrow(
      AgentKitProtocolError,
    );
    try {
      requireAgentCapability(discovery, "codeExecution");
    } catch (error) {
      expect(error).toMatchObject({
        code: "capability_unsupported",
        retryable: false,
      });
    }
  });

  it("fails version negotiation with a typed, correlated error", () => {
    const compatibility = negotiateAgentKitProtocolVersion(
      { protocol: "agentkit", versions: [99] },
      { correlationId: "correlation-99" },
    );

    expect(compatibility).toEqual({
      status: "incompatible",
      localVersions: [AGENTKIT_PROTOCOL_VERSION],
      peerVersions: [99],
      error: expect.objectContaining({
        code: "protocol_version_unsupported",
        retryable: false,
        correlationId: "correlation-99",
        supportedVersions: [AGENTKIT_PROTOCOL_VERSION],
        receivedVersions: [99],
      }),
    });
    expect(() =>
      parseAgentProtocolVersionOffer({
        protocol: "agentkit",
        versions: [1, 1],
      }),
    ).toThrow("must be unique");
  });

  it("validates abortable subscription inputs without treating abort as run cancellation", () => {
    const controller = new AbortController();
    const input = parseSubscribeToRunInput({
      threadId: "thread-1",
      runId: "run-1",
      afterSequence: 0,
      signal: controller.signal,
    });

    expect(input.signal).toBe(controller.signal);
    controller.abort("view closed");
    expect(input.signal?.aborted).toBe(true);
    expect(() =>
      parseSubscribeToRunInput({
        threadId: "thread-1",
        runId: "run-1",
        signal: { aborted: false },
      }),
    ).toThrow("AbortSignal-compatible");
  });

  it("validates provider-neutral request context and creates typed abort errors", () => {
    const controller = new AbortController();
    const context = parseAgentRequestContext({
      signal: controller.signal,
      correlationId: "request-42",
    });

    expect(context).toEqual({
      signal: controller.signal,
      correlationId: "request-42",
    });
    expect(createRequestAbortedError({ correlationId: "request-42" })).toEqual(
      expect.objectContaining({
        code: "request_aborted",
        retryable: false,
        correlationId: "request-42",
      }),
    );
    expect(() =>
      parseAgentRequestContext({ signal: { aborted: false } }),
    ).toThrow("AbortSignal-compatible");
    expect(() =>
      parseAgentRequestContext({ correlationId: "request-42", extra: true }),
    ).toThrow("is not defined by this protocol version");
  });

  it("round-trips neutral provenance metadata and typed error envelopes", () => {
    const metadata = {
      actor: { id: "actor-1", kind: "agent" },
      workspace: { id: "workspace-1", kind: "workspace" },
      access: [{ id: "grant-1", kind: "grant" }],
      audit: { id: "audit-1", kind: "event" },
      trace: { traceId: "trace-1", spanId: "span-1" },
      context: [{ id: "document-1", kind: "document" }],
    };
    const error = createCapabilityUnavailableError("uploads", {
      correlationId: "correlation-1",
      retryable: true,
      metadata,
    });
    const envelope = createAgentProtocolEnvelope(
      "error",
      error,
      "correlation-1",
      metadata,
    );

    expect(parseAgentProtocolEnvelope(envelope)).toEqual(envelope);
    expect(() =>
      parseAgentProtocolEnvelope({ ...envelope, unexpected: true }),
    ).toThrow("is not defined by this protocol version");
    expect(() =>
      parseAgentProtocolEnvelope(
        createAgentProtocolEnvelope("response", { invalid: () => undefined }),
      ),
    ).toThrow("expected a JSON value");
    expect(() =>
      parseAgentProtocolEnvelope(
        createAgentProtocolEnvelope("response", { invalid: new Date() }),
      ),
    ).toThrow("expected a plain JSON object");
  });

  it("validates a complete restart-safe thread snapshot", () => {
    const snapshot = {
      id: "thread-1",
      createdAt: occurredAt,
      updatedAt: occurredAt,
      messages: [
        {
          id: "message-1",
          role: "assistant",
          parts: [{ type: "text", text: "Work is in progress." }],
        },
      ],
      queuedMessages: [],
      events: [
        {
          id: "event-1",
          threadId: "thread-1",
          runId: "run-1",
          sequence: 1,
          occurredAt,
          type: "run.started",
          agentId: "agent-1",
        },
      ],
      runs: [
        {
          id: "run-1",
          threadId: "thread-1",
          status: "running",
          lastSequence: 1,
        },
      ],
      activeRunIds: ["run-1"],
      checkpoint: {
        id: "checkpoint-1",
        capturedAt: occurredAt,
        sequenceByRun: { "run-1": 1 },
      },
      toolCalls: [
        {
          id: "tool-1",
          name: "workspace.read",
          status: "completed",
          runId: "run-1",
          output: { files: 2 },
        },
      ],
      activities: [
        {
          id: "activity-1",
          kind: "read",
          label: "Read protocol files",
          status: "completed",
          runId: "run-1",
        },
      ],
      tasks: [
        {
          id: "task-1",
          title: "Harden protocol",
          status: "running",
          runId: "run-1",
        },
      ],
      taskGroups: [
        {
          id: "task-group-1",
          title: "Protocol release",
          status: "running",
          runId: "run-1",
          taskIds: ["task-1"],
        },
      ],
      approvals: [
        {
          request: { id: "approval-1", title: "Publish changes?" },
          status: "pending",
          runId: "run-1",
        },
      ],
      widgets: [
        {
          messageId: "message-1",
          widget: { id: "widget-1", kind: "status", data: { ready: false } },
        },
      ],
      annotations: [
        {
          messageId: "message-1",
          annotation: {
            id: "annotation-1",
            kind: "source",
            label: "Protocol source",
          },
        },
      ],
      agents: [{ id: "agent-1", name: "Primary", status: "working" }],
      interactions: [
        {
          id: "interaction-1",
          kind: "started",
          agentId: "agent-1",
          occurredAt,
        },
      ],
      artifacts: [
        {
          id: "artifact-1",
          kind: "file",
          title: "Protocol report",
          runId: "run-1",
          createdAt: occurredAt,
        },
      ],
      suggestions: [
        {
          id: "suggestion-1",
          label: "Review the report",
          runId: "run-1",
          updatedAt: occurredAt,
        },
      ],
    };

    expect(parseAgentDurableThreadSnapshot(snapshot)).toEqual(snapshot);
    expect(() =>
      parseAgentDurableThreadSnapshot({
        ...snapshot,
        checkpoint: {
          ...snapshot.checkpoint,
          sequenceByRun: { "run-1": 0 },
        },
      }),
    ).toThrow("must include every replayed event sequence");
    const { suggestions: _suggestions, ...incomplete } = snapshot;
    expect(() => parseAgentDurableThreadSnapshot(incomplete)).toThrow(
      "is required for a durable snapshot",
    );
  });

  it("keeps legacy capability maps and partial snapshots valid", () => {
    expect(
      parseAgentCapabilities({ activities: true, uploads: false }),
    ).toEqual({ activities: true, uploads: false });
    expect(
      parseAgentThreadSnapshot({
        id: "thread-1",
        createdAt: occurredAt,
        updatedAt: occurredAt,
        messages: [],
      }),
    ).toMatchObject({ id: "thread-1", messages: [] });
    expect(() =>
      parseAgentCapabilitiesDiscovery({
        protocol: negotiateAgentKitProtocolVersion(
          createAgentKitProtocolVersionOffer(),
        ),
        discoveredAt: occurredAt,
        capabilities: [{ id: "uploads", state: "unsupported" }],
      }),
    ).toThrow(AgentProtocolValidationError);
  });
});
