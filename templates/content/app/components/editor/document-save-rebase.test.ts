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
  it("abandons a save before persistence when its editor session is inactive", async () => {
    const persist = vi.fn();

    await expect(
      saveDocumentWithRebase({
        base,
        content: draft,
        persist,
        canContinue: () => false,
      }),
    ).resolves.toEqual({ status: "abandoned" });
    expect(persist).not.toHaveBeenCalled();
  });

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

  it("keeps an indented empty closing line beside the agent's replacement", async () => {
    const headingBase = { ...base, content: "## Heading" };
    const localDraft = "## Heading\n\t<empty-block/>";
    const replaced = { ...winner, content: "Replacement." };
    const merged = "Replacement.\n\t<empty-block/>";
    const persist = vi
      .fn()
      .mockResolvedValueOnce({ conflict: true, document: replaced })
      .mockResolvedValueOnce({ ...replaced, content: merged });

    // oracle-change: the indented line is the tab's insertion after the
    // replaced heading, not inside it, so the agent's replacement merges
    // instead of being saved over. Read as filler, the line would be lost.
    await expect(
      saveDocumentWithRebase({
        base: headingBase,
        content: localDraft,
        persist,
        owner: {
          version: 1,
          current: () => ({ version: 1, content: localDraft }),
          canPreferLive: () => true,
          confirm: vi.fn(),
        },
      }),
    ).resolves.toMatchObject({ status: "saved", content: merged });
    expect(persist).toHaveBeenNthCalledWith(2, merged, {
      content: replaced.content,
      updatedAt: replaced.updatedAt,
    });
  });

  it("reports each merge of a save over a newer body as kept_all or set_aside", async () => {
    const owner = (localDraft: string) => ({
      version: 1,
      current: () => ({ version: 1, content: localDraft }),
      canPreferLive: () => true,
      confirm: vi.fn(),
    });
    const onMerge = vi.fn();
    const overlapping = original.replace("inspect", "discuss");
    await saveDocumentWithRebase({
      base,
      content: overlapping,
      persist: vi
        .fn()
        .mockResolvedValueOnce({ conflict: true, document: winner })
        .mockResolvedValueOnce({ ...winner, content: overlapping }),
      owner: owner(overlapping),
      onMerge,
    });
    const suffixed = `${original} Peer suffix.`;
    await saveDocumentWithRebase({
      base,
      content: suffixed,
      persist: vi
        .fn()
        .mockResolvedValueOnce({ conflict: true, document: winner })
        .mockResolvedValueOnce({ ...winner, content: draft }),
      owner: owner(suffixed),
      onMerge,
    });

    expect(onMerge.mock.calls).toEqual([[{ setAside: 1 }], [{ setAside: 0 }]]);
  });

  it("reports a newer body whose change the save already holds as kept_all", async () => {
    const onMerge = vi.fn();
    const sharedEdit = { ...winner, content: "Alpha edited.\n\nBravo." };
    const localDraft = "Alpha edited.\n\nBravo local.";
    const persist = vi
      .fn()
      .mockResolvedValueOnce({ conflict: true, document: sharedEdit })
      .mockResolvedValueOnce({ ...sharedEdit, content: localDraft });
    const result = await saveDocumentWithRebase({
      base: { ...base, content: "Alpha.\n\nBravo." },
      content: localDraft,
      persist,
      onMerge,
    });

    expect(result.status).toBe("saved");
    expect(persist).toHaveBeenLastCalledWith(
      localDraft,
      expect.objectContaining({ content: sharedEdit.content }),
    );
    expect(onMerge.mock.calls).toEqual([[{ setAside: 0 }]]);
  });

  it("does not report a displaced save or a newer revision with the base's body", async () => {
    const onMerge = vi.fn();
    const localDraft = original.replace("inspect", "discuss");
    await saveDocumentWithRebase({
      base,
      content: localDraft,
      persist: vi.fn().mockResolvedValue({ conflict: true, document: winner }),
      owner: {
        version: 1,
        current: () => ({ version: 1, content: localDraft }),
        canPreferLive: () => false,
        confirm: vi.fn(),
      },
      onMerge,
    });
    const retitled = { ...winner, content: original, title: "Renamed" };
    await saveDocumentWithRebase({
      base,
      content: draft,
      persist: vi
        .fn()
        .mockResolvedValueOnce({ conflict: true, document: retitled })
        .mockResolvedValueOnce({ ...retitled, content: draft }),
      onMerge,
    });

    expect(onMerge).not.toHaveBeenCalled();
  });

  it("does not report a merge whose rebased save never persists", async () => {
    const onMerge = vi.fn();
    const localDraft = `${original} Peer suffix.`;
    const persist = vi.fn().mockResolvedValue({
      conflict: true,
      document: winner,
    });
    await expect(
      saveDocumentWithRebase({ base, content: localDraft, persist, onMerge }),
    ).resolves.toMatchObject({ status: "conflict" });
    let checks = 0;
    await expect(
      saveDocumentWithRebase({
        base,
        content: localDraft,
        persist: vi
          .fn()
          .mockResolvedValueOnce({ conflict: true, document: winner }),
        canContinue: () => checks++ === 0,
        onMerge,
      }),
    ).resolves.toEqual({ status: "abandoned" });

    expect(persist).toHaveBeenCalledTimes(3);
    expect(onMerge).not.toHaveBeenCalled();
  });

  it("saves the same merge when the merge report throws", async () => {
    const localDraft = `${original} Peer suffix.`;
    const merged = `${accepted} Peer suffix.`;
    const persist = vi
      .fn()
      .mockResolvedValueOnce({ conflict: true, document: winner })
      .mockResolvedValueOnce({ ...winner, content: merged });

    await expect(
      saveDocumentWithRebase({
        base,
        content: localDraft,
        persist,
        onMerge: () => {
          throw new Error("telemetry failed");
        },
      }),
    ).resolves.toMatchObject({ status: "saved", content: merged });
    expect(persist).toHaveBeenNthCalledWith(2, merged, {
      content: winner.content,
      updatedAt: winner.updatedAt,
    });
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
