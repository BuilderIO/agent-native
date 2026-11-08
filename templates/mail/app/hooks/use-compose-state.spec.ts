import {
  saveRevisionOf,
  SaveOverlapError,
} from "@agent-native/core/save-conflict";
import type { ComposeState } from "@shared/types";
import { QueryClient } from "@tanstack/react-query";
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
  mergeComposeDrafts,
  newestUnseenPopoutDraftId,
  saveDraftMerging,
  saveDraftToEmailsBestEffort,
  saveNewestDraft,
  setDraftOverlapResolver,
  syncDraftToMailboxBestEffort,
  type DraftSaveResult,
  type DraftSaveQueueResult,
} from "./use-compose-state";

const mocks = vi.hoisted(() => ({ callAction: vi.fn() }));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
  appApiPath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction: mocks.callAction,
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

describe("saveDraftMerging", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setDraftOverlapResolver(undefined);
  });

  function respondWith(
    ...responses: Array<{ status: number; body: unknown }>
  ): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn();
    for (const { status, body } of responses) {
      fetchMock.mockResolvedValueOnce({
        ok: status < 400,
        status,
        json: async () => body,
      });
    }
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const stored = (value: ComposeState) => ({
    status: 200,
    body: { value, revision: saveRevisionOf(value) },
  });
  const conflict = (current: ComposeState | null) => ({
    status: 409,
    body: {
      error: "changed",
      errorCode: "save_conflict",
      details: {
        current,
        currentRevision: current && saveRevisionOf(current),
      },
    },
  });
  const sentBody = (fetchMock: ReturnType<typeof vi.fn>, call: number) =>
    JSON.parse(fetchMock.mock.calls[call]?.[1].body);

  /** Gives this draft id a known saved state, as a read or an earlier save does. */
  async function savedAs(value: ComposeState) {
    respondWith(stored(value));
    await saveDraftMerging(value);
    vi.unstubAllGlobals();
  }

  it("checks the first save of a new draft against nothing being there", async () => {
    const mine = { ...draft("merge-new"), body: "Hello" };
    const fetchMock = respondWith(stored(mine));

    await expect(saveDraftMerging(mine)).resolves.toEqual(mine);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/_agent-native/application-state/compose/merge-new",
    );
    expect(fetchMock.mock.calls[0]?.[1].method).toBe("PATCH");
    expect(sentBody(fetchMock, 0)).toEqual({
      expectedRevision: null,
      next: mine,
    });
  });

  it("merges another writer's change to a different field without asking", async () => {
    const base = { ...draft("merge-other"), subject: "Base", body: "Base" };
    await savedAs(base);
    const mine = { ...base, body: "Mine" };
    const theirs = { ...base, subject: "Theirs" };
    const merged = { ...base, subject: "Theirs", body: "Mine" };
    const resolver = vi.fn();
    setDraftOverlapResolver(resolver);
    const fetchMock = respondWith(conflict(theirs), stored(merged));

    await expect(saveDraftMerging(mine)).resolves.toEqual(merged);

    expect(sentBody(fetchMock, 0).expectedRevision).toBe(saveRevisionOf(base));
    expect(sentBody(fetchMock, 1)).toEqual({
      expectedRevision: saveRevisionOf(theirs),
      next: merged,
    });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("asks when both changed the same field", async () => {
    const base = { ...draft("merge-same"), body: "Base" };
    await savedAs(base);
    const mine = { ...base, body: "Mine" };
    const theirs = { ...base, body: "Theirs" };
    const resolver = vi.fn(async (overlap) => overlap.keepMine);
    setDraftOverlapResolver(resolver);
    const fetchMock = respondWith(conflict(theirs), stored(mine));

    await expect(saveDraftMerging(mine)).resolves.toEqual(mine);

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver.mock.calls[0]?.[0]).toMatchObject({
      fields: ["body"],
      theirs,
      mine,
    });
    expect(sentBody(fetchMock, 1).expectedRevision).toBe(
      saveRevisionOf(theirs),
    );
  });

  it("fails loudly rather than overwriting when nothing can ask", async () => {
    const base = { ...draft("merge-noprompt"), body: "Base" };
    await savedAs(base);
    const fetchMock = respondWith(conflict({ ...base, body: "Theirs" }));

    await expect(
      saveDraftMerging({ ...base, body: "Mine" }),
    ).rejects.toBeInstanceOf(SaveOverlapError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stores a draft again if it was deleted elsewhere while still open", async () => {
    const base = { ...draft("merge-deleted"), body: "Base" };
    await savedAs(base);
    const mine = { ...base, body: "Mine" };
    const fetchMock = respondWith(conflict(null), stored(mine));

    await expect(saveDraftMerging(mine)).resolves.toEqual(mine);

    expect(sentBody(fetchMock, 1).expectedRevision).toBeNull();
  });

  it("reports anything else as the failure it is", async () => {
    const mine = { ...draft("merge-error"), body: "Mine" };
    respondWith({ status: 500, body: { error: "nope" } });

    await expect(saveDraftMerging(mine)).rejects.toMatchObject({ status: 500 });
  });
});

