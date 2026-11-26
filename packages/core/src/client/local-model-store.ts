export type ModelRecord = Record<string, unknown> & { id: string };

type CollectionCheckpoint = {
  model: string;
  ids: string[];
  meta: Record<string, unknown>;
  updatedAt: number;
};

export type ModelCheckpoint = {
  scope: string;
  savedAt: number;
  cursor: string | null;
  models: Partial<
    Record<string, Partial<Record<string, Record<string, unknown>>>>
  >;
  collections: Partial<Record<string, CollectionCheckpoint>>;
};

export interface LocalModelStorage {
  /** Yield optional checkpoint serialization until the browser can do background work. */
  scheduleWrite?(): Promise<void>;
  read(scope: string): Promise<ModelCheckpoint | undefined>;
  write(scope: string, checkpoint: ModelCheckpoint): Promise<void>;
  clear(scope: string): Promise<void>;
}

export type CollectionSnapshot = {
  rows: Record<string, unknown>[];
  meta: Record<string, unknown>;
  updatedAt: number;
};

export type LocalModelStoreOptions = {
  maxCollections?: number;
  maxBytes?: number;
};

type PatchToken = { model: string; id: string; sequence: number };
type PendingPatch = PatchToken & { patch: Record<string, unknown> };

const emptyCheckpoint = (scope: string): ModelCheckpoint => ({
  scope,
  savedAt: 0,
  cursor: null,
  models: Object.create(null) as ModelCheckpoint["models"],
  collections: Object.create(null) as ModelCheckpoint["collections"],
});

const textEncoder = new TextEncoder();

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value);
}

// Comparisons are limited to arrays and plain JSON-compatible records from actions.
function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => sameJsonValue(value, right[index]))
    );
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && sameJsonValue(left[key], right[key]),
    )
  );
}

function parseCheckpoint(
  value: unknown,
  scope: string,
): ModelCheckpoint | undefined {
  if (
    !isPlainRecord(value) ||
    value.scope !== scope ||
    typeof value.savedAt !== "number" ||
    !Number.isFinite(value.savedAt) ||
    !(typeof value.cursor === "string" || value.cursor === null) ||
    !isPlainRecord(value.models) ||
    !isPlainRecord(value.collections)
  )
    return undefined;
  const models = Object.create(null) as ModelCheckpoint["models"];
  for (const [model, records] of Object.entries(value.models)) {
    if (!isPlainRecord(records)) return undefined;
    models[model] = Object.create(null) as Record<
      string,
      Record<string, unknown>
    >;
    for (const [id, record] of Object.entries(records)) {
      if (!isPlainRecord(record) || record.id !== id) return undefined;
      models[model][id] = cloneRecord(record);
    }
  }
  const collections = Object.create(null) as ModelCheckpoint["collections"];
  for (const [key, item] of Object.entries(value.collections)) {
    if (
      !isPlainRecord(item) ||
      typeof item.model !== "string" ||
      !Array.isArray(item.ids) ||
      !item.ids.every((id) => typeof id === "string") ||
      !isPlainRecord(item.meta) ||
      typeof item.updatedAt !== "number" ||
      !Number.isFinite(item.updatedAt)
    )
      return undefined;
    collections[key] = {
      model: item.model,
      ids: [...item.ids],
      meta: cloneRecord(item.meta),
      updatedAt: item.updatedAt,
    };
  }
  for (const collection of Object.values(collections)) {
    if (!collection) return undefined;
    if (new Set(collection.ids).size !== collection.ids.length)
      return undefined;
    const records = models[collection.model];
    if (!records || collection.ids.some((id) => records[id] === undefined))
      return undefined;
  }
  return {
    scope,
    savedAt: value.savedAt,
    cursor: value.cursor,
    models,
    collections,
  };
}

export class LocalModelStore {
  private checkpoint: ModelCheckpoint;
  private revision = 0;
  private listeners = new Set<() => void>();
  private opened = false;
  private closed = false;
  private generation = 0;
  private writeQueue: Promise<void> = Promise.resolve();
  private persistenceError: unknown;
  private mutationEpoch = 0;
  private persistenceRevision = 0;
  private persistedRevision = 0;
  private collectionSnapshots = new Map<string, CollectionSnapshot>();
  private collectionAccess = new Map<string, number>();
  private accessSequence = 0;
  private confirmedFieldSequence = new Map<string, number>();
  private recordByteSizes = new WeakMap<Record<string, unknown>, number>();
  private persistableRecords = new Map<string, Set<string>>();
  private persistableCollections = new Set<string>();
  private pending = new Map<number, PendingPatch>();
  private sequence = 0;
  private readonly maxCollections: number;
  private readonly maxBytes: number;

