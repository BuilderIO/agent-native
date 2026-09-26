
import type { PreviewDocumentSaveController } from "./previewDocumentSaveController";

interface Entry {
  controller: PreviewDocumentSaveController;
  refCount: number;
  evicting: boolean;
}

const registry = new Map<string, Entry>();

function payloadsEqual(
  a: PreviewDocumentSaveController["pending"],
  b: PreviewDocumentSaveController["pending"],
) {
  return a.title === b.title && a.content === b.content;
}

function controllerIsDirty(controller: PreviewDocumentSaveController): boolean {
  return !payloadsEqual(controller.pending, controller.lastSaved);
}

export function acquirePreviewDocumentSaveController(
  documentId: string,
  factory: () => PreviewDocumentSaveController,
  refreshAdapter?: (controller: PreviewDocumentSaveController) => void,
): PreviewDocumentSaveController {
  let entry = registry.get(documentId);
  if (!entry) {
    entry = { controller: factory(), refCount: 0, evicting: false };
    registry.set(documentId, entry);
  }
  refreshAdapter?.(entry.controller);
  entry.refCount += 1;
  entry.evicting = false;
  return entry.controller;
}

export function peekPreviewDocumentSaveController(
  documentId: string,
): PreviewDocumentSaveController | undefined {
  return registry.get(documentId)?.controller;
}

export function releasePreviewDocumentSaveController(documentId: string): void {
  const entry = registry.get(documentId);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount > 0) return;

  entry.evicting = true;
  const settle = () => {
    const current = registry.get(documentId);
    if (current === entry && current.refCount === 0 && current.evicting) {
      if (controllerIsDirty(current.controller)) {
        current.evicting = false;
        return;
      }
      registry.delete(documentId);
    }
  };
  Promise.resolve(entry.controller.flush()).then(settle, settle);
}

export function activePreviewControllerCount(): number {
  return registry.size;
}

export function __resetPreviewDocumentSaveRegistry(): void {
  registry.clear();
}
