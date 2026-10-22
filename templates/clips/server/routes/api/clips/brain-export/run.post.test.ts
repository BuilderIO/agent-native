import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReapExpiredUploads,
  mockRunTransactionalEmailsOnce,
  mockRunBrainExportSweepOnce,
} = vi.hoisted(() => ({
  mockReapExpiredUploads: vi.fn(),
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
    expect(mockRunTransactionalEmailsOnce).toHaveBeenCalledOnce();
    expect(mockRunBrainExportSweepOnce).toHaveBeenCalledOnce();
  });
});
