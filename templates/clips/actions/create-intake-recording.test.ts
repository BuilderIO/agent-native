import { ActionContractError } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  release: vi.fn(),
  create: vi.fn(),
  trash: vi.fn(),
  findSession: vi.fn(),
  findRecoverable: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: (action: unknown) => action,
}));
vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: async (_context: unknown, run: () => unknown) => run(),
}));
vi.mock("../server/lib/clip-intake.js", () => ({
  abandonClipIntake: vi.fn(),
  attachClipIntakeRecording: vi.fn(),
  claimClipIntakeRecording: (...args: unknown[]) => mocks.claim(...args),
  findClipIntakeSession: (...args: unknown[]) => mocks.findSession(...args),
  findRecoverableClipIntakeRecording: (...args: unknown[]) =>
    mocks.findRecoverable(...args),
  releaseClipIntakeCreation: (...args: unknown[]) => mocks.release(...args),
}));
vi.mock("../server/lib/resumable-session.js", () => ({
  getResumableSession: vi.fn(),
}));
vi.mock("./create-recording.js", () => ({
  default: { run: (...args: unknown[]) => mocks.create(...args) },
}));
vi.mock("./save-bug-report-context.js", () => ({
  default: { run: vi.fn() },
}));
vi.mock("./trash-recording.js", () => ({
  default: { run: (...args: unknown[]) => mocks.trash(...args) },
}));

import createIntakeRecording from "./create-intake-recording";

const action = createIntakeRecording as unknown as {
  run: (args: Record<string, unknown>) => Promise<unknown>;
};

describe("create-intake-recording", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.claim.mockResolvedValue({
      ownerEmail: "owner@example.com",
      organizationId: "org-1",
    });
    mocks.release.mockResolvedValue(undefined);
    mocks.trash.mockResolvedValue({ id: "rec-1", skipped: false });
    mocks.findSession.mockResolvedValue(null);
    mocks.findRecoverable.mockResolvedValue(null);
  });

  it("trashes a failed row before reopening a retryable intake", async () => {
    mocks.create.mockRejectedValue(
      new ActionContractError("Storage is temporarily unavailable.", {
        errorCode: "hosted_storage_unavailable",
        statusCode: 503,
        details: {
          recordingId: "rec-1",
          retryable: true,
          cleanupConfirmed: true,
        },
      }),
    );

    const failure = await action
      .run({
        intakeId: "intake-id-long-enough",
        intakeToken: "token",
        recordingPlatform: "web",
      })
      .then(
        () => {
          throw new Error("Expected create-intake-recording to fail.");
        },
        (error: unknown) => error,
      );

    expect(failure).toMatchObject({
      actionContractError: true,
      errorCode: "hosted_storage_unavailable",
      statusCode: 503,
      details: { retryable: true },
    });
    expect(failure).not.toHaveProperty("details.recordingId");

    expect(mocks.trash).toHaveBeenCalledWith(
      { id: "rec-1", skipIfReady: true },
      {
        caller: "http",
        userEmail: "owner@example.com",
        orgId: "org-1",
      },
    );
    expect(mocks.trash.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.release.mock.invocationCallOrder[0],
    );
  });

  it("keeps the intake claimed if the failed row cannot be trashed", async () => {
    mocks.create.mockRejectedValue(
      new ActionContractError("Storage is temporarily unavailable.", {
        errorCode: "hosted_storage_unavailable",
        statusCode: 503,
        details: {
          recordingId: "rec-1",
          retryable: true,
          cleanupConfirmed: true,
        },
      }),
    );
    mocks.trash.mockRejectedValue(new Error("cleanup failed"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      action.run({
        intakeId: "intake-id-long-enough",
        intakeToken: "token",
        recordingPlatform: "web",
      }),
    ).rejects.toMatchObject({
      errorCode: "hosted_storage_unavailable",
      details: { retryable: false },
    });
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("does not mark a retryable failure safe when it has no row id", async () => {
    mocks.create.mockRejectedValue(
      new ActionContractError("Storage is temporarily unavailable.", {
        errorCode: "hosted_storage_unavailable",
        statusCode: 503,
        details: { retryable: true },
      }),
    );

    await expect(
      action.run({
        intakeId: "intake-id-long-enough",
        intakeToken: "token",
        recordingPlatform: "web",
      }),
    ).rejects.toMatchObject({
      errorCode: "hosted_storage_unavailable",
      details: { retryable: false },
    });
    expect(mocks.trash).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("keeps the intake claimed when upload cleanup was not confirmed", async () => {
    mocks.create.mockRejectedValue(
      new ActionContractError("Storage could not start an upload.", {
        errorCode: "multipart_start_failed",
        statusCode: 503,
        details: {
          recordingId: "rec-1",
          retryable: false,
          cleanupConfirmed: false,
        },
      }),
    );

    await expect(
      action.run({
        intakeId: "intake-id-long-enough",
        intakeToken: "token",
        recordingPlatform: "web",
      }),
    ).rejects.toMatchObject({
      errorCode: "multipart_start_failed",
      details: { retryable: false },
    });
    expect(mocks.trash).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("keeps the intake claimed when create returns an untyped error", async () => {
    mocks.create.mockRejectedValue(new Error("Unknown create failure"));

    await expect(
      action.run({
        intakeId: "intake-id-long-enough",
        intakeToken: "token",
        recordingPlatform: "web",
      }),
    ).rejects.toThrow("Unknown create failure");
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("retries a concurrent request while its intake is still being created", async () => {
    mocks.claim.mockResolvedValue(null);
    mocks.findSession.mockResolvedValue({ status: "creating" });

    await expect(
      action.run({
        intakeId: "intake-id-long-enough",
        intakeToken: "token",
        recordingPlatform: "web",
      }),
    ).rejects.toMatchObject({
      errorCode: "intake_creation_in_progress",
      statusCode: 409,
      details: { retryable: true },
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