describe("saveNewestDraft", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setDraftOverlapResolver(undefined);
  });

  /** A server holding `stored`, refusing any save that isn't current. */
  function server(initial: ComposeState) {
    const state = { stored: initial };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const { expectedRevision, next } = JSON.parse(init.body);
        const currentRevision = saveRevisionOf(state.stored);
        if (expectedRevision !== currentRevision) {
          return {
            ok: false,
            status: 409,
            json: async () => ({
              errorCode: "save_conflict",
              details: { current: state.stored, currentRevision },
            }),
          };
        }
        state.stored = next;
        return {
          ok: true,
          status: 200,
          json: async () => ({ value: next, revision: saveRevisionOf(next) }),
        };
      }),
    );
    return state;
  }

  function cacheHolding(value: ComposeState) {
    const qc = new QueryClient();
    qc.setQueryData(["compose-drafts"], [value]);
    return {
      qc,
      cached: () =>
        qc.getQueryData<ComposeState[]>([
          "compose-drafts",
        ])?.[0] as ComposeState,
      edit: (change: Partial<ComposeState>) =>
        qc.setQueryData<ComposeState[]>(["compose-drafts"], (old) =>
          (old ?? []).map((one) => ({ ...one, ...change })),
        ),
    };
  }

  /** Teaches the module this draft's saved base through a first plain save. */
  async function seen(value: ComposeState) {
    server(value);
    await saveDraftMerging(value);
  }

  it("keeps another writer's change through an edit queued behind the merge", async () => {
    const base = { ...draft("queued-merge"), subject: "A", body: "B" };
    await seen(base);
    const state = server({ ...base, body: "Theirs" });
    const { qc, cached, edit } = cacheHolding(base);

    edit({ subject: "First" });
    const first = cached();
    edit({ subject: "Second" });
    const second = cached();
    await saveNewestDraft(qc, first);
    await saveNewestDraft(qc, second);

    expect(state.stored).toMatchObject({ subject: "Second", body: "Theirs" });
    expect(cached()).toMatchObject({ subject: "Second", body: "Theirs" });
  });

  it("keeps edits made while the save ran on top of what came back", async () => {
    const base = { ...draft("edit-while-saving"), subject: "A", body: "B" };
    await seen(base);
    const state = server({ ...base, body: "Theirs" });
    const { qc, cached, edit } = cacheHolding(base);

    edit({ subject: "First" });
    const running = saveNewestDraft(qc, cached());
    edit({ subject: "Typed meanwhile" });
    await running;

    expect(state.stored).toMatchObject({ subject: "First", body: "Theirs" });
    expect(cached()).toMatchObject({
      subject: "Typed meanwhile",
      body: "Theirs",
    });
  });

  it("doesn't undo the choice made on the save ahead of it", async () => {
    const base = { ...draft("queued-choice"), subject: "A", body: "B" };
    await seen(base);
    const state = server({ ...base, subject: "Theirs" });
    setDraftOverlapResolver(async (overlap) => overlap.useTheirs);
    const { qc, cached, edit } = cacheHolding(base);

    edit({ subject: "Mine" });
    const first = cached();
    const running = saveNewestDraft(qc, first);
    edit({ body: "Next edit" });
    const second = cached();
    await running;
    await saveNewestDraft(qc, second);

    expect(state.stored).toMatchObject({
      subject: "Theirs",
      body: "Next edit",
    });
  });

  it("asks whichever prompt is mounted when the overlap arrives", async () => {
    const base = { ...draft("late-prompt"), subject: "A", body: "B" };
    await seen(base);
    const state = server({ ...base, subject: "Theirs" });
    const { qc, cached, edit } = cacheHolding(base);
    const leaving = vi.fn(async () => {
      throw new Error("That prompt is gone");
    });
    setDraftOverlapResolver(leaving);

    edit({ subject: "Mine" });
    const running = saveNewestDraft(qc, cached());
    setDraftOverlapResolver(async (overlap) => overlap.keepMine);
    await running;

    expect(leaving).not.toHaveBeenCalled();
    expect(state.stored).toMatchObject({ subject: "Mine" });
  });

  it("saves the queued copy when the draft has left the cache", async () => {
    const base = { ...draft("closed"), subject: "A" };
    await seen(base);
    const state = server(base);
    const qc = new QueryClient();

    await saveNewestDraft(qc, { ...base, subject: "Closed with this" });

    expect(state.stored).toMatchObject({ subject: "Closed with this" });
  });
});

