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
  it("drops a settled editor generation without retrying or confirming it", async () => {
    const confirm = vi.fn();
    const persist = vi.fn().mockResolvedValue({
      superseded: true,
      id: "page",
      document: winner,
      editorSessionId: "tab-one",
      editGeneration: 4,
      discardedGeneration: 4,
    });

    await expect(
      saveDocumentWithRebase({
        base,
        content: draft,
        persist,
        owner: {
          version: 1,
          current: () => ({ version: 1, content: draft }),
          canPreferLive: () => true,
          confirm,
        },
      }),
    ).resolves.toEqual({ status: "superseded", document: winner });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("keeps a server-preserved edit pending rather than confirming it as saved", async () => {
    const confirm = vi.fn();
    const persist = vi.fn().mockResolvedValue({
      preservationRequired: true,
      id: "page",
      document: winner,
      reason: "provenance",
      checkpointId: "recovery-version",
    });
    await expect(
      saveDocumentWithRebase({
        base,
        content: draft,
        persist,
        owner: {
          version: 1,
          current: () => ({ version: 1, content: draft }),
          canPreferLive: () => true,
          confirm,
        },
      }),
    ).resolves.toEqual({
      status: "preservation",
      localDraft: draft,
      base,
      checkpointId: "recovery-version",
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledTimes(1);
  });

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

  it("retries a genuine overlap with the later local intent", async () => {
    const localDraft = original.replace("inspect", "discuss");
    const saved = {
      ...winner,
      content: localDraft,
      updatedAt: "2026-09-09T00:00:03.000Z",
    };
    const persist = vi
      .fn()
      .mockResolvedValueOnce({ conflict: true, document: winner })
      .mockResolvedValueOnce(saved);
    const confirm = vi.fn();
    await expect(
      saveDocumentWithRebase({
        base,
        content: localDraft,
        persist,
        owner: {
          version: 1,
          current: () => ({ version: 1, content: localDraft }),
          canPreferLive: () => true,
          confirm,
        },
      }),
    ).resolves.toEqual({
      status: "saved",
      document: saved,
      content: localDraft,
    });
    expect(persist).toHaveBeenNthCalledWith(2, localDraft, {
      content: winner.content,
      updatedAt: winner.updatedAt,
    });
  });

  it("returns an unobserved overlapping edit for durable displacement", async () => {
    const localDraft = original.replace("inspect", "discuss");
    const persist = vi
      .fn()
      .mockResolvedValue({ conflict: true, document: winner });
    const confirm = vi.fn();

    await expect(
      saveDocumentWithRebase({
        base,
        content: localDraft,
        persist,
        owner: {
          version: 1,
          current: () => ({ version: 1, content: localDraft }),
          canPreferLive: () => false,
          confirm,
        },
      }),
    ).resolves.toEqual({
      status: "displaced",
      document: winner,
      localDraft,
    });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("merges independent peer and local block edits before retrying", async () => {
    const localDraft =
      "Writers inspect changes.\nReaders retain context and annotations.";
    const peerWinner = {
      ...winner,
      content: "Writers review changes.\nReaders retain context.",
    };
    const merged =
      "Writers review changes.\nReaders retain context and annotations.";
    const persisted = {
      ...peerWinner,
      content: merged,
      updatedAt: "2026-09-09T00:00:03.000Z",
    };
    const persist = vi
      .fn()
      .mockResolvedValueOnce({ conflict: true, document: peerWinner })
      .mockResolvedValueOnce(persisted);
    const confirm = vi.fn();

    await expect(
      saveDocumentWithRebase({
        base,
        content: localDraft,
        persist,
        owner: {
          version: 1,
          current: () => ({ version: 1, content: localDraft }),
          canPreferLive: () => false,
          confirm,
        },
      }),
    ).resolves.toEqual({
      status: "saved",
      document: persisted,
      content: merged,
    });
    expect(persist).toHaveBeenNthCalledWith(2, merged, {
      content: peerWinner.content,
      updatedAt: peerWinner.updatedAt,
    });
    expect(confirm).toHaveBeenCalledWith(merged);
    expect(merged.match(/Writers review changes\./g)).toHaveLength(1);
  });

  it("combines a server-only change with a local suffix before retrying", async () => {
    const localDraft = `${original} Peer suffix.`;
    const merged = `${accepted} Peer suffix.`;
    const persist = vi
      .fn()
      .mockResolvedValueOnce({ conflict: true, document: winner })
      .mockResolvedValueOnce({ ...winner, content: merged });
    await expect(
      saveDocumentWithRebase({ base, content: localDraft, persist }),
    ).resolves.toEqual({
      status: "saved",
      document: { ...winner, content: merged },
      content: merged,
    });
    expect(persist).toHaveBeenCalledTimes(2);
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
    ).resolves.toEqual({
      status: "conflict",
      localDraft: draft,
      base: {
        content: winner.content,
        updatedAt: "2026-09-09T00:00:03.000Z",
        revision: winner.revision,
      },
    });
    expect(persist).toHaveBeenCalledTimes(3);
  });

  it("retains the merged candidate when a later retry conflicts", async () => {
    const localDraft =
      "Writers inspect changes.\nReaders retain context and annotations.";
    const peerWinner = {
      ...winner,
      content: "Writers review changes.\nReaders retain context.",
    };
    const merged =
      "Writers review changes.\nReaders retain context and annotations.";
    const laterWinner = {
      ...peerWinner,
      content: "Writers publish changes.\nReaders retain context.",
      updatedAt: "2026-09-09T00:00:03.000Z",
    };
    const persist = vi
      .fn()
      .mockResolvedValueOnce({ conflict: true, document: peerWinner })
      .mockResolvedValueOnce({ conflict: true, document: laterWinner });

    await expect(
      saveDocumentWithRebase({
        base,
        content: localDraft,
        persist,
        canRetry: () => persist.mock.calls.length < 2,
      }),
    ).resolves.toEqual({
      status: "conflict",
      localDraft: merged,
      base: {
        content: peerWinner.content,
        updatedAt: peerWinner.updatedAt,
        revision: peerWinner.revision,
      },
    });
    expect(persist).toHaveBeenNthCalledWith(2, merged, {
      content: peerWinner.content,
      updatedAt: peerWinner.updatedAt,
    });
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
      ).resolves.toEqual({
        status: "conflict",
        localDraft: draft,
        base: reason === "unknown-base" ? { ...base, updatedAt: null } : base,
      });
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
        owner: {
          version: 1,
          current: () => current,
          canPreferLive: () => true,
          confirm,
        },
      });
      const newest = `${submitted} Newer typing.`;
      current = { version: 2, content: newest };
      release({ conflict: true, document: winner });
      const result = await pending;
      expect(confirm).not.toHaveBeenCalled();
      expect(current.content).toBe(newest);
      if (safe) expect(result.status).toBe("saved");
      else expect(result).toEqual({ status: "superseded", document: winner });
    },
  );
});