  constructor(
    private readonly scope: string,
    private readonly storage: LocalModelStorage,
    options: LocalModelStoreOptions = {},
  ) {
    this.maxCollections = options.maxCollections ?? 64;
    this.maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    if (!Number.isInteger(this.maxCollections) || this.maxCollections < 1) {
      throw new Error("maxCollections must be a positive integer");
    }
    if (!Number.isFinite(this.maxBytes) || this.maxBytes < 1) {
      throw new Error("maxBytes must be a positive finite number");
    }
    this.checkpoint = emptyCheckpoint(scope);
  }

  get cursor(): string | null {
    return this.checkpoint.cursor;
  }
  get error(): unknown {
    return this.persistenceError;
  }

  async open(): Promise<void> {
    if (this.closed) return;
    const generation = this.generation;
    const readVersion = this.mutationEpoch;
    const revision = this.revision;
    const restored = await this.storage.read(this.scope);
    if (this.isClosed() || generation !== this.generation) return;
    this.opened = true;
    if (readVersion !== this.mutationEpoch || revision !== this.revision) {
      this.persistWithoutThrowing();
      return;
    }
    const parsed = parseCheckpoint(restored, this.scope);
    if (
      restored !== undefined &&
      isPlainRecord(restored) &&
      restored.scope === this.scope &&
      !parsed
    ) {
      const error = new Error("Invalid local model checkpoint");
      this.persistenceError = error;
      throw error;
    }
    if (parsed && Date.now() - parsed.savedAt > 60 * 60 * 1000) {
      this.checkpoint = emptyCheckpoint(this.scope);
      this.opened = true;
      this.collectionSnapshots.clear();
      this.persistableRecords.clear();
      this.persistableCollections.clear();
      this.collectionAccess.clear();
      this.markPersistenceDirty();
      this.changed();
      this.persistWithoutThrowing();
      return;
    }
    this.checkpoint = parsed ?? emptyCheckpoint(this.scope);
    this.collectionSnapshots.clear();
    this.persistableRecords.clear();
    this.persistableCollections.clear();
    this.collectionAccess.clear();
    this.accessSequence = 0;
    if (parsed) {
      for (const [model, records] of Object.entries(parsed.models)) {
        if (!records) continue;
        this.persistableRecords.set(model, new Set(Object.keys(records)));
      }
      const collections = Object.entries(parsed.collections)
        .flatMap(([key, collection]) =>
          collection ? [[key, collection] as const] : [],
        )
        .sort((left, right) => left[1].updatedAt - right[1].updatedAt);
      for (const [key] of collections) {
        this.persistableCollections.add(key);
        this.collectionAccess.set(key, ++this.accessSequence);
      }
    }
    this.persistedRevision = this.persistenceRevision;
    const pruned = this.pruneOrphanRecords();
    const evicted = this.enforceCollectionLimit();
    if (pruned || evicted) {
      this.markPersistenceDirty();
      this.persistWithoutThrowing();
    }
    this.changed();
  }

  getSnapshot(): number {
    return this.revision;
  }

