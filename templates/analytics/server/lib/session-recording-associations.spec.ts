import { describe, expect, it, vi } from "vitest";

import { sessionRecordingAssociationsReady } from "./session-recording-associations.js";

describe("session recording association table readiness", () => {
  it("rechecks after a missing table and caches a positive result per database", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ table_name: null }] })
      .mockResolvedValueOnce({
        rows: [{ table_name: "public.session_recording_session_associations" }],
      });
    const db = { execute };

    await expect(sessionRecordingAssociationsReady(db)).resolves.toBe(false);
    await expect(sessionRecordingAssociationsReady(db)).resolves.toBe(true);
    await expect(sessionRecordingAssociationsReady(db)).resolves.toBe(true);

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("does not reuse readiness from another database", async () => {
    const firstDb = {
      execute: vi
        .fn()
        .mockResolvedValue({ rows: [{ table_name: "public.associations" }] }),
    };
    const secondDb = {
      execute: vi.fn().mockResolvedValue({ rows: [{ table_name: null }] }),
    };

    await expect(sessionRecordingAssociationsReady(firstDb)).resolves.toBe(
      true,
    );
    await expect(sessionRecordingAssociationsReady(secondDb)).resolves.toBe(
      false,
    );
    expect(secondDb.execute).toHaveBeenCalledOnce();
  });

  it("fails loudly when Postgres returns no table-existence row", async () => {
    await expect(
      sessionRecordingAssociationsReady({
        execute: vi.fn().mockResolvedValue({ rows: [] }),
      }),
    ).rejects.toThrow(
      "Postgres table existence check returned an invalid value",
    );
  });
});
