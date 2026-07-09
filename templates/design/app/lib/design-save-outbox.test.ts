import { describe, expect, it, vi } from "vitest";

import {
  acknowledgeDesignSaveOutboxEntry,
  createDesignSaveOutboxEntry,
  DESIGN_SAVE_OUTBOX_RETENTION_MS,
  discardDesignSaveOutboxEntry,
  drainDesignSaveOutbox,
  journalDesignSaveOutboxEntry,
  type DesignSaveOutboxEntry,
  type DesignSaveOutboxStorage,
} from "./design-save-outbox";

class MemoryOutboxStorage implements DesignSaveOutboxStorage {
  readonly entries = new Map<string, DesignSaveOutboxEntry>();

  async putLatest(entry: DesignSaveOutboxEntry): Promise<void> {
    const current = this.entries.get(entry.key);
    if (
      !current ||
      entry.operationRevision > current.operationRevision ||
      (entry.operationRevision === current.operationRevision &&
        entry.updatedAt >= current.updatedAt)
    ) {
      this.entries.set(entry.key, structuredClone(entry));
    }
  }

  async deleteIfRevision(entry: DesignSaveOutboxEntry): Promise<boolean> {
    const current = this.entries.get(entry.key);
    if (
      current?.operationSource !== entry.operationSource ||
      current.operationRevision !== entry.operationRevision
    ) {
      return false;
    }
    this.entries.delete(entry.key);
    return true;
  }

  async list(designId: string): Promise<DesignSaveOutboxEntry[]> {
    return [...this.entries.values()]
      .filter((entry) => entry.designId === designId)
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .map((entry) => structuredClone(entry));
  }

  async pruneOlderThan(updatedAt: number): Promise<number> {
    let pruned = 0;
    for (const [key, entry] of this.entries) {
      if (entry.updatedAt >= updatedAt) continue;
      this.entries.delete(key);
      pruned += 1;
    }
    return pruned;
  }
}

function fileEntry(revision: number, content = `revision-${revision}`) {
  return createDesignSaveOutboxEntry({
    designId: "design-1",
    actionName: "update-file",
    resourceId: "file-1",
    operationSource: "editor-session-1",
    operationRevision: revision,
    payload: {
      id: "file-1",
      content,
      operationSource: "editor-session-1",
      operationRevision: revision,
    },
    updatedAt: Date.now() + revision,
  });
}

describe("design save outbox", () => {
  it("keeps the newest revision when an older journal write finishes later", async () => {
    const storage = new MemoryOutboxStorage();
    await journalDesignSaveOutboxEntry(fileEntry(3), storage);
    await journalDesignSaveOutboxEntry(fileEntry(2), storage);

    expect((await storage.list("design-1"))[0]?.operationRevision).toBe(3);
  });

  it("does not let a stale acknowledgement delete a newer edit", async () => {
    const storage = new MemoryOutboxStorage();
    const stale = fileEntry(1);
    const latest = fileEntry(2);
    await journalDesignSaveOutboxEntry(stale, storage);
    await journalDesignSaveOutboxEntry(latest, storage);

    await expect(
      acknowledgeDesignSaveOutboxEntry(stale, storage),
    ).resolves.toBe(false);
    expect((await storage.list("design-1"))[0]?.operationRevision).toBe(2);
  });

  it("does not let a stale cancellation discard a newer queued edit", async () => {
    const storage = new MemoryOutboxStorage();
    const cancelled = fileEntry(4);
    const latest = fileEntry(5);
    await journalDesignSaveOutboxEntry(cancelled, storage);
    await journalDesignSaveOutboxEntry(latest, storage);

    await expect(
      discardDesignSaveOutboxEntry(cancelled, storage),
    ).resolves.toBe(false);
    expect((await storage.list("design-1"))[0]?.operationRevision).toBe(5);
  });

  it("replays an HTML payload larger than keepalive limits after reload", async () => {
    const storage = new MemoryOutboxStorage();
    const content = `<main>${"x".repeat(70_000)}</main>`;
    await journalDesignSaveOutboxEntry(fileEntry(1, content), storage);
    const invokeAction = vi.fn().mockResolvedValue({ ok: true });

    const result = await drainDesignSaveOutbox({
      designId: "design-1",
      invokeAction,
      storage,
    });

    expect(result.failed).toEqual([]);
    expect(result.saved).toHaveLength(1);
    expect(invokeAction).toHaveBeenCalledWith(
      "update-file",
      expect.objectContaining({ content }),
    );
    expect(await storage.list("design-1")).toEqual([]);
  });

  it("retains conflicts and other failures for a later retry", async () => {
    const storage = new MemoryOutboxStorage();
    await journalDesignSaveOutboxEntry(fileEntry(1), storage);
    const conflict = Object.assign(new Error("version conflict"), {
      status: 409,
    });

    const result = await drainDesignSaveOutbox({
      designId: "design-1",
      invokeAction: vi.fn().mockRejectedValue(conflict),
      storage,
    });

    expect(result.failed).toHaveLength(1);
    expect(await storage.list("design-1")).toHaveLength(1);
  });

  it("never replays an unguarded live-collaboration mirror", async () => {
    const storage = new MemoryOutboxStorage();
    const unsafe = fileEntry(1);
    unsafe.payload.syncCollab = false;
    await journalDesignSaveOutboxEntry(unsafe, storage);
    const invokeAction = vi.fn();

    const result = await drainDesignSaveOutbox({
      designId: "design-1",
      invokeAction,
      storage,
    });

    expect(result.failed).toHaveLength(1);
    expect(invokeAction).not.toHaveBeenCalled();
    expect(await storage.list("design-1")).toHaveLength(1);
  });

  it("prunes abandoned sessions after 30 days without touching fresh edits", async () => {
    const storage = new MemoryOutboxStorage();
    const now = Date.now();
    const stale = fileEntry(1);
    stale.operationSource = "abandoned-tab";
    stale.key = `${stale.key}:abandoned-tab`;
    stale.updatedAt = now - DESIGN_SAVE_OUTBOX_RETENTION_MS - 1;
    const fresh = fileEntry(2);
    fresh.updatedAt = now;
    await storage.putLatest(stale);
    await storage.putLatest(fresh);

    await drainDesignSaveOutbox({
      designId: "design-1",
      invokeAction: vi.fn().mockRejectedValue(new Error("offline")),
      storage,
    });

    const remaining = await storage.list("design-1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.operationRevision).toBe(2);
  });
});