  getReadVersion(): number {
    return this.mutationEpoch;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  readCollection(key: string): CollectionSnapshot | undefined {
    if (this.closed) return undefined;
    const cached = this.collectionSnapshots.get(key);
    if (cached) {
      this.touchCollection(key);
      return cached;
    }
    const collection = this.checkpoint.collections[key];
    if (!collection) return undefined;
    this.touchCollection(key);
    const model = this.checkpoint.models[collection.model];
    if (!model) return undefined;
    const rows: Record<string, unknown>[] = [];
    for (const id of collection.ids) {
      const base = model[id];
      if (!base) return undefined;
      const row = cloneRecord(base);
      for (const entry of [...this.pending.values()]
        .filter((item) => item.model === collection.model && item.id === id)
        .sort((a, b) => a.sequence - b.sequence)) {
        for (const [field, value] of Object.entries(cloneRecord(entry.patch))) {
          const confirmedSequence =
            this.confirmedFieldSequence.get(
              `${entry.model}\0${entry.id}\0${field}`,
            ) ?? 0;
          if (entry.sequence >= confirmedSequence) row[field] = value;
        }
      }
      rows.push(row);
    }
    const snapshot = {
      rows,
      meta: cloneRecord(collection.meta),
      updatedAt: collection.updatedAt,
    };
    this.collectionSnapshots.set(key, snapshot);
    return snapshot;
  }

  captureCollection(
    key: string,
    model: string,
    rows: readonly ModelRecord[],
    meta: Record<string, unknown>,
    readVersion: number,
    persist: boolean,
  ): void {
    if (this.closed) return;
    if (readVersion !== this.mutationEpoch) return;
    const untrustedMeta: unknown = meta;
    if (!isPlainRecord(untrustedMeta))
      throw new Error("Invalid local model collection metadata");
    const nextRows: ModelRecord[] = [];
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const candidate: unknown = row;
      if (
        !isPlainRecord(candidate) ||
        typeof candidate.id !== "string" ||
        candidate.id.trim().length === 0
      ) {
        throw new Error("Invalid local model record id");
      }
      if (seen.has(candidate.id)) {
        throw new Error("Duplicate local model record id");
      }
      seen.add(candidate.id);
      ids.push(candidate.id);
      nextRows.push(cloneRecord(candidate) as ModelRecord);
    }
    const nextMeta = cloneRecord(untrustedMeta);
    const previousCollection = this.checkpoint.collections[key];
    const sameCollection =
      previousCollection?.model === model &&
      sameJsonValue(previousCollection.ids, ids) &&
      sameJsonValue(previousCollection.meta, nextMeta);
    const records =
      this.checkpoint.models[model] ??
      (this.checkpoint.models[model] = Object.create(null) as Record<
        string,
        Record<string, unknown>
      >);
    if (!sameCollection) this.invalidateCollection(key);
    for (const row of nextRows) {
      const id = row.id;
      const previousRow = records[id];
      if (!previousRow || !sameJsonValue(previousRow, row)) {
        this.invalidateRecordCollections(model, id);
        records[id] = row;
      }
    }
    const updatedAt = Date.now();
    this.checkpoint.collections[key] = {
      model,
      ids,
      meta: sameCollection ? previousCollection.meta : nextMeta,
      updatedAt,
    };
    const cached = this.collectionSnapshots.get(key);
    if (sameCollection && cached) {
      cached.updatedAt = updatedAt;
    } else {
      this.invalidateCollection(key);
    }
    this.touchCollection(key);
    const persistableIds =
      this.persistableRecords.get(model) ?? new Set<string>();
    for (const id of ids) {
      if (persist) persistableIds.add(id);
      else persistableIds.delete(id);
    }
    this.persistableRecords.set(model, persistableIds);
    if (persist) this.persistableCollections.add(key);
    else this.persistableCollections.delete(key);
    this.pruneOrphanRecords();
    this.enforceCollectionLimit(key);
    this.markPersistenceDirty();
    this.changed();
    this.persistWithoutThrowing();
  }

  beginPatch(
    model: string,
    id: string,
    patch: Record<string, unknown>,
  ): number {
    if (this.closed) return -1;
    const token = ++this.sequence;
    this.pending.set(token, {
      model,
      id,
      sequence: token,
      patch: cloneRecord(patch),
    });
    this.invalidateRecordCollections(model, id);
    this.persistableRecords.get(model)?.delete(id);
    this.mutationEpoch += 1;
    this.markPersistenceDirty();
    this.changed();
    this.persistWithoutThrowing();
    return token;
  }

