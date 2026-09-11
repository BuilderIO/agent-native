// @vitest-environment happy-dom

import type { Document } from "@shared/api";
import { describe, expect, it, vi } from "vitest";

import { saveDocumentWithRebase } from "./document-save-rebase";

const original = "Writers inspect changes.\nReaders retain context.";
const accepted = "Writers review changes.\nReaders retain context.";
const draft = `${accepted} Peer suffix.`;
const base = { content: original, updatedAt: "2026-09-09T00:00:01.000Z" };
const winner = {
  content: accepted,
  updatedAt: "2026-09-09T00:00:02.000Z",
} as Document;

describe("document save ownership after a rejected CAS", () => {
  it("retries an already-shared acceptance plus local suffix against the winner", async () => {
    const persisted = {
      ...winner,
      content: draft,
      updatedAt: "2026-09-09T00:00:03.000Z",
    };
    const persist = vi
      .fn()
      .mockResolvedValueOnce({ conflict: true, document: winner })
      .mockResolvedValueOnce(persisted);
    const result = await saveDocumentWithRebase({
      base,
      content: draft,
      persist,
    });
    expect(persist).toHaveBeenNthCalledWith(1, draft, base);
    expect(persist).toHaveBeenNthCalledWith(2, draft, {
      content: accepted,
      updatedAt: winner.updatedAt,
    });
    expect(result).toEqual({
      status: "saved",
      document: persisted,
      content: draft,
    });
  });

  it("preserves a genuine overlapping draft without retrying", async () => {
    const localDraft = original.replace("inspect", "discuss");
    const persist = vi
      .fn()
      .mockResolvedValue({ conflict: true, document: winner });
    await expect(
      saveDocumentWithRebase({ base, content: localDraft, persist }),
    ).resolves.toEqual({ status: "conflict", localDraft });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("preserves the draft until a server-only change reaches the live editor", async () => {
    const localDraft = `${original} Peer suffix.`;
    const persist = vi
      .fn()
      .mockResolvedValue({ conflict: true, document: winner });
    await expect(
      saveDocumentWithRebase({ base, content: localDraft, persist }),
    ).resolves.toEqual({ status: "conflict", localDraft });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("does not mistake matching content for confirmation of an unsaved title", async () => {
    const document = { ...winner, content: draft, title: "Old title" };
    const saved = { ...document, title: "New title" };
    const persist = vi
      .fn()
      .mockResolvedValueOnce({ conflict: true, document })
      .mockResolvedValueOnce(saved);
    await expect(
      saveDocumentWithRebase({
        base,
        content: draft,
        persist,
        confirmsWrite: (current) => current.title === "New title",
      }),
    ).resolves.toEqual({ status: "saved", document: saved, content: draft });
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("acknowledges a winner already equal to the draft without another write", async () => {
    const document = { ...winner, content: draft };
    const persist = vi.fn().mockResolvedValue({ conflict: true, document });
    await expect(
      saveDocumentWithRebase({ base, content: draft, persist }),
    ).resolves.toEqual({ status: "saved", document, content: draft });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("bounds concurrent winner retries and preserves the unsaved draft", async () => {
    const persist = vi.fn().mockImplementation(async () => ({
      conflict: true,
      document: {
        ...winner,
        updatedAt: `2026-09-09T00:00:0${persist.mock.calls.length + 1}.000Z`,
      },
    }));
    await expect(
      saveDocumentWithRebase({ base, content: draft, persist }),
    ).resolves.toEqual({ status: "conflict", localDraft: draft });
    expect(persist).toHaveBeenCalledTimes(3);
  });

  it.each(["unknown-base", "changed-title"])(
    "does not retry with %s",
    async (reason) => {
      const persist = vi
        .fn()
        .mockResolvedValue({ conflict: true, document: winner });
      await expect(
        saveDocumentWithRebase({
          base: reason === "unknown-base" ? { ...base, updatedAt: null } : base,
          content: draft,
          persist,
          canRetry: () => reason !== "changed-title",
        }),
      ).resolves.toEqual({ status: "conflict", localDraft: draft });
      expect(persist).toHaveBeenCalledTimes(1);
    },
  );

  it.each([true, false])(
    "retains newer typing while an older save settles (safe retry: %s)",
    async (safe) => {
      const submitted = safe ? draft : original.replace("inspect", "discuss");
      let current = { version: 1, content: submitted };
      let release!: (value: unknown) => void;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const confirm = vi.fn((content: string) => {
        current = { ...current, content };
      });
      const persist = vi
        .fn()
        .mockImplementationOnce(() => gate)
        .mockResolvedValue({ ...winner, content: submitted });
      const pending = saveDocumentWithRebase({
        base,
        content: submitted,
        persist,
        owner: { version: 1, current: () => current, confirm },
      });
      const newest = `${submitted} Newer typing.`;
      current = { version: 2, content: newest };
      release({ conflict: true, document: winner });
      const result = await pending;
      expect(confirm).not.toHaveBeenCalled();
      expect(current.content).toBe(newest);
      if (safe) expect(result.status).toBe("saved");
      else expect(result).toEqual({ status: "conflict", localDraft: newest });
    },
  );
});
