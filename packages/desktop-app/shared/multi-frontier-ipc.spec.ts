import { describe, expect, it } from "vitest";

import {
  MULTI_FRONTIER_IPC_MAX_EVENT_TEXT_BYTES,
  MULTI_FRONTIER_IPC_SCHEMA_VERSION,
  formatUnknownMultiFrontierMetadata,
  normalizeMultiFrontierIpcEvent,
  normalizeMultiFrontierProviderResult,
  normalizeMultiFrontierRendererState,
  parseMultiFrontierCollaborationRequest,
  parseMultiFrontierProviderRequest,
} from "./multi-frontier-ipc";

const PARTICIPANTS = [
  { participantId: "codex-main", providerId: "codex", model: "gpt-5.6-terra" },
  {
    participantId: "claude-main",
    providerId: "claude",
    model: "claude-sonnet",
  },
] as const;

const RENDERER_PARTICIPANTS = [
  {
    participantId: "codex-main",
    providerId: "codex",
    role: "driver",
    permission: "workspace_write",
    status: "running",
    capabilities: ["workspace-write", "usage"],
  },
  {
    participantId: "claude-main",
    providerId: "claude",
    role: "watchdog",
    permission: "read_only",
    status: "waiting",
    capabilities: ["read-only"],
  },
] as const;

