import type { Awareness } from "y-protocols/awareness";
import type { Doc as YDoc } from "yjs";

import {
  createSharedEditorExtensions,
  type RichMarkdownDialect,
  type RichMarkdownEditorPreset,
  type RichMarkdownCollabUser,
} from "./extensions.js";
import {
  SharedRichEditor,
  type SharedRichEditorProps,
} from "./SharedRichEditor.js";

export type {
  RichMarkdownDialect,
  RichMarkdownEditorPreset,
  RichMarkdownCollabUser,
};

/** @deprecated Prefer {@link CreateSharedEditorExtensionsOptions}. */
export interface CreateRichMarkdownExtensionsOptions {
  dialect?: RichMarkdownDialect;
  placeholder?: string;
  ydoc?: YDoc | null;
  awareness?: Awareness | null;
  user?: RichMarkdownCollabUser | null;
}

export function createRichMarkdownExtensions({
  dialect = "gfm",
  placeholder = "Type '/' for commands...",
  ydoc = null,
  awareness = null,
  user = null,
}: CreateRichMarkdownExtensionsOptions = {}) {
  return createSharedEditorExtensions({
    dialect,
    placeholder,
    collab: ydoc ? { ydoc, awareness, user } : null,
  });
}

/** @deprecated Prefer {@link SharedRichEditorProps}. */
export type RichMarkdownEditorProps = SharedRichEditorProps;

export const RichMarkdownEditor = SharedRichEditor;