describe("mergeComposeDrafts", () => {
  it("never asks about which mailbox draft backs the compose draft", () => {
    const base = draft("meta");
    const result = mergeComposeDrafts(
      base,
      {
        ...base,
        body: "Mine",
        savedDraftId: "mine-gmail",
        savedDraftBackend: "gmail",
        savedDraftAccountEmail: "mine@example.com",
      },
      {
        ...base,
        savedDraftId: "their-gmail",
        savedDraftBackend: "gmail",
        savedDraftAccountEmail: "theirs@example.com",
      },
    );

    expect(result).toMatchObject({
      ok: true,
      merged: {
        body: "Mine",
        savedDraftId: "their-gmail",
        savedDraftAccountEmail: "theirs@example.com",
      },
    });
  });

  it("keeps my mailbox draft when the other writer has none", () => {
    const base = draft("meta-mine");
    const result = mergeComposeDrafts(
      base,
      { ...base, savedDraftId: "mine-gmail" },
      { ...base, subject: "Theirs" },
    );

    expect(result).toMatchObject({
      ok: true,
      merged: { subject: "Theirs", savedDraftId: "mine-gmail" },
    });
  });
});

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

describe("syncDraftToMailboxBestEffort", () => {
  afterEach(() => {
    mocks.callAction.mockReset();
  });

  it("asks for the mailbox copy only once this tab's queued write of the draft lands", async () => {
    const pending = new Map<string, Promise<unknown>>();
    let landWrite: (() => void) | undefined;
    void enqueueDraftMutation(
      pending,
      "draft-1",
      () =>
        new Promise<void>((resolve) => {
          landWrite = resolve;
        }),
    );
    mocks.callAction.mockResolvedValue({
      status: "synced",
      savedDraft: {
        draftId: "gmail-1",
        backend: "gmail",
        accountEmail: "me@example.com",
      },
    });

    const synced = syncDraftToMailboxBestEffort(pending, "draft-1");
    await vi.waitFor(() => expect(landWrite).toBeDefined());
    expect(mocks.callAction).not.toHaveBeenCalled();
    landWrite!();

    await expect(synced).resolves.toEqual({
      status: "saved",
      draftId: "gmail-1",
      backend: "gmail",
      accountEmail: "me@example.com",
    });
    expect(mocks.callAction).toHaveBeenCalledWith("sync-draft-mailbox", {
      id: "draft-1",
    });
  });

  it("still asks after a queued write fails, since Mail's stored copy is what it copies", async () => {
    const pending = new Map<string, Promise<unknown>>();
    void enqueueDraftMutation(pending, "draft-1", async () => {
      throw new Error("offline");
    }).catch(() => undefined);
    mocks.callAction.mockResolvedValue({ status: "gone" });

    await expect(
      syncDraftToMailboxBestEffort(pending, "draft-1"),
    ).resolves.toEqual({ status: "gone" });
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
  });

  it("reports a mailbox copy left behind as a failed save", async () => {
    mocks.callAction.mockResolvedValue({
      status: "pending",
      errorCode: "gmail_quota_cooldown",
      message: "Email service is briefly busy",
      retryAfterMs: 5_000,
    });

    const result = await syncDraftToMailboxBestEffort(new Map(), "draft-1");

    expect(result.status).toBe("failed");
    expect((result as { error: unknown }).error).toMatchObject({
      message: "Email service is briefly busy",
      errorCode: "gmail_quota_cooldown",
      retryAfterMs: 5_000,
    });
  });

  it("reports a request that fails as a failed save", async () => {
    const error = new Error("Request failed (500)");
    mocks.callAction.mockRejectedValue(error);

    await expect(
      syncDraftToMailboxBestEffort(new Map(), "draft-1"),
    ).resolves.toEqual({ status: "failed", error });
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
