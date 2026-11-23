import { notebookOriginIdSchema } from "../../../shared/notebook-undo";

const storageKey = "analytics2:notebook-undo-origin";
let documentOrigin: string | undefined;

export function notebookUndoOrigin() {
  if (documentOrigin) return documentOrigin;
  const navigation = performance.getEntriesByType?.("navigation")[0];
  if (navigation && "type" in navigation && navigation.type === "reload") {
    const stored = notebookOriginIdSchema.safeParse(
      sessionStorage.getItem(storageKey),
    );
    if (stored.success) return (documentOrigin = stored.data);
  }
  documentOrigin = crypto.randomUUID();
  sessionStorage.setItem(storageKey, documentOrigin);
  return documentOrigin;
}
