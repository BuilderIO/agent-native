import type { Document } from "@shared/api";

export type DocumentHistoryRestoreApplyResult =
  | { status: "applied" }
  | { status: "committed-editor-refresh-required" };

export interface DocumentHistoryRestoreController {
  prepareRestore: () => Promise<string>;
  applyRestore: (
    restored: Document,
  ) =>
    | DocumentHistoryRestoreApplyResult
    | Promise<DocumentHistoryRestoreApplyResult>;
}

const controllers = new Map<string, DocumentHistoryRestoreController>();

export function registerDocumentHistoryRestoreController(
  documentId: string,
  controller: DocumentHistoryRestoreController,
) {
  controllers.set(documentId, controller);
  return () => {
    if (controllers.get(documentId) === controller) {
      controllers.delete(documentId);
    }
  };
}

export async function prepareRegisteredDocumentHistoryRestore(
  documentId: string,
  unavailableMessage: string,
) {
  const controller = controllers.get(documentId);
  if (!controller) {
    throw new Error(unavailableMessage);
  }
  return controller.prepareRestore();
}

export async function applyRegisteredDocumentHistoryRestore(
  documentId: string,
  restored: Document,
) {
  const controller = controllers.get(documentId);
  if (!controller) return false;
  const result = await controller.applyRestore(restored);
  return result.status === "applied";
}