  confirm(token: number, canonicalPatch?: Record<string, unknown>): void {
    if (this.closed) return;
    const entry = this.pending.get(token);
    if (!entry) return;
    const canonicalValues = canonicalPatch
      ? cloneRecord(canonicalPatch)
      : undefined;
    this.pending.delete(token);
    this.mutationEpoch += 1;
    this.invalidateRecordCollections(entry.model, entry.id);
    const records =
      this.checkpoint.models[entry.model] ??
      (this.checkpoint.models[entry.model] = Object.create(null) as Record<
        string,
        Record<string, unknown>
      >);
    const current = records[entry.id] ?? (records[entry.id] = { id: entry.id });
    const ownKeys = Object.keys(entry.patch);
    const accepted: Record<string, unknown> = {};
    for (const key of ownKeys) {
      const fieldKey = `${entry.model}\0${entry.id}\0${key}`;
      if ((this.confirmedFieldSequence.get(fieldKey) ?? 0) > token) continue;
      if (
        canonicalValues &&
        Object.prototype.hasOwnProperty.call(canonicalValues, key)
      ) {
        accepted[key] = canonicalValues[key];
      } else {
        accepted[key] = entry.patch[key];
      }
      this.confirmedFieldSequence.set(fieldKey, token);
    }
    this.recordByteSizes.delete(current);
    Object.assign(current, accepted);
    this.pruneOrphanRecords();
    this.enforceCollectionLimit();
    this.markPersistenceDirty();
    this.changed();
    this.persistWithoutThrowing();
  }

  rollback(token: number): void {
    if (this.closed) return;
    const entry = this.pending.get(token);
    if (!entry || !this.pending.delete(token)) return;
    this.mutationEpoch += 1;
    this.invalidateRecordCollections(entry.model, entry.id);
    this.pruneOrphanRecords();
    this.enforceCollectionLimit();
    this.markPersistenceDirty();
    this.changed();
    this.persistWithoutThrowing();
  }

  async invalidateCollections(): Promise<void> {
    if (this.closed) return;
    this.mutationEpoch += 1;
    for (const collection of Object.values(this.checkpoint.collections)) {
      if (!collection) continue;
      collection.updatedAt = 0;
    }
    this.collectionSnapshots.clear();
    this.markPersistenceDirty();
    this.changed();
    await this.enqueueWrite();
  }

  async markCollectionStale(key: string): Promise<void> {
    if (this.closed) return;
    const collection = this.checkpoint.collections[key];
    if (!collection || collection.updatedAt === 0) return;
    collection.updatedAt = 0;
    this.invalidateCollection(key);
    this.markPersistenceDirty();
    this.changed();
    await this.enqueueWrite();
  }

  async setCursor(cursor: string | null): Promise<void> {
    if (this.closed) return;
    if (cursor === this.checkpoint.cursor && this.isCheckpointClean()) return;
    if (cursor !== this.checkpoint.cursor) this.markPersistenceDirty();
    await this.enqueueWrite(cursor, true);
  }

