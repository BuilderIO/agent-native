import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReapExpiredUploads,
  mockRecoverIdleTrackUploads,
  mockRunTransactionalEmailsOnce,
  mockRunBrainExportSweepOnce,
} = vi.hoisted(() => ({
  mockReapExpiredUploads: vi.fn(),
  mockRecoverIdleTrackUploads: vi.fn(),
  mockRunTransactionalEmailsOnce: vi.fn(),
  mockRunBrainExportSweepOnce: vi.fn(),
}));

vi.mock("../../../../jobs/brain-export.js", () => ({
  runBrainExportSweepOnce: (...args: unknown[]) =>
    mockRunBrainExportSweepOnce(...args),
}));
vi.mock("../../../../jobs/transactional-emails.js", () => ({
  runTransactionalEmailsOnce: (...args: unknown[]) =>
    mockRunTransactionalEmailsOnce(...args),
}));
vi.mock("../../../../lib/rich-track-recovery.js", () => ({
  recoverIdleTrackUploads: (...args: unknown[]) =>
    mockRecoverIdleTrackUploads(...args),
}));
vi.mock("../../../../lib/upload-lease.js", () => ({
  reapExpiredUploads: (...args: unknown[]) => mockReapExpiredUploads(...args),
}));

import handler from "./run.post.js";

describe("scheduled Clips jobs route", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "__AGENT_NATIVE_CLIPS_BRAIN_EXPORT_SCHEDULED_RUNTIME__",
      true,
    );
    mockReapExpiredUploads.mockResolvedValue({ expired: [] });
    mockRecoverIdleTrackUploads.mockResolvedValue({
      recovered: 0,
      discarded: 0,
      failed: 0,
    });
    mockRunTransactionalEmailsOnce.mockResolvedValue({ sent: 1 });
    mockRunBrainExportSweepOnce.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("runs unrelated sweeps before returning an upload reaper failure", async () => {
    mockReapExpiredUploads.mockRejectedValueOnce(
      new Error("meeting dispatch unavailable"),
    );

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: "One or more scheduled Clips jobs failed",
    });

    expect(mockReapExpiredUploads).toHaveBeenCalledOnce();
    expect(mockRecoverIdleTrackUploads).toHaveBeenCalledOnce();
    expect(mockRunTransactionalEmailsOnce).toHaveBeenCalledOnce();
    expect(mockRunBrainExportSweepOnce).toHaveBeenCalledOnce();
  });

  it("fails the run when track recovery fails, after the other sweeps", async () => {
    mockRecoverIdleTrackUploads.mockRejectedValueOnce(
      new Error("app state unavailable"),
    );

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 500,
    });

    expect(mockReapExpiredUploads).toHaveBeenCalledOnce();
    expect(mockRunBrainExportSweepOnce).toHaveBeenCalledOnce();
  });

  it("reports what track recovery did", async () => {
    mockRecoverIdleTrackUploads.mockResolvedValueOnce({
      recovered: 2,
      discarded: 1,
      failed: 0,
    });

    await expect(handler({} as never)).resolves.toMatchObject({
      ok: true,
      tracks: { recovered: 2, discarded: 1, failed: 0 },
    });
  });
});
