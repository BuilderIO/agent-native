import { describe, expect, it, vi } from "vitest";

import {
  mayClearRecoveryDraft,
  ownRecoveryDraftSupersededBySave,
  savePageWithRecovery,
} from "./pageSession";

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
    expect(retain).toHaveBeenCalledWith("conflict", {
      contentPersisted: false,
    });
    expect(clear).not.toHaveBeenCalled();
  });

  it("leaves a superseded queued save to its newer local generation", async () => {
    const retain = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);

    await expect(
      savePageWithRecovery({
        save: () =>
          Promise.resolve({
            contentPersisted: false,
            outcome: "superseded",
          }),
        retain,
        clear,
      }),
    ).resolves.toEqual({
      contentPersisted: false,
      outcome: "superseded",
    });
    expect(retain).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it("leaves a superseded queued save to its newer local generation", async () => {
    const retain = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);

    await expect(
      savePageWithRecovery({
        save: () =>
          Promise.resolve({
            contentPersisted: false,
            outcome: "superseded",
          }),
        retain,
        clear,
      }),
    ).resolves.toEqual({
      contentPersisted: false,
      outcome: "superseded",
    });
    expect(retain).not.toHaveBeenCalled();
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

describe("recovery draft cleanup", () => {
  it("preserves a conflict draft after a no-op save of the winning server content", async () => {
    const draft = { title: "Page", content: "My conflicting edit" };
    const remove = vi.fn();
    await savePageWithRecovery({
      save: async () => ({ contentPersisted: true }),
      retain: vi.fn(),
      clear: async () => {
        if (
          mayClearRecoveryDraft(draft, {
            title: "Page",
            content: "Winning server edit",
          })
        )
          remove();
      },
    });
    expect(remove).not.toHaveBeenCalled();
    expect(mayClearRecoveryDraft(draft, { ...draft })).toBe(true);
    expect(
      mayClearRecoveryDraft(draft, { ...draft, title: "Another title" }),
    ).toBe(false);
  });
});

describe("own recovery draft supersession", () => {
  const save = { editorSessionId: "live", editGeneration: 40 };
  const draft = {
    editorSessionId: "live",
    editGeneration: 32,
    supersedable: true,
  };

  it("clears a draft from an earlier unsaved attempt once a later own save lands", () => {
    expect(ownRecoveryDraftSupersededBySave(draft, save)).toBe(true);
    expect(
      ownRecoveryDraftSupersededBySave(draft, { ...save, editGeneration: 32 }),
    ).toBe(true);
  });

  it("keeps drafts from newer generations, other sessions, and conflicts or displaced text", () => {
    expect(
      ownRecoveryDraftSupersededBySave({ ...draft, editGeneration: 41 }, save),
    ).toBe(false);
    expect(
      ownRecoveryDraftSupersededBySave(
        { ...draft, editorSessionId: "other-tab" },
        save,
      ),
    ).toBe(false);
    expect(
      ownRecoveryDraftSupersededBySave({ ...draft, supersedable: false }, save),
    ).toBe(false);
    expect(
      ownRecoveryDraftSupersededBySave(
        { ...draft, editGeneration: null },
        save,
      ),
    ).toBe(false);
  });
});
