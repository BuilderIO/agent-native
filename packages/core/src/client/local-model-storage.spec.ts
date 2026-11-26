import { beforeEach, describe, expect, it, vi } from "vitest";

const indexedDb = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  getHandler: undefined as ((key: string) => Promise<unknown>) | undefined,
  setHandler: undefined as
    | ((key: string, value: unknown) => Promise<void>)
    | undefined,
}));

vi.mock("idb-keyval", () => ({
  createStore: vi.fn(() => ({})),
  get: vi.fn(async (key: string) => {
    if (indexedDb.getHandler) return indexedDb.getHandler(key);
    return indexedDb.values.get(key);
  }),
  set: vi.fn(async (key: string, value: unknown) => {
    if (indexedDb.setHandler) return indexedDb.setHandler(key, value);
    indexedDb.values.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    indexedDb.values.delete(key);
  }),
}));

import { createLocalModelStorage } from "./local-model-storage.js";
import type { ModelCheckpoint } from "./local-model-store.js";

class MemoryLocalStorage {
  private values = new Map<string, string>();
  failWrites = false;
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("localStorage write failed");
    this.values.set(key, value);
  }
}

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value: T) => resolvePromise?.(value) };
}

function sampleCheckpoint(scope: string, body: string): ModelCheckpoint {
  return {
    scope,
    savedAt: Date.now(),
    cursor: null,
    models: { note: { "1": { id: "1", body } } },
    collections: {
      all: { model: "note", ids: ["1"], meta: {}, updatedAt: Date.now() },
    },
  };
}

describe("createLocalModelStorage", () => {
  let uuid = 0;

  beforeEach(() => {
    indexedDb.values.clear();
    indexedDb.getHandler = undefined;
    indexedDb.setHandler = undefined;
    uuid = 0;
    vi.stubGlobal("localStorage", new MemoryLocalStorage());
    vi.stubGlobal("crypto", { randomUUID: () => `epoch-${++uuid}` });
  });

  it("isolates checkpoints by verified user, organization, and build scope", async () => {
    const aliceScope = JSON.stringify(["alice", "org-a", "build-1"]);
    const bobScope = JSON.stringify(["bob", "org-a", "build-1"]);
    const otherOrgScope = JSON.stringify(["alice", "org-b", "build-1"]);
    const nextBuildScope = JSON.stringify(["alice", "org-a", "build-2"]);
    const alice = createLocalModelStorage(aliceScope);
    const bob = createLocalModelStorage(bobScope);
    const otherOrg = createLocalModelStorage(otherOrgScope);
    const nextBuild = createLocalModelStorage(nextBuildScope);
    await alice.write(aliceScope, sampleCheckpoint(aliceScope, "alice-only"));
    await bob.write(bobScope, sampleCheckpoint(bobScope, "bob-only"));
    await otherOrg.write(
      otherOrgScope,
      sampleCheckpoint(otherOrgScope, "other-org-only"),
    );
    await nextBuild.write(
      nextBuildScope,
      sampleCheckpoint(nextBuildScope, "new-build-only"),
    );
    expect((await alice.read(aliceScope))?.models.note["1"].body).toBe(
      "alice-only",
    );
    expect((await bob.read(bobScope))?.models.note["1"].body).toBe("bob-only");
    expect((await otherOrg.read(otherOrgScope))?.models.note["1"].body).toBe(
      "other-org-only",
    );
    expect((await nextBuild.read(nextBuildScope))?.models.note["1"].body).toBe(
      "new-build-only",
    );
  });

  it("rejects a pending read after synchronous invalidation", async () => {
    const scope = JSON.stringify(["alice", "org-a", "build-1"]);
    const storage = createLocalModelStorage(scope);
    const read = deferred<unknown>();
    indexedDb.getHandler = () => read.promise;
    const pendingRead = storage.read(scope);
    storage.invalidate();
    expect(storage.isActive()).toBe(false);
    read.resolve({
      epoch: "epoch-1",
      value: sampleCheckpoint(scope, "secret"),
    });
    expect(await pendingRead).toBeUndefined();
  });

  it("removes a pending old write without deleting a new binding checkpoint", async () => {
    const scope = JSON.stringify(["alice", "org-a", "build-1"]);
    const oldBinding = createLocalModelStorage(scope);
    const release = deferred<void>();
    indexedDb.setHandler = async (key, value) => {
      await release.promise;
      indexedDb.values.set(key, value);
    };
    const oldWrite = oldBinding.write(scope, sampleCheckpoint(scope, "secret"));
    oldBinding.invalidate();
    const newBinding = createLocalModelStorage(scope);
    oldBinding.invalidate();
    expect(newBinding.isActive()).toBe(true);
    indexedDb.setHandler = undefined;
    await newBinding.write(scope, sampleCheckpoint(scope, "current"));
    release.resolve();
    await oldWrite;
    expect((await newBinding.read(scope))?.models.note["1"].body).toBe(
      "current",
    );
    expect(oldBinding.isActive()).toBe(false);
  });

  it("keeps invalidation synchronous while clearing storage", async () => {
    const scope = JSON.stringify(["alice", "org-a", "build-1"]);
    const storage = createLocalModelStorage(scope);
    await storage.write(scope, sampleCheckpoint(scope, "secret"));
    await storage.clear(scope);
    expect(storage.isActive()).toBe(false);
    expect(await storage.read(scope)).toBeUndefined();
  });

  it("deletes the owned checkpoint when epoch rotation fails and propagates the error", async () => {
    const local = new MemoryLocalStorage();
    vi.stubGlobal("localStorage", local);
    const scope = JSON.stringify(["alice", "org-a", "build-1"]);
    const storage = createLocalModelStorage(scope);
    await storage.write(scope, sampleCheckpoint(scope, "secret"));
    expect(indexedDb.values.size).toBe(1);

    const writeStarted = deferred<void>();
    const releaseWrite = deferred<void>();
    indexedDb.setHandler = async (key, value) => {
      writeStarted.resolve();
      await releaseWrite.promise;
      indexedDb.values.set(key, value);
    };
    const pendingWrite = storage.write(
      scope,
      sampleCheckpoint(scope, "late secret"),
    );
    await writeStarted.promise;

    local.failWrites = true;
    await expect(storage.clear(scope)).rejects.toThrow(
      "localStorage write failed",
    );
    releaseWrite.resolve();
    await pendingWrite;
    expect(indexedDb.values.size).toBe(0);
    expect(storage.isActive()).toBe(false);
  });
});
