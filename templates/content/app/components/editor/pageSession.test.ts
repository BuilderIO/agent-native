import { describe, expect, it, vi } from "vitest";

import { savePageWithRecovery } from "./pageSession";

describe("savePageWithRecovery", () => {
  it("retains a rejected primary edit before surfacing the failure", async () => {
    const retain = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);

    await expect(
      savePageWithRecovery({
        save: () => Promise.reject(new Error("offline")),
        retain,
        clear,
      }),
    ).rejects.toThrow("offline");
    expect(retain).toHaveBeenCalledWith(null);
    expect(clear).not.toHaveBeenCalled();
  });

  it("retains a conflict-blocked primary edit without reporting success", async () => {
    const retain = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);

    await expect(
      savePageWithRecovery({
        save: () => Promise.resolve({ contentPersisted: false }),
        retain,
        clear,
      }),
    ).resolves.toEqual({ contentPersisted: false });
    expect(retain).toHaveBeenCalledWith("conflict");
    expect(clear).not.toHaveBeenCalled();
  });

  it("clears a retained draft only after the primary edit persists", async () => {
    const retain = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);

    await expect(
      savePageWithRecovery({
        save: () => Promise.resolve({ contentPersisted: true }),
        retain,
        clear,
      }),
    ).resolves.toEqual({ contentPersisted: true });
    expect(clear).toHaveBeenCalledOnce();
    expect(retain).not.toHaveBeenCalled();
  });

  it("does not create a recovery draft when cleanup fails after persistence", async () => {
    const retain = vi.fn().mockResolvedValue(undefined);

    await expect(
      savePageWithRecovery({
        save: () => Promise.resolve({ contentPersisted: true }),
        retain,
        clear: () => Promise.reject(new Error("cleanup conflict")),
      }),
    ).rejects.toThrow("cleanup conflict");
    expect(retain).not.toHaveBeenCalled();
  });
});
