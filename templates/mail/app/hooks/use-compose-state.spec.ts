import type { ComposeState } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyDraftSaveResult,
  deleteCapturedDraftsAfterSaves,
  deleteSavedDraftAfterPendingSave,
  enqueueDraftMutation,
  enqueueCapturedDraftDeletions,
  enqueueDraftSave,
  filterRemovedDrafts,
  getDraftSaveMetadataUpdate,
  newestUnseenPopoutDraftId,
  saveDraftToEmailsBestEffort,
  type DraftSaveResult,
  type DraftSaveQueueResult,
} from "./use-compose-state";

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
  appApiPath: (path: string) => path,
}));

function draft(id: string, inline = false): ComposeState {
  return {
    id,
    to: "",
    subject: "",
    body: "",
    mode: "compose",
    inline,
  };
}

describe("newestUnseenPopoutDraftId", () => {
  it("focuses the newest server-added popout draft", () => {
    expect(
      newestUnseenPopoutDraftId(new Set(["old"]), [
        draft("old"),
        draft("newer"),
      ]),
    ).toBe("newer");
  });

  it("ignores inline reply drafts and keeps focus unchanged", () => {
    expect(
      newestUnseenPopoutDraftId(new Set(["old"]), [
        draft("old"),
        draft("inline-reply", true),
      ]),
    ).toBeNull();
  });
});

describe("filterRemovedDrafts", () => {
  it("keeps a just-discarded draft from reappearing in stale server results", () => {
    expect(
      filterRemovedDrafts([draft("kept"), draft("sent-reply", true)], {
        "sent-reply": Date.now(),
      }).map((item) => item.id),
    ).toEqual(["kept"]);
  });
});

describe("saveDraftToEmailsBestEffort", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the saved draft id on success", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            draftId: "gmail-draft-1",
            backend: "gmail",
            accountEmail: "secondary@example.com",
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveDraftToEmailsBestEffort({
        ...draft("draft-1"),
        to: "person@example.com",
        body: "Hello",
      }),
    ).resolves.toEqual({
      status: "saved",
      draftId: "gmail-draft-1",
      backend: "gmail",
      accountEmail: "secondary@example.com",
    });
  });

  it("sends the owning backend and mailbox when updating a saved draft", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            draftId: "gmail-draft-1",
            backend: "gmail",
            accountEmail: "secondary@example.com",
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await saveDraftToEmailsBestEffort({
      ...draft("compose-1"),
      savedDraftId: "gmail-draft-1",
      savedDraftBackend: "gmail",
      savedDraftAccountEmail: "secondary@example.com",
      accountEmail: "default@example.com",
      body: "Updated",
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(request?.body))).toMatchObject({
      draftId: "gmail-draft-1",
      savedDraftBackend: "gmail",
      accountEmail: "secondary@example.com",
    });
  });

  it("does not accept a save response without backend/account metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ draftId: "gmail-draft-1" }), {
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    await expect(
      saveDraftToEmailsBestEffort({
        ...draft("draft-1"),
        body: "Still worth saving",
      }),
    ).resolves.toMatchObject({ status: "failed" });
  });

  it("reports background draft save failures distinctly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Gmail failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    await expect(
      saveDraftToEmailsBestEffort({
        ...draft("draft-1"),
        body: "Still worth saving",
      }),
    ).resolves.toMatchObject({ status: "failed" });
  });

  it("distinguishes an unavailable draft endpoint from a failed save", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );

    await expect(
      saveDraftToEmailsBestEffort({
        ...draft("draft-1"),
        body: "Local-only draft",
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });
});

describe("applyDraftSaveResult", () => {
  it("retains the saved backend and exact connected account for later deletion", () => {
    expect(
      applyDraftSaveResult(draft("draft-1"), {
        status: "saved",
        draftId: "gmail-draft-1",
        backend: "gmail",
        accountEmail: "secondary@example.com",
      }),
    ).toMatchObject({
      savedDraftId: "gmail-draft-1",
      savedDraftBackend: "gmail",
      savedDraftAccountEmail: "secondary@example.com",
    });
  });
});

