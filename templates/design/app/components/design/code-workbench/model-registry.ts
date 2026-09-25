import * as monaco from "monaco-editor";

import { parseWorkbenchUri, providerKindFromKey } from "./workspace/types";

/**
 * Monaco models are the source of truth for draft buffer content. React state
 * (the workbench store) only tracks metadata — dirty flags, version hashes,
 * loading states — so typing never re-renders the tree.
 *
 * Dirty tracking uses Monaco's alternative version id (O(1), undo-aware):
 * a buffer is dirty when the model's current alternative version id differs
 * from the one captured at load/save time.
 */

export interface WorkbenchModelEntry {
  model: monaco.editor.ITextModel;
  savedAltVersionId: number;
  viewState: monaco.editor.ICodeEditorViewState | null;
}

function monacoUriFor(uri: string): monaco.Uri {
  const { providerKey, path } = parseWorkbenchUri(uri);
  const kind = providerKindFromKey(providerKey);
  const authority = providerKey.split(":").slice(1).join(":") || "workspace";
  return monaco.Uri.from({
    scheme: kind === "inline" ? "designfs" : "localfs",
    authority,
    path: `/${path.replace(/^\/+/, "")}`,
  });
}

class WorkbenchModelRegistry {
  private entries = new Map<string, WorkbenchModelEntry>();
  /**
   * Uris currently inside an `applyExternalContent`/`reloadContent` call.
   * Monaco fires `onDidChangeContent` synchronously from inside
   * `pushEditOperations`, before this class can update `savedAltVersionId` to
   * the post-edit version — so a dirty-tracking subscriber reading
   * `isDirty()` from that callback would see a stale "dirty" result for an
   * edit nobody typed. Callers (store.tsx's dirty-tracking subscription) use
   * `isApplyingExternalContent` to skip acting on that spurious notification.
   */
  private externalContentUris = new Set<string>();

  get(uri: string): WorkbenchModelEntry | undefined {
    return this.entries.get(uri);
  }

  has(uri: string): boolean {
    return this.entries.has(uri);
  }

  ensureModel(
    uri: string,
    content: string,
    language: string,
  ): WorkbenchModelEntry {
    const existing = this.entries.get(uri);
    if (existing && !existing.model.isDisposed()) {
      monaco.editor.setModelLanguage(existing.model, language);
      return existing;
    }
    const monacoUri = monacoUriFor(uri);
    const model =
      monaco.editor.getModel(monacoUri) ??
      monaco.editor.createModel(content, language, monacoUri);
    const entry: WorkbenchModelEntry = {
      model,
      savedAltVersionId: model.getAlternativeVersionId(),
      viewState: null,
    };
    this.entries.set(uri, entry);
    return entry;
  }

  getContent(uri: string): string | null {
    const entry = this.entries.get(uri);
    if (!entry || entry.model.isDisposed()) return null;
    return entry.model.getValue();
  }

  isDirty(uri: string): boolean {
    const entry = this.entries.get(uri);
    if (!entry || entry.model.isDisposed()) return false;
    return entry.model.getAlternativeVersionId() !== entry.savedAltVersionId;
  }

  /**
   * True while `uri`'s content is being replaced by `applyExternalContent`.
   * Dirty-tracking subscribers must ignore `onDidChangeContent` notifications
   * that fire while this is true — see the field comment above.
   */
  isApplyingExternalContent(uri: string): boolean {
    return this.externalContentUris.has(uri);
  }

  /**
   * Replace buffer content from an external change (agent edit, canvas edit)
   * while preserving the undo stack.
   */
  applyExternalContent(uri: string, content: string) {
    const entry = this.entries.get(uri);
    if (!entry || entry.model.isDisposed()) return;
    const model = entry.model;
    if (model.getValue() === content) {
      entry.savedAltVersionId = model.getAlternativeVersionId();
      return;
    }
    this.externalContentUris.add(uri);
    try {
      model.pushEditOperations(
        null,
        [{ range: model.getFullModelRange(), text: content }],
        () => null,
      );
    } finally {
      this.externalContentUris.delete(uri);
    }
    entry.savedAltVersionId = model.getAlternativeVersionId();
  }

  /**
   * Force an already-open buffer to match freshly read content + language,
   * discarding any local edits. Used only for explicit user-initiated reload
   * (e.g. the "File changed elsewhere — reload latest" conflict action) —
   * the caller has already decided to discard unsaved edits, so unlike
   * `applyExternalContent`'s callers this does not gate on dirty state.
   */
  reloadContent(uri: string, content: string, language: string) {
    const entry = this.entries.get(uri);
    if (!entry || entry.model.isDisposed()) return;
    monaco.editor.setModelLanguage(entry.model, language);
    this.applyExternalContent(uri, content);
  }

  /** Mark the buffer clean as of the given alternative version id. */
  markSaved(uri: string, altVersionId: number) {
    const entry = this.entries.get(uri);
    if (!entry) return;
    entry.savedAltVersionId = altVersionId;
  }

  saveViewState(
    uri: string,
    viewState: monaco.editor.ICodeEditorViewState | null,
  ) {
    const entry = this.entries.get(uri);
    if (entry) entry.viewState = viewState;
  }

  getViewState(uri: string): monaco.editor.ICodeEditorViewState | null {
    return this.entries.get(uri)?.viewState ?? null;
  }

  dispose(uri: string) {
    const entry = this.entries.get(uri);
    if (entry) {
      if (!entry.model.isDisposed()) entry.model.dispose();
      this.entries.delete(uri);
    }
  }

  disposeAll() {
    for (const entry of this.entries.values()) {
      if (!entry.model.isDisposed()) entry.model.dispose();
    }
    this.entries.clear();
  }
}

export const modelRegistry = new WorkbenchModelRegistry();
