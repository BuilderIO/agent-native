import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/sharing", async (original) => ({
  ...(await original<typeof import("@agent-native/core/sharing")>()),
  assertAccess: mocks.assertAccess,
}));

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(async () => ({
    role: "editor",
    resource: { expiresAt: null },
  })),
  compareAndSetManyAppState: vi.fn(async () => true),
  readAppState: vi.fn(async () => null as Record<string, unknown> | null),
  writeAppState: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/server", () => ({
  resolveChatModelAvailability: async () => "available",
}));

vi.mock("@agent-native/core/application-state", () => ({
  compareAndSetManyAppState: mocks.compareAndSetManyAppState,
  readAppState: mocks.readAppState,
  writeAppState: mocks.writeAppState,
}));

import {
  queueAiRequest,
  withAiRequestStatusInstructions,
} from "./ai-request-status";

describe("AI request status lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAccess.mockResolvedValue({
      role: "editor",
      resource: { expiresAt: null },
    });
    mocks.compareAndSetManyAppState.mockResolvedValue(true);
    mocks.readAppState.mockReset();
    mocks.readAppState.mockResolvedValue(null);
    mocks.writeAppState.mockResolvedValue(undefined);
  });

  it("rejects unauthorized automatic requests before reading their state", async () => {
    mocks.assertAccess.mockRejectedValueOnce(new Error("forbidden"));
    await expect(
      queueAiRequest({
        recordingId: "rec_123",
        kind: "regenerate-title",
        requestedAt: "2026-09-04T12:00:00.000Z",
        request: {},
        automaticTitle: true,
      }),
    ).rejects.toThrow("forbidden");
    expect(mocks.readAppState).not.toHaveBeenCalled();
  });

  it.each(["regenerate-title", "generate-metadata"] as const)(
    "suppresses automatic %s after a previous terminal failure",
    async (kind) => {
      mocks.readAppState.mockImplementation(async (key: string) =>
        key === "clips-ai-title-terminal-rec_123"
          ? { suppressed: true, status: "failed" }
          : null,
      );
      await expect(
        queueAiRequest({
          recordingId: "rec_123",
          kind,
          requestedAt: "2026-09-04T12:00:00.000Z",
          request: { kind },
          automaticTitle: true,
        }),
      ).rejects.toMatchObject({ errorCode: "title_request_unsuccessful" });
      expect(mocks.compareAndSetManyAppState).not.toHaveBeenCalled();
    },
  );

  it("does not revive a failure superseded by a manual title success", async () => {
    const status = {
      kind: "regenerate-title",
      status: "failed",
      requestedAt: "old",
    };
    const marker = { suppressed: false, supersededStatus: status };
    mocks.readAppState.mockImplementation(async (key: string) =>
      key === "clips-ai-title-terminal-rec_123"
        ? marker
        : key === "clips-ai-request-status-rec_123"
          ? status
          : null,
    );
    await expect(
      queueAiRequest({
        recordingId: "rec_123",
        kind: "regenerate-title",
        requestedAt: "2026-09-04T12:00:00.000Z",
        request: { transcriptRevision: "current" },
        automaticTitle: true,
      }),
    ).resolves.toBeUndefined();
    expect(mocks.compareAndSetManyAppState).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          key: "clips-ai-title-terminal-rec_123",
          expectedValue: marker,
          nextValue: marker,
        },
      ]),
    );
  });

  it("allows automatic title generation for a newer transcript revision", async () => {
    mocks.readAppState.mockImplementation(async (key: string) =>
      key === "clips-ai-title-terminal-rec_123"
        ? { suppressed: true, status: "failed", transcriptRevision: "old" }
        : null,
    );
    await expect(
      queueAiRequest({
        recordingId: "rec_123",
        kind: "regenerate-title",
        requestedAt: "2026-09-04T12:00:00.000Z",
        request: { transcriptRevision: "new" },
        automaticTitle: true,
      }),
    ).resolves.toBeUndefined();
  });

  it.each(["failed", "truncated", "cancelled"])(
    "preserves legacy %s before unrelated work replaces its status",
    async (status) => {
      const legacy = {
        kind: "generate-metadata",
        status,
        requestedAt: "2026-09-04T11:00:00.000Z",
      };
      mocks.readAppState.mockImplementation(async (key: string) =>
        key === "clips-ai-request-status-rec_123" ? legacy : null,
      );
      await queueAiRequest({
        recordingId: "rec_123",
        kind: "regenerate-summary",
        requestedAt: "2026-09-04T12:00:00.000Z",
        request: { kind: "regenerate-summary" },
      });
      expect(mocks.compareAndSetManyAppState).toHaveBeenCalledWith(
        expect.arrayContaining([
          {
            key: "clips-ai-title-terminal-rec_123",
            expectedValue: null,
            nextValue: { ...legacy, suppressed: true },
          },
        ]),
      );
    },
  );

  it("preserves the latest legacy failure instead of an older marker", async () => {
    const old = {
      suppressed: true,
      requestedAt: "old",
      transcriptRevision: "old-revision",
    };
    const latest = {
      kind: "regenerate-title",
      status: "failed",
      requestedAt: "new",
    };
    mocks.readAppState.mockImplementation(async (key: string) =>
      key === "clips-ai-title-terminal-rec_123"
        ? old
        : key === "clips-ai-request-status-rec_123"
          ? latest
          : null,
    );
    await queueAiRequest({
      recordingId: "rec_123",
      kind: "regenerate-summary",
      requestedAt: "2026-09-04T12:00:00.000Z",
      request: {},
    });
    expect(mocks.compareAndSetManyAppState).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          key: "clips-ai-title-terminal-rec_123",
          expectedValue: old,
          nextValue: { ...latest, suppressed: true },
        },
      ]),
    );
  });

  it("allows manual title retries without clearing the failure marker", async () => {
    const marker = { suppressed: true, status: "failed" };
    mocks.readAppState.mockImplementation(async (key: string) =>
      key === "clips-ai-title-terminal-rec_123" ? marker : null,
    );
    await queueAiRequest({
      recordingId: "rec_123",
      kind: "regenerate-title",
      requestedAt: "2026-09-04T12:00:00.000Z",
      request: { kind: "regenerate-title" },
    });
    expect(mocks.compareAndSetManyAppState).toHaveBeenCalledWith([
      expect.objectContaining({ key: "clips-ai-request-status-rec_123" }),
      expect.objectContaining({ key: "clips-ai-request-rec_123" }),
    ]);
  });

  it("rechecks a terminal outcome that wins the automatic enqueue race", async () => {
    let raced = false;
    mocks.readAppState.mockImplementation(async (key: string) =>
      key === "clips-ai-title-terminal-rec_123" && raced
        ? { suppressed: true, status: "failed" }
        : null,
    );
    mocks.compareAndSetManyAppState.mockImplementationOnce(async () => {
      raced = true;
      return false;
    });
    await expect(
      queueAiRequest({
        recordingId: "rec_123",
        kind: "regenerate-title",
        requestedAt: "2026-09-04T12:00:00.000Z",
        request: { kind: "regenerate-title" },
        automaticTitle: true,
      }),
    ).rejects.toMatchObject({ errorCode: "title_request_unsuccessful" });
    expect(mocks.compareAndSetManyAppState).toHaveBeenCalledOnce();
    expect(mocks.compareAndSetManyAppState).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          key: "clips-ai-title-terminal-rec_123",
          expectedValue: null,
          nextValue: { suppressed: false },
        },
      ]),
    );
  });

  it("retries an ordinary enqueue conflict when no terminal outcome appeared", async () => {
    mocks.compareAndSetManyAppState
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await expect(
      queueAiRequest({
        recordingId: "rec_123",
        kind: "generate-metadata",
        requestedAt: "2026-09-04T12:00:00.000Z",
        request: { kind: "generate-metadata" },
        automaticTitle: true,
      }),
    ).resolves.toBeUndefined();
    expect(mocks.compareAndSetManyAppState).toHaveBeenCalledTimes(2);
  });

  it("queues status before the request and tells the agent to close the lifecycle", async () => {
    const message = withAiRequestStatusInstructions({
      message: "Remove the filler words.",
      recordingId: "rec_123",
      kind: "remove-filler-words",
      requestedAt: "2026-09-04T12:00:00.000Z",
    });

    await queueAiRequest({
      recordingId: "rec_123",
      kind: "remove-filler-words",
      requestedAt: "2026-09-04T12:00:00.000Z",
      request: { kind: "remove-filler-words", message },
    });

    expect(mocks.compareAndSetManyAppState).toHaveBeenCalledWith([
      {
        key: "clips-ai-request-status-rec_123",
        expectedValue: null,
        nextValue: {
          kind: "remove-filler-words",
          status: "queued",
          message: null,
          requestedAt: "2026-09-04T12:00:00.000Z",
          updatedAt: "2026-09-04T12:00:00.000Z",
        },
      },
      {
        key: "clips-ai-request-rec_123",
        expectedValue: null,
        nextValue: expect.objectContaining({ message }),
      },
    ]);
    expect(mocks.writeAppState).toHaveBeenCalledWith("refresh-signal", {
      ts: expect.any(Number),
    });
    expect(message).toContain("--status=working");
    expect(message).toContain("--status=completed");
    expect(message).toContain("--status=failed");
    expect(message).toContain('--requestedAt="2026-09-04T12:00:00.000Z"');
  });

  it("surfaces a failed atomic enqueue without replacing request status", async () => {
    mocks.compareAndSetManyAppState.mockRejectedValueOnce(
      new Error("request write failed"),
    );

    await expect(
      queueAiRequest({
        recordingId: "rec_123",
        kind: "remove-silences",
        requestedAt: "2026-09-04T12:00:00.000Z",
        request: { kind: "remove-silences" },
      }),
    ).rejects.toThrow("request write failed");

    expect(mocks.writeAppState).not.toHaveBeenCalledWith(
      "clips-ai-request-status-rec_123",
      expect.anything(),
    );
  });

  it("does not let a generic request replace an active filler session status", async () => {
    const statusKey = "clips-ai-request-status-rec_123";
    mocks.readAppState.mockImplementation(async (key: string) =>
      key === statusKey
        ? {
            kind: "remove-filler-words",
            status: "working",
            requestedAt: "2026-09-04T12:00:00.000Z",
            operationId: "active-operation",
          }
        : {
            kind: "remove-filler-words",
            recordingId: "rec_123",
            requestedAt: "2026-09-04T12:00:00.000Z",
          },
    );

    await expect(
      queueAiRequest({
        recordingId: "rec_123",
        kind: "regenerate-summary",
        requestedAt: "2026-09-04T12:01:00.000Z",
        request: { kind: "regenerate-summary" },
      }),
    ).rejects.toThrow("A remove-filler-words request is already running");

    expect(mocks.compareAndSetManyAppState).not.toHaveBeenCalled();
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });

  it("keeps a durable request queued when the refresh signal fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.writeAppState.mockRejectedValueOnce(
      new Error("refresh write failed"),
    );

    await expect(
      queueAiRequest({
        recordingId: "rec_123",
        kind: "remove-silences",
        requestedAt: "2026-09-04T12:00:00.000Z",
        request: { kind: "remove-silences" },
      }),
    ).resolves.toBeUndefined();

    expect(mocks.compareAndSetManyAppState).toHaveBeenCalledOnce();
    expect(mocks.writeAppState).toHaveBeenCalledOnce();
    expect(mocks.writeAppState).not.toHaveBeenCalledWith(
      "clips-ai-request-status-rec_123",
      expect.objectContaining({ status: "failed" }),
    );
    expect(warn).toHaveBeenCalledWith(
      "[clips] failed to publish AI request refresh signal",
      expect.objectContaining({
        recordingId: "rec_123",
        kind: "remove-silences",
        error: expect.any(Error),
      }),
    );
    warn.mockRestore();
  });
});