describe("multi-frontier IPC contract", () => {
  it("parses only safe, subscription-native provider requests", () => {
    expect(
      parseMultiFrontierProviderRequest({
        schemaVersion: MULTI_FRONTIER_IPC_SCHEMA_VERSION,
        requestId: "request-1",
        action: "begin-login",
        providerId: "codex",
        token: "not-carried-forward",
      }),
    ).toEqual({
      schemaVersion: 1,
      requestId: "request-1",
      action: "begin-login",
      providerId: "codex",
    });
    expect(
      parseMultiFrontierProviderRequest({
        schemaVersion: 1,
        requestId: "../../unsafe",
        action: "get-status",
        providerId: "codex",
      }),
    ).toBeNull();
  });

  it("requires exactly two distinct providers and bounded user prompts", () => {
    const create = parseMultiFrontierCollaborationRequest({
      schemaVersion: 1,
      requestId: "create-1",
      action: "create",
      workspaceId: "workspace-1",
      prompt: "Investigate the startup regression.",
      participants: PARTICIPANTS,
    });
    expect(create).toMatchObject({
      action: "create",
      autoContinueAfterAgreement: false,
      participants: PARTICIPANTS,
    });
    expect(
      parseMultiFrontierCollaborationRequest({
        schemaVersion: 1,
        requestId: "create-auto-1",
        action: "create",
        workspaceId: "workspace-1",
        prompt: "Investigate the startup regression.",
        autoContinueAfterAgreement: true,
        participants: PARTICIPANTS,
      }),
    ).toMatchObject({ autoContinueAfterAgreement: true });
    expect(
      parseMultiFrontierCollaborationRequest({
        schemaVersion: 1,
        requestId: "create-invalid-auto",
        action: "create",
        workspaceId: "workspace-1",
        prompt: "Test",
        autoContinueAfterAgreement: "yes",
        participants: PARTICIPANTS,
      }),
    ).toBeNull();

    for (const participants of [
      [PARTICIPANTS[0]],
      [PARTICIPANTS[0], PARTICIPANTS[0]],
      [PARTICIPANTS[0], { ...PARTICIPANTS[1], providerId: "codex" }],
    ]) {
      expect(
        parseMultiFrontierCollaborationRequest({
          schemaVersion: 1,
          requestId: "create-1",
          action: "create",
          workspaceId: "workspace-1",
          prompt: "Test",
          participants,
        }),
      ).toBeNull();
    }
    expect(
      parseMultiFrontierCollaborationRequest({
        schemaVersion: 1,
        requestId: "create-1",
        action: "create",
        workspaceId: "workspace-1",
        prompt: "x".repeat(12 * 1024 + 1),
        participants: PARTICIPANTS,
      }),
    ).toBeNull();
  });

  it("parses lifecycle commands without accepting renderer-owned authority", () => {
    expect(
      parseMultiFrontierCollaborationRequest({
        schemaVersion: 1,
        requestId: "swap-1",
        action: "role-swap",
        collaborationId: "collab-1",
        nextDriverParticipantId: "claude-main",
        driverGeneration: 999,
      }),
    ).toEqual({
      schemaVersion: 1,
      requestId: "swap-1",
      action: "role-swap",
      collaborationId: "collab-1",
      nextDriverParticipantId: "claude-main",
    });
    expect(
      parseMultiFrontierCollaborationRequest({
        schemaVersion: 1,
        requestId: "go-1",
        action: "go",
        collaborationId: "collab-1",
      }),
    ).toMatchObject({ action: "go" });
  });

  it("normalizes a bounded, non-authoritative renderer snapshot", () => {
    const state = normalizeMultiFrontierRendererState({
      collaborationId: "collab-1",
      phase: "implementing",
      round: 2,
      participants: RENDERER_PARTICIPANTS,
      driverParticipantId: "codex-main",
      driverGeneration: 4,
      approvalState: "approved",
      artifacts: [
        {
          id: "checkpoint-1",
          kind: "checkpoint",
          summary: "The driver completed the focused regression test.",
          rawDiff: "not-exposed",
        },
      ],
      subscriptions: {
        codex: {
          schemaVersion: 1,
          providerId: "codex",
          connectionState: "connected",
          account: {
            email: "private@example.invalid",
            organizationId: "org-private",
            organizationName: "Private organization",
          },
          telemetry: {
            state: "live",
            source: "codex-app-server",
            capabilities: { rateLimits: true },
            meters: [{ id: "weekly", kind: "weekly", usedPercent: 21 }],
            rawAppServerPayload: { access_token: "secret" },
          },
        },
      },
    });
    expect(state).toMatchObject({
      rendererStateIsAuthoritative: false,
      autoContinueAfterAgreement: false,
      driverParticipantId: "codex-main",
      subscriptions: { codex: { providerId: "codex" } },
    });
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain("rawAppServerPayload");
    expect(
      normalizeMultiFrontierRendererState({
        collaborationId: "collab-1",
        phase: "implementing",
        round: 2,
        autoContinueAfterAgreement: "yes",
        participants: RENDERER_PARTICIPANTS,
        driverParticipantId: "codex-main",
        driverGeneration: 4,
        approvalState: "approved",
      }),
    ).toBeNull();
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("private@example.invalid");
    expect(serialized).not.toContain("org-private");
    expect(serialized).not.toContain("Private organization");
  });

  it("rejects malformed roster and concurrent write presentation", () => {
    expect(
      normalizeMultiFrontierRendererState({
        collaborationId: "collab-1",
        phase: "implementing",
        round: 1,
        participants: [
          RENDERER_PARTICIPANTS[0],
          { ...RENDERER_PARTICIPANTS[1], permission: "workspace_write" },
        ],
        approvalState: "approved",
      }),
    ).toBeNull();
    expect(
      normalizeMultiFrontierRendererState({
        collaborationId: "collab-1",
        phase: "implementing",
        round: 1,
        participants: [RENDERER_PARTICIPANTS[0]],
        approvalState: "approved",
      }),
    ).toBeNull();
  });

  it("rejects contradictory driver snapshots while preserving paused recovery", () => {
    expect(
      normalizeMultiFrontierRendererState({
        collaborationId: "collab-1",
        phase: "implementing",
        round: 1,
        participants: RENDERER_PARTICIPANTS,
        approvalState: "approved",
      }),
    ).toBeNull();
    expect(
      normalizeMultiFrontierRendererState({
        collaborationId: "collab-1",
        phase: "implementing",
        round: 1,
        participants: RENDERER_PARTICIPANTS,
        driverParticipantId: "codex-main",
        driverGeneration: 0,
        approvalState: "approved",
      }),
    ).toBeNull();
    expect(
      normalizeMultiFrontierRendererState({
        collaborationId: "collab-1",
        phase: "awaiting_go",
        round: 1,
        participants: RENDERER_PARTICIPANTS.map((participant) => ({
          ...participant,
          role: "watchdog",
          permission: "read_only",
        })),
        approvalState: "approved",
      }),
    ).toBeNull();
    expect(
      normalizeMultiFrontierRendererState({
        collaborationId: "collab-1",
        phase: "paused",
        round: 1,
        participants: RENDERER_PARTICIPANTS.map((participant) => ({
          ...participant,
          role: "watchdog",
          permission: "read_only",
        })),
        approvalState: "pending",
      }),
    ).toMatchObject({ phase: "paused", approvalState: "pending" });
  });

  it("drops raw app-server fields and redacts credential-shaped public text", () => {
    const result = normalizeMultiFrontierProviderResult({
      schemaVersion: 1,
      requestId: "provider-1",
      providerId: "codex",
      status: {
        schemaVersion: 1,
        providerId: "codex",
        connectionState: "error",
        telemetry: {
          state: "error",
          source: "codex-app-server",
          capabilities: {},
          meters: [],
          error: { message: "authorization: Bearer secret-token" },
          appServer: { tokens: { access_token: "not-for-renderer" } },
        },
      },
      process: { env: { AUTH_TOKEN: "not-for-renderer" } },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("appServer");
    expect(serialized).not.toContain("AUTH_TOKEN");
  });

  it("keeps snapshot and event identity/ordering and rejects oversized event text", () => {
    const event = normalizeMultiFrontierIpcEvent({
      schemaVersion: 1,
      type: "event",
      collaborationId: "collab-1",
      sequence: 42,
      event: {
        kind: "participant",
        participantId: "claude-main",
        text: "Reviewed checkpoint 2.",
      },
    });
    expect(event).toMatchObject({
      sequence: 42,
      event: { participantId: "claude-main" },
    });
    expect(
      normalizeMultiFrontierIpcEvent({
        schemaVersion: 1,
        type: "event",
        collaborationId: "collab-1",
        sequence: 43,
        event: {
          kind: "notice",
          text: "x".repeat(MULTI_FRONTIER_IPC_MAX_EVENT_TEXT_BYTES + 1),
        },
      }),
    ).toBeNull();
  });

  it("uses bounded readable fallback text for unknown metadata", () => {
    expect(
      formatUnknownMultiFrontierMetadata({ version: 99, payload: "ignored" }),
    ).toBe("Unrecognized multi-frontier metadata.");
    expect(formatUnknownMultiFrontierMetadata("A plain legacy event.")).toBe(
      "A plain legacy event.",
    );
  });
});
