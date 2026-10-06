// @vitest-environment happy-dom

import type { Document } from "@shared/api";
import { describe, expect, it, vi } from "vitest";

import { saveDocumentWithRebase } from "./document-save-rebase";
import { pendingSaveRetrySnapshot } from "./document-save-retry";
import { savePageWithRecovery } from "./pageSession";

describe("Page save recovery after a rejected rebase", () => {
  it("resumes a merged A+B draft after the foreground CAS budget is exhausted", async () => {
    const base = {
      content: "Writers inspect changes.\nReaders retain context.",
      updatedAt: "2026-09-09T00:00:01.000Z",
      revision: "body-0",
    };
    const localDraft =
      "Writers inspect changes.\nReaders retain context and annotations.";
    const winnerContents = [
      "Writers review changes.\nReaders retain context.",
      "Writers publish changes.\nReaders retain context.",
      "Writers explain changes.\nReaders retain context.",
    ];
    const winners = winnerContents.map((content, index) => ({
      title: "Page",
      content,
      updatedAt: `2026-09-09T00:00:0${index + 2}.000Z`,
      revision: `body-${index + 1}`,
    })) as Document[];
    const persist = vi
      .fn()
      .mockResolvedValueOnce({ conflict: true, document: winners[0] })
      .mockResolvedValueOnce({ conflict: true, document: winners[1] })
      .mockResolvedValueOnce({ conflict: true, document: winners[2] });
    const retain = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);
    const first = await savePageWithRecovery({
      save: async () => {
        const result = await saveDocumentWithRebase({
          base,
          content: localDraft,
          persist,
        });
        return result.status === "conflict"
          ? {
              contentPersisted: false,
              recoveryDraft: {
                title: "Page",
                content: result.localDraft,
                baseContent: result.base?.content,
                baseUpdatedAt: result.base?.updatedAt,
                baseRevision: result.base?.revision,
              },
            }
          : { contentPersisted: result.status === "saved" };
      },
      retain,
      clear,
    });
    const retainedContent =
      "Writers publish changes.\nReaders retain context and annotations.";
    expect(first.recoveryDraft).toEqual({
      title: "Page",
      content: retainedContent,
      baseContent: winners[1]?.content,
      baseUpdatedAt: winners[1]?.updatedAt,
      baseRevision: winners[1]?.revision,
    });
    expect(retain).toHaveBeenCalledExactlyOnceWith(null, first);
    expect(clear).not.toHaveBeenCalled();

    const retry = pendingSaveRetrySnapshot(
      first,
      { contentEditVersion: 1, editGeneration: 1, contentObservationEpoch: 0 },
      {
        canEdit: true,
        contentEditVersion: 1,
        editGeneration: 1,
        contentObservationEpoch: 0,
        title: "Page",
        content: localDraft,
        contentBase: base,
        titleBase: "Page",
      },
    );
    expect(retry).toMatchObject({
      content: retainedContent,
      contentBase: {
        content: winners[1]?.content,
        revision: winners[1]?.revision,
      },
    });
    const canonicalContent =
      "Writers explain changes.\nReaders retain context and annotations.";
    const canonical = {
      ...winners[2],
      content: canonicalContent,
      updatedAt: "2026-09-09T00:00:05.000Z",
      revision: "body-4",
    } as Document;
    persist
      .mockResolvedValueOnce({ conflict: true, document: winners[2] })
      .mockResolvedValueOnce(canonical);
    const resumed = await savePageWithRecovery({
      save: async () => {
        const result = await saveDocumentWithRebase({
          base: retry!.contentBase,
          content: retry!.content,
          persist,
        });
        return { contentPersisted: result.status === "saved" };
      },
      retain,
      clear,
    });
    expect(resumed).toEqual({ contentPersisted: true });
    expect(persist).toHaveBeenNthCalledWith(4, retainedContent, {
      content: winners[1]?.content,
      updatedAt: winners[1]?.updatedAt,
      revision: winners[1]?.revision,
    });
    expect(persist).toHaveBeenNthCalledWith(5, canonicalContent, {
      content: winners[2]?.content,
      updatedAt: winners[2]?.updatedAt,
      revision: winners[2]?.revision,
    });
    expect(clear).toHaveBeenCalledOnce();
    expect(retain).toHaveBeenCalledOnce();
  });

  it("retains the merged candidate when a later CAS retry also loses", async () => {
    const base = {
      content: "Writers inspect changes.\nReaders retain context.",
      updatedAt: "2026-09-09T00:00:01.000Z",
    };
    const localDraft =
      "Writers inspect changes.\nReaders retain context and annotations.";
    const peerWinner = {
      title: "Page",
      content: "Writers review changes.\nReaders retain context.",
      updatedAt: "2026-09-09T00:00:02.000Z",
    } as Document;
    const merged =
      "Writers review changes.\nReaders retain context and annotations.";
    const persist = vi
      .fn()
      .mockResolvedValueOnce({ conflict: true, document: peerWinner })
      .mockResolvedValueOnce({
        conflict: true,
        document: { ...peerWinner, updatedAt: "2026-09-09T00:00:03.000Z" },
      })
      .mockResolvedValueOnce({
        conflict: true,
        document: { ...peerWinner, updatedAt: "2026-09-09T00:00:04.000Z" },
      });
    const retryBase = {
      content: peerWinner.content,
      updatedAt: "2026-09-09T00:00:03.000Z",
      revision: peerWinner.revision,
    };
    const retain = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);

    await savePageWithRecovery({
      save: async () => {
        const result = await saveDocumentWithRebase({
          base,
          content: localDraft,
          persist,
        });
        if (result.status === "conflict") {
          return {
            contentPersisted: false,
            recoveryDraft: {
              title: "Page",
              content: result.localDraft,
              baseContent: result.base?.content,
              baseUpdatedAt: result.base?.updatedAt,
              baseRevision: result.base?.revision,
            },
          };
        }
        return { contentPersisted: result.status === "saved" };
      },
      retain,
      clear,
    });

    expect(persist).toHaveBeenNthCalledWith(2, merged, {
      content: peerWinner.content,
      updatedAt: peerWinner.updatedAt,
      revision: peerWinner.revision,
    });
    expect(retain).toHaveBeenCalledExactlyOnceWith(null, {
      contentPersisted: false,
      recoveryDraft: {
        title: "Page",
        content: merged,
        baseContent: retryBase.content,
        baseUpdatedAt: retryBase.updatedAt,
        baseRevision: retryBase.revision,
      },
    });
    expect(clear).not.toHaveBeenCalled();
  });

  it("does not retain a stale queued save after a newer local edit takes ownership", async () => {
    const base = {
      content: "Writers inspect changes.\nReaders retain context.",
      updatedAt: "2026-09-09T00:00:01.000Z",
    };
    const queuedContent = base.content.replace("inspect", "discuss");
    const newerContent = base.content.replace("inspect", "publish");
    const peerWinner = {
      content: base.content.replace("inspect", "review"),
      updatedAt: "2026-09-09T00:00:02.000Z",
    } as Document;
    let current = { version: 1, content: queuedContent };
    let rejectQueuedWrite!: (result: unknown) => void;
    const rejectedWrite = new Promise<unknown>((resolve) => {
      rejectQueuedWrite = resolve;
    });
    const persist = vi.fn().mockReturnValue(rejectedWrite);
    const retain = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);

    const save = savePageWithRecovery({
      save: async () => {
        const result = await saveDocumentWithRebase({
          base,
          content: queuedContent,
          persist,
          owner: {
            version: 1,
            current: () => current,
            canPreferLive: () => false,
            confirm: vi.fn(),
          },
        });
        return result.status === "superseded"
          ? { contentPersisted: false, outcome: "superseded" as const }
          : { contentPersisted: result.status === "saved" };
      },
      retain,
      clear,
    });
    current = { version: 2, content: newerContent };
    rejectQueuedWrite({ conflict: true, document: peerWinner });

    await expect(save).resolves.toEqual({
      contentPersisted: false,
      outcome: "superseded",
    });
    expect(persist).toHaveBeenCalledOnce();
    expect(retain).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });
});