describe("getDraftSaveMetadataUpdate", () => {
  it("does not enqueue saved metadata after the compose draft was removed", async () => {
    const pending = new Map<string, Promise<unknown>>();
    const order: string[] = [];
    const result = {
      status: "saved",
      draftId: "gmail-draft-1",
      backend: "gmail",
      accountEmail: "secondary@example.com",
    } as const;
    const removed = { ...draft("compose-1"), body: "Hello" };

    const deletion = enqueueDraftMutation(pending, removed.id, async () => {
      order.push("delete");
    });
    const metadataUpdate = getDraftSaveMetadataUpdate(removed, result, true);
    if (metadataUpdate) {
      void enqueueDraftMutation(pending, removed.id, async () => {
        order.push("put");
      });
    }

    await deletion;
    expect(order).toEqual(["delete"]);
  });
});

describe("deleteSavedDraftAfterPendingSave", () => {
  it("deletes the existing saved copy even if the in-flight save rejects", async () => {
    const existingDraft = {
      ...draft("compose-1"),
      savedDraftId: "local-draft-1",
      savedDraftBackend: "local" as const,
    };
    const error = new Error("autosave failed");
    const deleteDraft = vi.fn(async () => ({ status: "deleted" as const }));
    const reportFailure = vi.fn();

    await expect(
      deleteSavedDraftAfterPendingSave(
        existingDraft,
        Promise.reject(error),
        deleteDraft,
        reportFailure,
      ),
    ).resolves.toEqual({ status: "deleted" });

    expect(deleteDraft).toHaveBeenCalledWith(existingDraft);
    expect(reportFailure).toHaveBeenCalledWith({ status: "failed", error });
  });
});

describe("enqueueDraftSave", () => {
  it("keeps the last saved mailbox metadata when a queued update fails", async () => {
    const pending = new Map<string, Promise<DraftSaveQueueResult>>();
    let resolveFirst!: (result: DraftSaveResult) => void;
    const firstResult = new Promise<DraftSaveResult>((resolve) => {
      resolveFirst = resolve;
    });
    const save = vi
      .fn()
      .mockImplementationOnce(async () => firstResult)
      .mockImplementationOnce(async () => ({
        status: "failed" as const,
        error: new Error("latest update failed"),
      }));
    const current = { ...draft("compose-1"), body: "First version" };
    const updated = { ...current, body: "Latest version" };

    const first = enqueueDraftSave(
      pending,
      current,
      () => current,
      () => false,
      save,
    );
    const second = enqueueDraftSave(
      pending,
      updated,
      () => undefined,
      () => false,
      save,
      true,
    );
    resolveFirst({
      status: "saved",
      draftId: "gmail-draft-1",
      backend: "gmail",
      accountEmail: "secondary@example.com",
    });

    await first;
    await expect(second).resolves.toMatchObject({
      status: "failed",
      savedDraft: {
        draftId: "gmail-draft-1",
        backend: "gmail",
        accountEmail: "secondary@example.com",
      },
    });
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      body: "Latest version",
      savedDraftId: "gmail-draft-1",
    });
  });

  it("serializes close-time persistence behind autosave and carries the returned ID forward", async () => {
    const pending = new Map<string, Promise<DraftSaveQueueResult>>();
    let resolveFirst!: (result: DraftSaveResult) => void;
    const firstResult = new Promise<DraftSaveResult>((resolve) => {
      resolveFirst = resolve;
    });
    const snapshots: ComposeState[] = [];
    const save = vi.fn(async (value: ComposeState) => {
      snapshots.push(value);
      if (snapshots.length === 1) return firstResult;
      return {
        status: "saved",
        draftId: "gmail-draft-1",
        backend: "gmail",
        accountEmail: "secondary@example.com",
      } as const;
    });
    let current = { ...draft("compose-1"), body: "First version" };
    const isRemoved = () => false;

    const autosave = enqueueDraftSave(
      pending,
      current,
      () => current,
      isRemoved,
      save,
    );
    current = { ...current, body: "Final version" };
    const closeSave = enqueueDraftSave(
      pending,
      current,
      () => undefined,
      isRemoved,
      save,
      true,
    );

    expect(save).toHaveBeenCalledOnce();
    resolveFirst({
      status: "saved",
      draftId: "gmail-draft-1",
      backend: "gmail",
      accountEmail: "secondary@example.com",
    });
    await autosave;
    await closeSave;

    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toMatchObject({
      body: "Final version",
      savedDraftId: "gmail-draft-1",
      savedDraftBackend: "gmail",
      savedDraftAccountEmail: "secondary@example.com",
    });
  });

  it("does not start a queued autosave after discard and returns the last saved ID for deletion", async () => {
    const pending = new Map<string, Promise<DraftSaveQueueResult>>();
    let resolveFirst!: (result: DraftSaveResult) => void;
    const firstResult = new Promise<DraftSaveResult>((resolve) => {
      resolveFirst = resolve;
    });
    const save = vi.fn(async () => firstResult);
    let removed = false;
    const value = { ...draft("compose-1"), body: "Draft body" };
    const isRemoved = () => removed;
    const first = enqueueDraftSave(
      pending,
      value,
      () => value,
      isRemoved,
      save,
    );
    const queued = enqueueDraftSave(
      pending,
      value,
      () => undefined,
      isRemoved,
      save,
    );
    removed = true;

    resolveFirst({
      status: "saved",
      draftId: "gmail-draft-1",
      backend: "gmail",
      accountEmail: "secondary@example.com",
    });
    await first;
    await expect(queued).resolves.toEqual({
      status: "cancelled",
      savedDraft: {
        draftId: "gmail-draft-1",
        backend: "gmail",
        accountEmail: "secondary@example.com",
      },
    });
    expect(save).toHaveBeenCalledOnce();
  });
});

