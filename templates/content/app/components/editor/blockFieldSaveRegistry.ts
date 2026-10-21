import type { BlockFieldSaveController } from "./blockFieldSaveController";

interface Entry {
  controller: BlockFieldSaveController;
  refCount: number;
  evicting: boolean;
}

const registry = new Map<string, Entry>();

export function acquireBlockFieldSaveController(
  key: string,
  factory: () => BlockFieldSaveController,
): BlockFieldSaveController {
  const entry = ensureEntry(key, factory);
  entry.refCount += 1;
  entry.evicting = false;
  return entry.controller;
}

export function peekBlockFieldSaveController(
  key: string,
): BlockFieldSaveController | undefined {
  return registry.get(key)?.controller;
}

export async function flushBlockFieldSaveController(
  documentId: string,
  propertyId: string,
): Promise<void> {
  const controller = registry.get(`${documentId}:${propertyId}`)?.controller;
  if (!controller) return;

  await controller.flush();
  if (controller.pending !== controller.lastSaved) {
    throw new Error("A Blocks field could not be saved before reading it.");
  }
}

export async function flushAllBlockFieldSaveControllersForDocument(
  documentId: string,
): Promise<void> {
  const prefix = `${documentId}:`;
  const controllers = [...registry.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, entry]) => entry.controller);

  const results = await Promise.allSettled(
    controllers.map(async (controller) => {
      await controller.flush();
      if (controller.pending !== controller.lastSaved) {
        throw new Error(
          "A Blocks field could not be saved before leaving the page.",
        );
      }
    }),
  );
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejected) throw rejected.reason;
}

function ensureEntry(
  key: string,
  factory: () => BlockFieldSaveController,
): Entry {
  let entry = registry.get(key);
  if (!entry) {
    entry = { controller: factory(), refCount: 0, evicting: false };
    registry.set(key, entry);
  }
  return entry;
}

function controllerIsDirty(controller: BlockFieldSaveController): boolean {
  return controller.pending !== controller.lastSaved;
}

export function releaseBlockFieldSaveController(key: string): Promise<boolean> {
  const entry = registry.get(key);
  if (!entry) return Promise.resolve(false);
  entry.refCount -= 1;
  if (entry.refCount > 0) return Promise.resolve(false);

  entry.evicting = true;
  const settle = () => {
    const current = registry.get(key);
    if (current === entry && current.refCount === 0 && current.evicting) {
      if (controllerIsDirty(current.controller)) {
        current.evicting = false;
        return false;
      }
      registry.delete(key);
      saveImpls.delete(key);
      revisions.delete(key);
      return true;
    }
    return false;
  };
  return Promise.resolve(entry.controller.flush()).then(settle, settle);
}

/**
 * Drops a deleted field's controller without saving it. The field is gone, so
 * its unsaved text has nowhere to go, and a controller left dirty by a failed
 * save would make every later flush for the page fail.
 */
export function forgetBlockFieldSaveController(key: string): void {
  deleting.delete(key);
  const entry = registry.get(key);
  if (!entry) return;
  entry.controller.cancel();
  registry.delete(key);
  saveImpls.delete(key);
  revisions.delete(key);
}

const deleting = new Set<string>();

/**
 * Marks a field whose delete is in flight, so the save that fails because the
 * field is gone doesn't report an error. Forgetting the field clears it.
 */
export function setBlockFieldDeleting(key: string, value: boolean): void {
  if (value) deleting.add(key);
  else deleting.delete(key);
}

export function isBlockFieldDeleting(key: string): boolean {
  return deleting.has(key);
}

export interface BlockFieldRevision {
  /** The field's server revision that the controller's saved text is from. */
  base: number;
  /** The server refused a save made on `base`; saves wait for newer text. */
  stale: boolean;
}

const revisions = new Map<string, BlockFieldRevision>();

/**
 * The revision state shared by every editor of one field, created from the
 * first `initialRevision` seen. It lives as long as the field's controller.
 */
export function blockFieldRevision(
  key: string,
  initialRevision: number,
): BlockFieldRevision {
  let revision = revisions.get(key);
  if (!revision) {
    revision = { base: initialRevision, stale: false };
    revisions.set(key, revision);
  }
  return revision;
}

type SaveImpl = (value: string) => Promise<unknown>;
const saveImpls = new Map<string, { current: SaveImpl }>();

export function blockFieldSaveImplRef(key: string): { current: SaveImpl } {
  let ref = saveImpls.get(key);
  if (!ref) {
    ref = {
      current: () =>
        Promise.reject(
          new Error(`No save impl registered for block field "${key}"`),
        ),
    };
    saveImpls.set(key, ref);
  }
  return ref;
}

export function activeControllerCount(): number {
  return registry.size;
}

export function __resetBlockFieldSaveRegistry(): void {
  registry.clear();
  saveImpls.clear();
  revisions.clear();
  deleting.clear();
}