  async clear(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.generation += 1;
      this.mutationEpoch += 1;
      this.checkpoint = emptyCheckpoint(this.scope);
      this.collectionSnapshots.clear();
      this.collectionAccess.clear();
      this.pending.clear();
      this.persistableRecords.clear();
      this.persistableCollections.clear();
      this.changed();
    }
    const generation = this.generation;
    const clearWrite = this.writeQueue
      .catch(() => undefined)
      .then(() => {
        if (generation === this.generation)
          return this.storage.clear(this.scope);
      });
    this.writeQueue = clearWrite;
    await clearWrite;
  }

  private changed(): void {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  private isClosed(): boolean {
    return this.closed;
  }

  private markPersistenceDirty(): void {
    this.persistenceRevision += 1;
  }

  private isCheckpointClean(): boolean {
    return this.persistenceRevision === this.persistedRevision;
  }

  private touchCollection(key: string): void {
    this.collectionAccess.set(key, ++this.accessSequence);
  }

  private enforceCollectionLimit(protectedKey?: string): boolean {
    let evicted = false;
    while (
      Object.keys(this.checkpoint.collections).length > this.maxCollections
    ) {
      const candidates = Object.entries(this.checkpoint.collections)
        .flatMap(([key, collection]) =>
          collection &&
          key !== protectedKey &&
          !this.hasPendingPatch(collection)
            ? [[key, collection] as const]
            : [],
        )
        .sort(
          (left, right) =>
            (this.collectionAccess.get(left[0]) ?? 0) -
            (this.collectionAccess.get(right[0]) ?? 0),
        );
      const candidate = candidates.at(0);
      if (!candidate) break;
      const [key] = candidate;
      delete this.checkpoint.collections[key];
      this.invalidateCollection(key);
      this.collectionAccess.delete(key);
      this.persistableCollections.delete(key);
      evicted = true;
    }
    if (evicted) this.pruneOrphanRecords();
    return evicted;
  }

  private hasPendingPatch(collection: CollectionCheckpoint): boolean {
    return [...this.pending.values()].some(
      (entry) =>
        entry.model === collection.model && collection.ids.includes(entry.id),
    );
  }

  private pruneOrphanRecords(): boolean {
    const referenced = new Map<string, Set<string>>();
    for (const collection of Object.values(this.checkpoint.collections)) {
      if (!collection) continue;
      const ids = referenced.get(collection.model) ?? new Set<string>();
      for (const id of collection.ids) ids.add(id);
      referenced.set(collection.model, ids);
    }
    for (const entry of this.pending.values()) {
      const ids = referenced.get(entry.model) ?? new Set<string>();
      ids.add(entry.id);
      referenced.set(entry.model, ids);
    }

    let pruned = false;
    for (const [model, records] of Object.entries(this.checkpoint.models)) {
      if (!records) continue;
      const keep = referenced.get(model);
      const eligible = this.persistableRecords.get(model);
      for (const id of Object.keys(records)) {
        if (keep?.has(id)) continue;
        delete records[id];
        eligible?.delete(id);
        pruned = true;
      }
      if (Object.keys(records).length === 0) {
        delete this.checkpoint.models[model];
        this.persistableRecords.delete(model);
        pruned = true;
      }
    }
    return pruned;
  }

  private invalidateCollection(key: string): void {
    this.collectionSnapshots.delete(key);
  }

  private invalidateRecordCollections(model: string, id: string): void {
    for (const [key, collection] of Object.entries(
      this.checkpoint.collections,
    )) {
      if (!collection) continue;
      if (collection.model === model && collection.ids.includes(id)) {
        this.invalidateCollection(key);
      }
    }
  }

  private persistWithoutThrowing(): void {
    void this.enqueueWrite().catch(() => undefined);
  }

  private enqueueWrite(
    cursorOverride?: string | null,
    commitError = false,
  ): Promise<void> {
    if (this.closed || !this.opened) return Promise.resolve();
    const generation = this.generation;
    const write = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        if (generation !== this.generation || this.closed) return;
        if (
          cursorOverride === undefined &&
          !commitError &&
          this.isCheckpointClean()
        )
          return;
        if (this.storage.scheduleWrite) await this.storage.scheduleWrite();
        if (generation !== this.generation || this.isClosed()) return;
        if (
          cursorOverride === undefined &&
          !commitError &&
          this.isCheckpointClean()
        )
          return;
        const persistenceRevision = this.persistenceRevision;
        const checkpoint =
          cursorOverride === undefined
            ? this.checkpoint
            : { ...this.checkpoint, cursor: cursorOverride };
        const snapshot = this.persistenceSnapshot(checkpoint);
        await this.storage.write(this.scope, snapshot);
        if (generation === this.generation) {
          if (cursorOverride !== undefined) {
            this.checkpoint = { ...this.checkpoint, cursor: cursorOverride };
            this.changed();
          }
          if (this.persistenceRevision === persistenceRevision) {
            this.persistedRevision = persistenceRevision;
          }
          if (commitError) this.persistenceError = undefined;
        }
      })
      .catch((error: unknown) => {
        if (generation === this.generation) this.persistenceError = error;
        throw error;
      });
    this.writeQueue = write;
    return write;
  }

  private persistenceSnapshot(checkpoint: ModelCheckpoint): ModelCheckpoint {
    const candidates = Object.entries(checkpoint.collections)
      .flatMap(([key, collection]) => {
        if (!collection || !this.persistableCollections.has(key)) return [];
        const records = checkpoint.models[collection.model];
        const eligible = this.persistableRecords.get(collection.model);
        if (collection.ids.some((id) => !records?.[id] || !eligible?.has(id))) {
          return [];
        }
        return [[key, collection] as const];
      })
      .sort(
        (left, right) =>
          (this.collectionAccess.get(right[0]) ?? 0) -
          (this.collectionAccess.get(left[0]) ?? 0),
      );
    const savedAt = Date.now();
    const selectedRecords = new Map<string, Set<string>>();
    const selectedCollections = new Map<string, CollectionCheckpoint>();
    const recordSizes = new Map<string, Map<string, number>>();
    const baseSnapshot: ModelCheckpoint = {
      scope: checkpoint.scope,
      savedAt,
      cursor: checkpoint.cursor,
      models: Object.create(null) as ModelCheckpoint["models"],
      collections: Object.create(null) as ModelCheckpoint["collections"],
    };
    let byteCount = this.serializedSize(baseSnapshot);
    if (byteCount > this.maxBytes) {
      throw new Error("Local model checkpoint metadata exceeds size limit");
    }
    let selectedModelCount = 0;
    for (const [key, collection] of candidates) {
      const collectionJson = this.jsonValue(collection);
      let addition =
        this.utf8Size(this.jsonValue(key)) +
        1 +
        this.utf8Size(collectionJson) +
        (selectedCollections.size > 0 ? 1 : 0);
      const pendingRecords = new Map<string, Set<string>>();
      let pendingModelCount = 0;
      for (const id of collection.ids) {
        const selected = selectedRecords.get(collection.model);
        const pending = pendingRecords.get(collection.model);
        if (selected?.has(id) || pending?.has(id)) continue;
        const source = checkpoint.models[collection.model];
        const record = source?.[id];
        if (!record) continue;
        let sizesForModel = recordSizes.get(collection.model);
        if (!sizesForModel) {
          sizesForModel = new Map<string, number>();
          recordSizes.set(collection.model, sizesForModel);
        }
        let recordSize = sizesForModel.get(id);
        if (recordSize === undefined) {
          let recordBytes = this.recordByteSizes.get(record);
          if (recordBytes === undefined) {
            recordBytes = this.utf8Size(this.jsonValue(record));
            this.recordByteSizes.set(record, recordBytes);
          }
          recordSize = this.utf8Size(this.jsonValue(id)) + 1 + recordBytes;
          sizesForModel.set(id, recordSize);
        }
        const currentRecordCount = selected?.size ?? 0;
        const pendingRecordCount = pending?.size ?? 0;
        if (!selected && !pending) {
          pendingModelCount += 1;
          addition +=
            (selectedModelCount + pendingModelCount > 1 ? 1 : 0) +
            this.utf8Size(this.jsonValue(collection.model)) +
            1 +
            2 +
            recordSize;
          pendingRecords.set(collection.model, new Set([id]));
          continue;
        }
        addition +=
          (currentRecordCount + pendingRecordCount > 0 ? 1 : 0) + recordSize;
        const ids = pending ?? new Set<string>();
        ids.add(id);
        pendingRecords.set(collection.model, ids);
      }
      if (byteCount + addition > this.maxBytes) continue;
      byteCount += addition;
      selectedCollections.set(key, collection);
      for (const [model, ids] of pendingRecords) {
        let selected = selectedRecords.get(model);
        if (!selected) {
          selected = new Set<string>();
          selectedRecords.set(model, selected);
          selectedModelCount += 1;
        }
        for (const id of ids) selected.add(id);
      }
    }

    const models = Object.create(null) as ModelCheckpoint["models"];
    for (const [model, ids] of selectedRecords) {
      const source = checkpoint.models[model];
      if (!source) continue;
      const selected = Object.create(null) as Record<
        string,
        Record<string, unknown>
      >;
      for (const id of ids) {
        const record = source[id];
        if (record) selected[id] = cloneRecord(record);
      }
      if (Object.keys(selected).length) models[model] = selected;
    }
    const collections = Object.create(null) as ModelCheckpoint["collections"];
    for (const [key, collection] of selectedCollections) {
      collections[key] = structuredClone(collection);
    }
    return {
      scope: checkpoint.scope,
      savedAt,
      cursor: checkpoint.cursor,
      models,
      collections,
    };
  }

  private serializedSize(checkpoint: ModelCheckpoint): number {
    return this.utf8Size(this.jsonValue(checkpoint));
  }

  private jsonValue(value: unknown): string {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") {
      throw new Error("Local model checkpoint is not JSON serializable");
    }
    return serialized;
  }

  private utf8Size(value: string): number {
    return textEncoder.encode(value).byteLength;
  }
}