describe("enqueueDraftMutation", () => {
  it("waits for mailbox saves and preserves compose state after a failed save", async () => {
    const pending = new Map<string, Promise<unknown>>();
    const deleted: string[] = [];
    let finishSave!: (result: DraftSaveQueueResult) => void;
    const save = new Promise<DraftSaveQueueResult>((resolve) => {
      finishSave = resolve;
    });
    const closeAll = deleteCapturedDraftsAfterSaves(
      [
        { id: "saved", promise: save },
        {
          id: "failed",
          promise: Promise.resolve({
            status: "failed",
            error: new Error("mailbox save failed"),
          }),
        },
      ],
      pending,
      ["saved", "failed", "empty"],
      async (id) => {
        deleted.push(id);
      },
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(deleted).toEqual([]);

    finishSave({
      status: "saved",
      draftId: "gmail-draft-1",
      backend: "gmail",
      accountEmail: "owner@example.com",
    });
    await expect(closeAll).resolves.toEqual(["failed"]);
    expect(deleted.sort()).toEqual(["empty", "saved"]);
  });

  it("runs local compose deletion after any pending state write", async () => {
    const pending = new Map<string, Promise<unknown>>();
    const order: string[] = [];
    let finishWrite!: () => void;
    const write = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });

    const put = enqueueDraftMutation(pending, "compose-1", async () => {
      order.push("put-start");
      await write;
      order.push("put-end");
    });
    const remove = enqueueDraftMutation(pending, "compose-1", async () => {
      order.push("delete");
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["put-start"]);
    finishWrite();
    await Promise.all([put, remove]);
    expect(order).toEqual(["put-start", "put-end", "delete"]);
  });

  it("continues to delete after a failed preceding app-state write", async () => {
    const pending = new Map<string, Promise<unknown>>();
    const write = enqueueDraftMutation(pending, "compose-1", async () => {
      throw new Error("write failed");
    });
    const remove = enqueueDraftMutation(
      pending,
      "compose-1",
      async () => "deleted",
    );

    await expect(write).rejects.toThrow("write failed");
    await expect(remove).resolves.toBe("deleted");
  });

  it("deletes only the draft IDs captured before a new tab opens", async () => {
    const pending = new Map<string, Promise<unknown>>();
    const removed: string[] = [];
    let finishOldWrite!: () => void;
    const oldWrite = enqueueDraftMutation(
      pending,
      "old-tab",
      () =>
        new Promise<void>((resolve) => {
          finishOldWrite = resolve;
        }),
    );
    const closeAll = enqueueCapturedDraftDeletions(
      pending,
      ["old-tab"],
      async (id) => {
        removed.push(id);
      },
    );

    await Promise.resolve();
    await Promise.resolve();
    const newTabWrite = enqueueDraftMutation(pending, "new-tab", async () => {
      return "saved";
    });
    await newTabWrite;
    expect(removed).toEqual([]);

    finishOldWrite();
    await oldWrite;
    await closeAll;

    expect(removed).toEqual(["old-tab"]);
  });
});
