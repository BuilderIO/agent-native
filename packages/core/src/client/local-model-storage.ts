import { createStore, del, get, set } from "idb-keyval";

import type {
  LocalModelStorage,
  ModelCheckpoint,
} from "./local-model-store.js";

const database = createStore("agent-native-local-models", "checkpoints");

export interface LocalModelStorageBinding extends LocalModelStorage {
  invalidate(): void;
  isActive(): boolean;
}

/** Bind browser storage to one already-verified user, organization, and build scope. */
export function createLocalModelStorage(
  scope: string,
): LocalModelStorageBinding {
  const epochKey = `agent-native:local-model-epoch:${scope}`;
  let currentEpoch = localStorage.getItem(epochKey);
  if (!currentEpoch) {
    currentEpoch = crypto.randomUUID();
    localStorage.setItem(epochKey, currentEpoch);
  }
  const binding = currentEpoch;
  const storageKey = `${scope}\0${binding}`;
  let locallyInvalidated = false;
  const isActive = () =>
    !locallyInvalidated && localStorage.getItem(epochKey) === binding;

  return {
    scheduleWrite: () =>
      new Promise<void>((resolve) => {
        if (typeof globalThis.requestIdleCallback === "function") {
          globalThis.requestIdleCallback(() => resolve(), { timeout: 500 });
        } else {
          globalThis.setTimeout(resolve, 0);
        }
      }),
    invalidate() {
      if (locallyInvalidated) return;
      try {
        if (!isActive()) {
          locallyInvalidated = true;
          return;
        }
        locallyInvalidated = true;
        localStorage.setItem(epochKey, crypto.randomUUID());
      } catch (error) {
        locallyInvalidated = true;
        throw error;
      }
    },
    isActive,
    async read(key) {
      if (key !== scope || !isActive()) return undefined;
      const saved = await get<{ epoch: string; value: ModelCheckpoint }>(
        storageKey,
        database,
      );
      if (!isActive() || saved?.epoch !== binding) return undefined;
      return saved.value;
    },
    async write(key, value) {
      if (key !== scope || !isActive())
        throw new Error("Local model scope expired");
      await set(storageKey, { epoch: binding, value }, database);
      if (!isActive()) await del(storageKey, database);
    },
    async clear(key) {
      if (key !== scope) throw new Error("Local model scope mismatch");
      let invalidationFailed = false;
      let invalidationError: unknown;
      try {
        if (isActive()) this.invalidate();
      } catch (error) {
        invalidationFailed = true;
        invalidationError = error;
      }
      try {
        await del(storageKey, database);
      } catch (deleteError) {
        if (invalidationFailed) {
          throw new AggregateError(
            [invalidationError, deleteError],
            "Local model invalidation and deletion failed",
          );
        }
        throw deleteError;
      }
      if (invalidationFailed) throw invalidationError;
    },
  };
}
