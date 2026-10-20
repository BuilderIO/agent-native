import { ActionContractError } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  release: vi.fn(),
  create: vi.fn(),
  trash: vi.fn(),
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
  findClipIntakeSession: vi.fn(),
  findRecoverableClipIntakeRecording: vi.fn(),
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
  });

  it("trashes a failed row before reopening a retryable intake", async () => {
    mocks.create.mockRejectedValue(
      new ActionContractError("Storage is temporarily unavailable.", {
        errorCode: "hosted_storage_unavailable",
        statusCode: 503,
        details: { recordingId: "rec-1", retryable: true },
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

  it("marks a failure non-retryable if the failed row cannot be trashed", async () => {
    mocks.create.mockRejectedValue(
      new ActionContractError("Storage is temporarily unavailable.", {
        errorCode: "hosted_storage_unavailable",
        statusCode: 503,
        details: { recordingId: "rec-1", retryable: true },
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
  });
});
