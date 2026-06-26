import type { Awareness } from "y-protocols/awareness";
import type { Doc as YDoc } from "yjs";

/**
 * Back-compat surface for the shared rich markdown editor.
 *
 * The editor core now lives in dedicated modules:
 *   - {@link createSharedEditorExtensions} — the ONE extension factory.
 *   - {@link useCollabReconcile} — seed / reconcile / lead-client logic.
 *   - {@link SlashCommandMenu} / {@link BubbleToolbar} — shared menus.
 *   - {@link SharedRichEditor} — the editor component.
 *
 * This file keeps the historical `RichMarkdownEditor` component name (aliased to
 * {@link SharedRichEditor}) and the `createRichMarkdownExtensions` factory so
 * existing embedders and the round-trip / collab specs keep working unchanged.
 */
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
  /**
   * Yjs document for collaborative editing. When present, the editor binds the
   * shared Collaboration + CollaborationCaret extensions and StarterKit's
   * built-in undo/redo is disabled (Yjs owns history).
   */
  ydoc?: YDoc | null;
  /** Shared awareness instance for live multi-user cursors. */
  awareness?: Awareness | null;
  /** Current user info for the collaborative cursor label. */
  user?: RichMarkdownCollabUser | null;
}

/**
 * Back-compat factory preserving today's GFM/plan behavior EXACTLY. Implemented
 * in terms of {@link createSharedEditorExtensions}: it maps the flat
 * `{ ydoc, awareness, user }` collab options into the nested `collab` shape the
 * shared factory expects. The round-trip and collab specs build their `Editor`
 * from this, so its output must stay byte-stable.
 */
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

/**
 * Historical name for {@link SharedRichEditor}. Kept so existing imports
 * (`import { RichMarkdownEditor } from "@agent-native/core/client"`) and the
 * plan editor tests (which assert the source mentions `RichMarkdownEditor`)
 * keep working. New code should import `SharedRichEditor`.
 */
export const RichMarkdownEditor = SharedRichEditor;
