import { describe, expect, it, vi } from "vitest";

import {
  LocalModelStore,
  type LocalModelStorage,
  type ModelCheckpoint,
  type ModelRecord,
} from "./local-model-store";

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((yes, no) => {
    resolvePromise = yes;
    rejectPromise = no;
  });
  return {
    promise,
    resolve(value: T) {
      resolvePromise?.(value);
    },
    reject(reason?: unknown) {
      rejectPromise?.(reason);
    },
  };
}

function memoryStorage(
  initial?: ModelCheckpoint,
): LocalModelStorage & { value?: ModelCheckpoint } {
  return {
    value: initial,
    async read(scope) {
      return this.value?.scope === scope
        ? structuredClone(this.value)
        : undefined;
    },
    async write(scope, checkpoint) {
      this.value = structuredClone({ ...checkpoint, scope });
    },
    async clear() {
      this.value = undefined;
    },
  };
}

const checkpoint = (scope: string, id = "1"): ModelCheckpoint => ({
  scope,
  savedAt: Date.now(),
  cursor: null,
  models: { task: { [id]: { id, title: "before", status: "open" } } },
  collections: {
    all: { model: "task", ids: [id], meta: { total: 1 }, updatedAt: 1 },
  },
});

describe("LocalModelStore", () => {
  it("isolates scopes and exposes only exact collection membership", async () => {
    const storage = memoryStorage(checkpoint("other"));
    const store = new LocalModelStore("mine", storage);
    await store.open();
    expect(store.readCollection("all")).toBeUndefined();
    const version = store.getReadVersion();
    store.captureCollection(
      "all",
      "task",
      [
        { id: "1", title: "one" },
        { id: "2", title: "two" },
      ],
      {},
      version,
      false,
    );
    store.captureCollection(
      "all",
      "task",
      [{ id: "2", title: "two" }],
      {},
      version,
      false,
    );
    expect(store.readCollection("all")?.rows.map((row) => row.id)).toEqual([
      "2",
    ]);
  });

  it("keeps collection references stable across unrelated changes and refreshes affected projections", async () => {
    const store = new LocalModelStore("s", memoryStorage(checkpoint("s")));
    await store.open();
    const original = store.readCollection("all");
    expect(original).toBeDefined();
    store.captureCollection(
      "notes",
      "note",
      [{ id: "n1", text: "note" }],
      {},
      store.getReadVersion(),
      false,
    );
    const sameAfterOtherModel = store.readCollection("all");
    expect(sameAfterOtherModel).toBe(original);

    await store.setCursor("next");
    expect(store.readCollection("all")).toBe(original);

    const token = store.beginPatch("task", "1", { title: "edited" });
    const edited = store.readCollection("all");
    expect(edited).not.toBe(original);
    expect(edited?.rows[0].title).toBe("edited");
    expect(store.readCollection("all")).toBe(edited);

    store.rollback(token);
    const rolledBack = store.readCollection("all");
    expect(rolledBack).not.toBe(edited);
    expect(rolledBack?.rows[0].title).toBe("before");
  });

  it("keeps identical JSON row and metadata references while refreshing freshness", async () => {
    const initial = checkpoint("s");
    initial.collections.all.updatedAt = Date.now() - 10_000;
    const store = new LocalModelStore("s", memoryStorage(initial));
    await store.open();
    const original = store.readCollection("all");
    expect(original).toBeDefined();
    const originalUpdatedAt = original?.updatedAt ?? 0;

    store.captureCollection(
      "all",
      "task",
      [{ status: "open", title: "before", id: "1" }],
      { total: 1 },
      store.getReadVersion(),
      false,
    );
    const refreshed = store.readCollection("all");
    expect(refreshed).toBe(original);
    expect(refreshed?.rows).toBe(original?.rows);
    expect(refreshed?.meta).toBe(original?.meta);
    expect(refreshed?.updatedAt).toBeGreaterThan(originalUpdatedAt);
  });

  it.each([
    [{ id: "2", title: "valid first row" }, { title: "missing id" }],
    [{ id: "" }],
    [{ id: "2" }, { id: "2" }],
  ])("rejects invalid collection rows atomically: %j", async (rows) => {
    const store = new LocalModelStore("s", memoryStorage(checkpoint("s")));
    await store.open();
    const original = store.readCollection("all");
    expect(() =>
      store.captureCollection(
        "broken",
        "task",
        rows as unknown as ModelRecord[],
        { total: 2 },
        store.getReadVersion(),
        false,
      ),
    ).toThrow();
    expect(store.readCollection("broken")).toBeUndefined();
    expect(store.readCollection("all")).toBe(original);
    expect(store.readCollection("all")?.rows).toEqual([
      { id: "1", title: "before", status: "open" },
    ]);
  });

  it("marks memberships stale while preserving canonical rows and pending overlays", async () => {
    const store = new LocalModelStore("s", memoryStorage(checkpoint("s")));
    await store.open();
    const token = store.beginPatch("task", "1", { title: "pending" });
    const beforeInvalidation = store.readCollection("all");
    await store.invalidateCollections();
    const afterInvalidation = store.readCollection("all");
    expect(afterInvalidation).not.toBe(beforeInvalidation);
    expect(afterInvalidation).toMatchObject({
      rows: [{ id: "1", title: "pending", status: "open" }],
      updatedAt: 0,
    });
    store.rollback(token);
    expect(store.readCollection("all")?.rows[0].title).toBe("before");
  });

  it("marks one collection stale without advancing the in-flight read fence", async () => {
    const store = new LocalModelStore("s", memoryStorage(checkpoint("s")));
    await store.open();
    const readVersion = store.getReadVersion();
    await store.markCollectionStale("all");
    expect(store.readCollection("all")?.updatedAt).toBe(0);
    expect(store.getReadVersion()).toBe(readVersion);
    store.captureCollection(
      "all",
      "task",
      [{ id: "1", title: "fresh", status: "open" }],
      { total: 1 },
      readVersion,
      false,
    );
    expect(store.readCollection("all")?.updatedAt).toBeGreaterThan(0);
  });

  it("evicts least-recently-used collections and prunes their orphan records", async () => {
    const storage = memoryStorage();
    const store = new LocalModelStore("s", storage, { maxCollections: 2 });
    await store.open();
    store.captureCollection(
      "a",
      "task",
      [{ id: "a", title: "A" }],
      {},
      store.getReadVersion(),
      true,
    );
    store.captureCollection(
      "b",
      "task",
      [{ id: "b", title: "B" }],
      {},
      store.getReadVersion(),
      true,
    );
    store.readCollection("a");
    store.captureCollection(
      "c",
      "task",
      [{ id: "c", title: "C" }],
      {},
      store.getReadVersion(),
      true,
    );
    await store.setCursor(null);

    expect(store.readCollection("a")?.rows[0].title).toBe("A");
    expect(store.readCollection("b")).toBeUndefined();
    expect(store.readCollection("c")?.rows[0].title).toBe("C");
    expect(storage.value?.models.task).toEqual({
      a: { id: "a", title: "A" },
      c: { id: "c", title: "C" },
    });
    expect(storage.value?.collections).not.toHaveProperty("b");
  });

  it("protects collections with pending patches until the patch settles", async () => {
    const store = new LocalModelStore("s", memoryStorage(), {
      maxCollections: 1,
    });
    await store.open();
    store.captureCollection(
      "a",
      "task",
      [{ id: "a", title: "A" }],
      {},
      store.getReadVersion(),
      false,
    );
    const token = store.beginPatch("task", "a", { title: "pending" });
    store.captureCollection(
      "b",
      "task",
      [{ id: "b", title: "B" }],
      {},
      store.getReadVersion(),
      false,
    );
    expect(store.readCollection("a")?.rows[0].title).toBe("pending");
    expect(store.readCollection("b")?.rows[0].title).toBe("B");

    store.rollback(token);
    expect(store.readCollection("a")).toBeUndefined();
    expect(store.readCollection("b")?.rows[0].title).toBe("B");
  });

  it("keeps an oversized live collection in memory but omits it from storage", async () => {
    const storage = memoryStorage();
    const store = new LocalModelStore("s", storage, { maxBytes: 512 });
    await store.open();
    const largeTitle = "x".repeat(2_000);
    store.captureCollection(
      "large",
      "task",
      [{ id: "large", title: largeTitle }],
      {},
      store.getReadVersion(),
      true,
    );
    await store.setCursor(null);

    expect(store.readCollection("large")?.rows[0].title).toBe(largeTitle);
    expect(storage.value?.models).toEqual({});
    expect(storage.value?.collections).toEqual({});
    expect(
      new TextEncoder().encode(JSON.stringify(storage.value)).byteLength,
    ).toBeLessThanOrEqual(512);
  });

  it("does not write a clean unchanged cursor", async () => {
    const storage = memoryStorage(checkpoint("s"));
    let writes = 0;
    storage.write = async () => {
      writes += 1;
    };
    const store = new LocalModelStore("s", storage);
    await store.open();
    await store.setCursor(null);
    expect(writes).toBe(0);
  });

  it("restores a newly persisted collection from a cold store", async () => {
    const storage = memoryStorage();
    const store = new LocalModelStore("s", storage);
    await store.open();
    store.captureCollection(
      "all",
      "task",
      [{ id: "1", title: "saved" }],
      {},
      store.getReadVersion(),
      true,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(storage.value?.savedAt).toBeGreaterThan(0);
    const coldStore = new LocalModelStore("s", storage);
    await coldStore.open();
    expect(coldStore.readCollection("all")?.rows).toEqual([
      { id: "1", title: "saved" },
    ]);
  });

  it("does not let a non-persistable capture leak through later allowed writes", async () => {
    const storage = memoryStorage();
    const store = new LocalModelStore("s", storage);
    await store.open();
    store.captureCollection(
      "private",
      "note",
      [{ id: "secret", body: "private value" }],
      {},
      store.getReadVersion(),
      false,
    );
    store.captureCollection(
      "public",
      "task",
      [{ id: "1", title: "public value" }],
      {},
      store.getReadVersion(),
      true,
    );
    await store.setCursor("cursor-1");
    expect(storage.value?.models).toEqual({
      task: { "1": { id: "1", title: "public value" } },
    });
    expect(storage.value?.collections).not.toHaveProperty("private");
  });

  it("persists live data when it arrives before the initial storage read completes", async () => {
    const read = deferred<ModelCheckpoint | undefined>();
    const storage = memoryStorage();
    storage.read = () => read.promise;
    const store = new LocalModelStore("s", storage);
    const opening = store.open();
    store.captureCollection(
      "all",
      "task",
      [{ id: "1", title: "live" }],
      {},
      store.getReadVersion(),
      true,
    );
    read.resolve(undefined);
    await opening;
    await store.setCursor(null);
    storage.read = async (scope) =>
      storage.value?.scope === scope
        ? structuredClone(storage.value)
        : undefined;
    const coldStore = new LocalModelStore("s", storage);
    await coldStore.open();
    expect(coldStore.readCollection("all")?.rows).toEqual([
      { id: "1", title: "live" },
    ]);
  });

  it("rejects checkpoints whose collection references missing records", async () => {
    const incomplete = checkpoint("s");
    incomplete.collections.all.ids = ["missing"];
    const store = new LocalModelStore("s", memoryStorage(incomplete));
    await expect(store.open()).rejects.toThrow(
      "Invalid local model checkpoint",
    );
    expect(store.readCollection("all")).toBeUndefined();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a non-finite checkpoint timestamp (%s)",
    async (savedAt) => {
      const invalid = checkpoint("s");
      invalid.savedAt = savedAt;
      const store = new LocalModelStore("s", memoryStorage(invalid));
      await expect(store.open()).rejects.toThrow(
        "Invalid local model checkpoint",
      );
    },
  );

  it("treats prototype-shaped model, record, and collection ids as data", async () => {
    const hostileCheckpoint = JSON.parse(
      '{"scope":"s","savedAt":' +
        Date.now() +
        ',"cursor":null,"models":{"__proto__":{"__proto__":{"id":"__proto__","value":"safe"}}},"collections":{"__proto__":{"model":"__proto__","ids":["__proto__"],"meta":{},"updatedAt":1}}}',
    ) as ModelCheckpoint;
    const store = new LocalModelStore("s", memoryStorage(hostileCheckpoint));
    await store.open();
    expect(store.readCollection("__proto__")?.rows).toEqual([
      { id: "__proto__", value: "safe" },
    ]);
    expect(Object.prototype).not.toHaveProperty("value");
  });

  it("rejects late restore after clear and queues clear behind an in-flight write", async () => {
    const read = deferred<ModelCheckpoint | undefined>();
    const write = deferred<void>();
    let cleared = false;
    const storage: LocalModelStorage = {
      read: () => read.promise,
      write: () => write.promise,
      async clear() {
        cleared = true;
      },
    };
    const store = new LocalModelStore("s", storage);
    const opening = store.open();
    read.resolve(checkpoint("s"));
    await opening;

    store.captureCollection(
      "all",
      "task",
      [{ id: "1" }],
      {},
      store.getReadVersion(),
      true,
    );
    const clearing = store.clear();
    await Promise.resolve();
    expect(cleared).toBe(false);
    write.resolve();
    await clearing;
    expect(cleared).toBe(true);
    expect(store.readCollection("all")).toBeUndefined();

    const lateRead = deferred<ModelCheckpoint | undefined>();
    const lateStore = new LocalModelStore("s", {
      ...storage,
      read: () => lateRead.promise,
    });
    const lateOpen = lateStore.open();
    await lateStore.clear();
    lateRead.resolve(checkpoint("s"));
    await lateOpen;
    expect(lateStore.readCollection("all")).toBeUndefined();
  });

  it("rolls back only its own pending fields and lets newer acknowledgements win", async () => {
    const store = new LocalModelStore("s", memoryStorage(checkpoint("s")));
    await store.open();
    const older = store.beginPatch("task", "1", { title: "older" });
    const newer = store.beginPatch("task", "1", {
      title: "newer",
      status: "done",
    });
    store.rollback(older);
    expect(store.readCollection("all")?.rows[0]).toMatchObject({
      title: "newer",
      status: "done",
    });
    store.rollback(newer);
    expect(store.readCollection("all")?.rows[0]).toMatchObject({
      title: "before",
      status: "open",
    });

    const first = store.beginPatch("task", "1", { title: "first" });
    const second = store.beginPatch("task", "1", { title: "second" });
    store.confirm(second);
    expect(store.readCollection("all")?.rows[0].title).toBe("second");
    store.confirm(first);
    expect(store.readCollection("all")?.rows[0].title).toBe("second");
  });

  it("persists canonical fields only and does not persist optimistic overlays", async () => {
    const storage = memoryStorage(checkpoint("s"));
    const store = new LocalModelStore("s", storage);
    await store.open();
    const token = store.beginPatch("task", "1", { title: "optimistic" });
    expect(storage.value?.models.task["1"].title).toBe("before");
    store.confirm(token, { title: "canonical", extra: "ignored" });
    expect(store.readCollection("all")?.rows[0].title).toBe("canonical");
    store.captureCollection(
      "all",
      "task",
      [{ id: "1", title: "canonical", status: "open" }],
      {},
      store.getReadVersion(),
      true,
    );
    await store.setCursor(store.cursor);
    expect(storage.value?.models.task["1"]).toMatchObject({
      title: "canonical",
      status: "open",
    });
    expect(storage.value?.models.task["1"]).not.toHaveProperty("extra");
  });

  it("keeps cursor unchanged when checkpoint persistence fails", async () => {
    const failure = new Error("disk full");
    const storage = memoryStorage(checkpoint("s"));
    storage.write = async () => {
      throw failure;
    };
    const store = new LocalModelStore("s", storage);
    await store.open();
    await expect(store.setCursor("next")).rejects.toBe(failure);
    expect(store.cursor).toBeNull();
    expect(store.error).toBe(failure);
  });

  it("serializes cursor updates with intervening collection writes", async () => {
    const storage = memoryStorage(checkpoint("s"));
    const firstWriteStarted = deferred<void>();
    const releaseFirstWrite = deferred<void>();
    const write = storage.write.bind(storage);
    let writeCount = 0;
    storage.write = async (scope, value) => {
      writeCount += 1;
      if (writeCount === 1) {
        firstWriteStarted.resolve();
        await releaseFirstWrite.promise;
      }
      await write(scope, value);
    };
    const store = new LocalModelStore("s", storage);
    await store.open();
    const firstCursor = store.setCursor("first");
    await firstWriteStarted.promise;
    store.captureCollection(
      "notes",
      "note",
      [{ id: "n1", text: "between cursors" }],
      {},
      store.getReadVersion(),
      true,
    );
    const secondCursor = store.setCursor("second");
    releaseFirstWrite.resolve();
    await Promise.all([firstCursor, secondCursor]);
    expect(store.cursor).toBe("second");
    expect(storage.value?.cursor).toBe("second");
    expect(storage.value?.collections.notes.ids).toEqual(["n1"]);
  });

  it("retries storage clear after an earlier clear failure", async () => {
    let attempts = 0;
    const storage = memoryStorage();
    storage.clear = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary failure");
      storage.value = undefined;
    };
    const store = new LocalModelStore("s", storage);
    await expect(store.clear()).rejects.toThrow("temporary failure");
    await store.clear();
    expect(attempts).toBe(2);
  });

  it("coalesces checkpoint writes while an idle serialization slot is pending", async () => {
    const storage = memoryStorage();
    const slot = deferred<void>();
    let writes = 0;
    const save = storage.write.bind(storage);
    storage.scheduleWrite = () => slot.promise;
    storage.write = async (scope, value) => {
      writes += 1;
      await save(scope, value);
    };
    const store = new LocalModelStore("s", storage);
    await store.open();
    store.captureCollection(
      "one",
      "task",
      [{ id: "1" }],
      {},
      store.getReadVersion(),
      true,
    );
    await Promise.resolve();
    store.captureCollection(
      "two",
      "task",
      [{ id: "2" }],
      {},
      store.getReadVersion(),
      true,
    );
    const flushed = store.setCursor("next");
    slot.resolve();
    await flushed;
    expect(writes).toBeLessThanOrEqual(2);
    expect(storage.value?.collections.one?.ids).toEqual(["1"]);
    expect(storage.value?.collections.two?.ids).toEqual(["2"]);
    expect(storage.value?.cursor).toBe("next");
  });

  it("does not serialize a revoked scope after its pending idle slot runs", async () => {
    const storage = memoryStorage();
    const slot = deferred<void>();
    const started = deferred<void>();
    storage.scheduleWrite = () => {
      started.resolve();
      return slot.promise;
    };
    const write = vi.spyOn(storage, "write");
    const store = new LocalModelStore("s", storage);
    await store.open();
    store.captureCollection(
      "one",
      "task",
      [{ id: "1" }],
      {},
      store.getReadVersion(),
      true,
    );
    await started.promise;
    const cleared = store.clear();
    expect(store.readCollection("one")).toBeUndefined();
    slot.resolve();
    await cleared;
    expect(write).not.toHaveBeenCalled();
    expect(storage.value).toBeUndefined();
  });

  it("keeps nested canonical confirmation values owned by the store", async () => {
    const storage = memoryStorage(checkpoint("s"));
    const store = new LocalModelStore("s", storage);
    await store.open();
    const token = store.beginPatch("task", "1", { labels: [] });
    const canonical = { labels: [{ id: "label", name: "Confirmed" }] };
    store.confirm(token, canonical);
    canonical.labels[0]!.name = "Changed outside the store";
    expect(store.readCollection("all")?.rows[0]?.labels).toEqual([
      { id: "label", name: "Confirmed" },
    ]);
    store.captureCollection(
      "all",
      "task",
      store.readCollection("all")!.rows as ModelRecord[],
      { total: 1 },
      store.getReadVersion(),
      true,
    );
    await store.setCursor("confirmed");
    expect(storage.value?.models.task?.["1"]?.labels).toEqual([
      { id: "label", name: "Confirmed" },
    ]);
  });

  it("detaches pending nested values from snapshots retained through confirmation", async () => {
    const storage = memoryStorage(checkpoint("s"));
    const store = new LocalModelStore("s", storage, { maxBytes: 1024 });
    await store.open();
    const token = store.beginPatch("task", "1", { details: { note: "draft" } });
    const retained = store.readCollection("all")!.rows[0]!.details as {
      note: string;
    };
    retained.note = "Changed before confirmation";
    store.confirm(token);
    expect(store.readCollection("all")?.rows[0]?.details).toEqual({
      note: "draft",
    });
    store.captureCollection(
      "all",
      "task",
      store.readCollection("all")!.rows as ModelRecord[],
      { total: 1 },
      store.getReadVersion(),
      true,
    );
    await store.setCursor("first");
    retained.note = "界".repeat(2048);
    await store.setCursor("second");
    expect(storage.value?.models.task?.["1"]?.details).toEqual({
      note: "draft",
    });
    expect(
      new TextEncoder().encode(JSON.stringify(storage.value)).byteLength,
    ).toBeLessThanOrEqual(1024);
  });

  it("retains an unchanged multibyte record at the exact byte cap", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    try {
      const initial = checkpoint("s");
      initial.models.task!["1"]!.title = "界é";
      const fullStorage = memoryStorage(initial);
      const full = new LocalModelStore("s", fullStorage);
      await full.open();
      await full.setCursor("one");
      const bytes = new TextEncoder().encode(
        JSON.stringify(fullStorage.value),
      ).byteLength;
      for (const cap of [bytes, bytes - 1]) {
        const storage = memoryStorage(initial);
        const store = new LocalModelStore("s", storage, { maxBytes: cap });
        await store.open();
        await store.setCursor("one");
        await store.setCursor("two");
        expect(Boolean(storage.value?.collections.all)).toBe(cap === bytes);
        expect(
          new TextEncoder().encode(JSON.stringify(storage.value)).byteLength,
        ).toBeLessThanOrEqual(cap);
      }
    } finally {
      clock.mockRestore();
    }
  });

  it("does not reserialize unchanged records when only the cursor changes", async () => {
    const storage = memoryStorage(checkpoint("s"));
    const store = new LocalModelStore("s", storage);
    await store.open();
    await store.setCursor("first");
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      await store.setCursor("second");
      const recordCalls = stringify.mock.calls.filter(
        ([value]) => value && typeof value === "object" && value.id === "1",
      );
      expect(recordCalls).toHaveLength(0);
      expect(storage.value?.cursor).toBe("second");
      expect(storage.value?.models.task?.["1"]?.title).toBe("before");
    } finally {
      stringify.mockRestore();
    }
  });

  it("rechecks the byte limit after a canonical confirmation grows a record", async () => {
    const storage = memoryStorage(checkpoint("s"));
    const store = new LocalModelStore("s", storage, { maxBytes: 1024 });
    await store.open();
    await store.setCursor("first");
    expect(storage.value?.collections.all).toBeDefined();
    const token = store.beginPatch("task", "1", { title: "pending" });
    store.confirm(token, { title: "界".repeat(2048) });
    store.captureCollection(
      "all",
      "task",
      [{ id: "1", title: "界".repeat(2048), status: "open" }],
      { total: 1 },
      store.getReadVersion(),
      true,
    );
    await store.setCursor("second");
    expect(store.readCollection("all")?.rows[0]?.title).toHaveLength(2048);
    expect(storage.value?.collections.all).toBeUndefined();
    expect(
      new TextEncoder().encode(JSON.stringify(storage.value)).byteLength,
    ).toBeLessThanOrEqual(1024);
  });

  it("keeps written snapshots independent when storage retains and mutates them", async () => {
    const storage = memoryStorage(checkpoint("s"));
    storage.write = async (_scope, value) => {
      storage.value = value;
    };
    const store = new LocalModelStore("s", storage);
    await store.open();
    await store.setCursor("first");
    storage.value!.models.task!["1"]!.title = "Changed by storage";
    expect(store.readCollection("all")?.rows[0]?.title).toBe("before");
    await store.setCursor("second");
    expect(storage.value?.models.task?.["1"]?.title).toBe("before");
  });

  it("serializes accepted records once instead of cloning every candidate checkpoint", async () => {
    const initial = checkpoint("s");
    initial.models = {
      task: Object.fromEntries(
        Array.from({ length: 32 }, (_, i) => [
          String(i),
          { id: String(i), title: `Item ${i}` },
        ]),
      ),
    };
    initial.collections = Object.fromEntries(
      Array.from({ length: 32 }, (_, i) => [
        `collection-${i}`,
        { model: "task", ids: [String(i)], meta: {}, updatedAt: Date.now() },
      ]),
    );
    const storage = memoryStorage(initial);
    const store = new LocalModelStore("s", storage);
    await store.open();
    const clone = vi.spyOn(globalThis, "structuredClone");
    try {
      await store.setCursor("next");
      expect(Object.keys(storage.value?.models.task ?? {})).toHaveLength(32);
      expect(clone.mock.calls.length).toBeLessThanOrEqual(66);
    } finally {
      clone.mockRestore();
    }
  });
});
