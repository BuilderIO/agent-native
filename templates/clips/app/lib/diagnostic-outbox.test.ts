import type { DiagnosticContextInput } from "@shared/diagnostic-context";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelOtherDiagnosticOwners,
  enqueueDiagnosticContext,
  listDiagnosticOutbox,
  listDiagnosticDrafts,
  retainDiagnosticDraft,
  retryDiagnosticContext,
} from "./diagnostic-outbox";

const owner = { ownerEmail: "owner@example.test", orgId: "org-a" };
function payload(captureId = "capture-1"): DiagnosticContextInput {
  return {
    recordingId: "recording-1",
    captureId,
    captureAuthorization: "example-capture-authorization",
    consent: true,
    contextVersion: 1,
    recordingStartedAt: "2026-10-30T10:00:00.000Z",
    requestedWindow: {
      from: "2026-10-30T09:59:30.000Z",
      to: "2026-10-30T10:00:10.000Z",
    },
    captured: "unsupported",
    gaps: [
      {
        from: "2026-10-30T09:59:30.000Z",
        to: "2026-10-30T10:00:10.000Z",
        reason: "no_page_bridge",
      },
    ],
  };
}

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.restoreAllMocks();
  await cancelOtherDiagnosticOwners(null);
});

describe("private diagnostic recovery", () => {
  it("replays the frozen payload after a failed save and a new reader, independently of media", async () => {
    const frozen = payload();
    const entry = await enqueueDiagnosticContext(owner, frozen, () => true);
    const failure = vi
      .fn()
      .mockRejectedValue(new Error("provider unavailable"));
    await expect(
      retryDiagnosticContext(entry.id, owner, failure, () => true),
    ).rejects.toThrow("provider unavailable");
    frozen.gaps = [];
    const afterRestart = await listDiagnosticOutbox();
    expect(afterRestart).toHaveLength(1);
    expect(afterRestart[0]?.status).toBe("failed");
    const save = vi
      .fn()
      .mockResolvedValue({ status: "saved", contextId: "context-1" });
    await retryDiagnosticContext(entry.id, owner, save, () => true);
    expect(save).toHaveBeenCalledWith(afterRestart[0]?.payload);
    expect(save.mock.calls[0]?.[0].gaps).toHaveLength(1);
    expect(await listDiagnosticOutbox()).toEqual([]);
  });

  it("cannot transfer pending context to another organization or user", async () => {
    const entry = await enqueueDiagnosticContext(owner, payload(), () => true);
    const save = vi.fn();
    await expect(
      retryDiagnosticContext(
        entry.id,
        { ...owner, orgId: "org-b" },
        save,
        () => true,
      ),
    ).rejects.toThrow("another session");
    await expect(
      retryDiagnosticContext(
        entry.id,
        { ...owner, ownerEmail: "other@example.test" },
        save,
        () => true,
      ),
    ).rejects.toThrow("another session");
    expect(save).not.toHaveBeenCalled();
    await cancelOtherDiagnosticOwners({ ...owner, orgId: "org-b" });
    expect(await listDiagnosticOutbox()).toEqual([
      expect.objectContaining({
        status: "cancelled",
        failureCode: "signed_out",
        ownerEmail: owner.ownerEmail,
        orgId: owner.orgId,
      }),
    ]);
    expect((await listDiagnosticOutbox())[0]).not.toHaveProperty("payload");
  });

  it("does not restore a payload cancelled while an upload was failing", async () => {
    const entry = await enqueueDiagnosticContext(owner, payload(), () => true);
    let rejectUpload: (error: Error) => void = () => {};
    let beganUpload: () => void = () => {};
    const began = new Promise<void>((resolve) => {
      beganUpload = resolve;
    });
    let active = true;
    const upload = retryDiagnosticContext(
      entry.id,
      owner,
      () => {
        beganUpload();
        return new Promise((_resolve, reject) => {
          rejectUpload = reject;
        });
      },
      () => active,
    );
    await began;
    active = false;
    await cancelOtherDiagnosticOwners(null);
    rejectUpload(new Error("network interrupted"));
    await expect(upload).rejects.toThrow("network interrupted");
    expect((await listDiagnosticOutbox())[0]).not.toHaveProperty("payload");
    await expect(
      enqueueDiagnosticContext(owner, payload("new-capture"), () => active),
    ).rejects.toThrow("another session");
  });

  it("serializes concurrent writes, preserving capture identity and the pending cap", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 11 }, (_, index) =>
        enqueueDiagnosticContext(
          owner,
          payload(`capture-${index}`),
          () => true,
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(10);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const existing = (await listDiagnosticOutbox()).find((entry) =>
      Boolean(entry.payload),
    );
    expect(existing).toBeDefined();
    if (!existing?.payload) throw new Error("Expected persisted payload");
    await expect(
      enqueueDiagnosticContext(
        owner,
        { ...existing.payload, captured: "failed" },
        () => true,
      ),
    ).rejects.toThrow("different content");
    expect(await listDiagnosticOutbox()).toHaveLength(10);
  });

  it("keeps a quota-failed draft available for explicit retry and clears its managed copy on sign-out", async () => {
    const frozen = payload();
    retainDiagnosticDraft(owner, frozen, () => true);
    frozen.gaps = [];
    expect(listDiagnosticDrafts()[0]?.payload?.gaps).toHaveLength(1);
    await cancelOtherDiagnosticOwners(null);
    expect(listDiagnosticDrafts()).toEqual([]);
    retainDiagnosticDraft(owner, frozen, () => false);
    expect(listDiagnosticDrafts()).toEqual([]);
  });

  it("surfaces quota failure instead of acknowledging an unsaved payload", async () => {
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    });
    await expect(
      enqueueDiagnosticContext(owner, payload(), () => true),
    ).rejects.toThrow("Storage quota exceeded");
    expect(await listDiagnosticOutbox()).toEqual([]);
  });
});
