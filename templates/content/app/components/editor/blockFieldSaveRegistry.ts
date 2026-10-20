import type { BlockFieldSaveController } from "./blockFieldSaveController";
import type { VisualEditorPersistenceController } from "./VisualEditor";

export interface BlockFieldPersistenceRef {
  current: VisualEditorPersistenceController | null;
  readonly version: object;
}

export function createBlockFieldPersistenceRef(): BlockFieldPersistenceRef {
  let current: VisualEditorPersistenceController | null = null;
  let version = {};
  return {
    get current() {
      return current;
    },
    set current(next) {
      if (next !== current) version = {};
      current = next;
    },
    get version() {
      return version;
    },
  };
}

interface Entry {
  controller: BlockFieldSaveController;
  refCount: number;
  evicting: boolean;
  editors: Set<BlockFieldPersistenceRef>;
  versions: Array<object | null>;
  visualVersion: object;
}

const registry = new Map<string, Entry>();

export function acquireBlockFieldSaveController(
  key: string,
  factory: () => BlockFieldSaveController,
  editor?: BlockFieldPersistenceRef,
): BlockFieldSaveController {
  const entry = ensureEntry(key, factory);
  entry.refCount += 1;
  entry.evicting = false;
  if (editor) entry.editors.add(editor);
  return entry.controller;
}

export function peekBlockFieldSaveController(
  key: string,
): BlockFieldSaveController | undefined {
  return registry.get(key)?.controller;
}

export function readBlockFieldEditorState(key: string) {
  const entry = registry.get(key);
  if (!entry) return undefined;
  const editors = [...entry.editors];
  const versions = editors.flatMap((editor) => [
    editor.version,
    editor.current?.version ?? null,
  ]);
  if (
    versions.length !== entry.versions.length ||
    versions.some((version, index) => version !== entry.versions[index])
  ) {
    entry.versions = versions;
    entry.visualVersion = {};
  }
  return {
    controller: entry.controller,
    visualVersion: entry.visualVersion,
    clean:
      entry.refCount > 0 &&
      editors.length === entry.refCount &&
      editors.every((editor) => editor.current !== null) &&
      entry.controller.isClean,
  };
}

async function flushEntry(entry: Entry) {
  const work = [...entry.editors].map(async (editor) => {
    const controller = editor.current;
    if (!controller)
      throw new Error("The requested Blocks field editor is unavailable.");
    if (!(await controller.flushLatest()))
      throw new Error("A Blocks field could not be saved before reading it.");
  });
  work.push(entry.controller.flush());
  await Promise.all(work);
  if (!entry.controller.isClean)
    throw new Error("A Blocks field could not be saved before reading it.");
}

export async function flushBlockFieldSaveController(
  documentId: string,
  propertyId: string,
): Promise<void> {
  const entry = registry.get(`${documentId}:${propertyId}`);
  if (entry) await flushEntry(entry);
}

export async function flushAllBlockFieldSaveControllersForDocument(
  documentId: string,
): Promise<void> {
  const prefix = `${documentId}:`;
  const entries = [...registry.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, entry]) => entry);

  const results = await Promise.allSettled(entries.map(flushEntry));
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
    entry = {
      controller: factory(),
      refCount: 0,
      evicting: false,
      editors: new Set(),
      versions: [],
      visualVersion: {},
    };
    registry.set(key, entry);
  }
  return entry;
}

function controllerIsDirty(controller: BlockFieldSaveController): boolean {
  return controller.pending !== controller.lastSaved;
}

export function releaseBlockFieldSaveController(
  key: string,
  editor?: BlockFieldPersistenceRef,
): Promise<boolean> {
  const entry = registry.get(key);
  if (!entry) return Promise.resolve(false);
  if (editor && !entry.editors.delete(editor)) return Promise.resolve(false);
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
  const entry = registry.get(key);
  if (!entry) return;
  entry.controller.cancel();
  registry.delete(key);
  saveImpls.delete(key);
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
}
