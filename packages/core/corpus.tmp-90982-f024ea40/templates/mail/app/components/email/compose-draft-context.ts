import {
  appendSignatureToBody,
  splitAppendedSignature,
} from "@shared/signature";
import type { ComposeState } from "@shared/types";

type MarkdownEditor = {
  isDestroyed?: boolean;
  storage: any;
  state: {
    doc: {
      cut: (from: number, to: number) => unknown;
    };
  };
};

/** How long after the user's last keystroke we treat the body as "actively
 *  being typed" and defer an incoming external (agent) edit. Mirrors the
 *  content editor's typing guard so an agent draft update lands the moment the
 *  user pauses, instead of waiting for them to blur the field. */
export const COMPOSE_TYPING_GRACE_MS = 1500;

/**
 * Decide whether an external `content` value (e.g. an agent-written draft body
 * reconciled in via the `compose-drafts` query) should replace what the editor
 * currently shows.
 *
 * - Never re-apply content the editor already reflects (no-op / our own echo).
 * - Adopt external content even while the editor is focused, as long as the
 *   user isn't typing *right now* — so an agent edit appears live.
 * - Only defer while the user is actively typing, so we never yank text out
 *   from under in-progress keystrokes (the caller retries once they pause).
 */
export function shouldApplyComposeContent({
  currentMarkdown,
  nextContent,
  editorFocused,
  lastTypedAt,
  now,
}: {
  currentMarkdown: string;
  nextContent: string;
  editorFocused: boolean;
  lastTypedAt: number;
  now: number;
}): boolean {
  if (currentMarkdown === nextContent) return false;
  const typingRightNow =
    editorFocused && now - lastTypedAt < COMPOSE_TYPING_GRACE_MS;
  return !typingRightNow;
}

export function splitQuotedContent(body: string): [string, string] {
  const replyMatch = body.match(/\n*— On .+? wrote:\n/);
  const fwdMatch = body.match(/\n*— Forwarded message —\n/);
  const match = replyMatch || fwdMatch;
  if (!match || match.index === undefined) return [body, ""];
  return [body.slice(0, match.index), body.slice(match.index)];
}

export function getEditorMarkdown(editor: MarkdownEditor | null | undefined) {
  if (!editor || editor.isDestroyed) return null;
  try {
    return (editor.storage as any).markdown.getMarkdown() as string;
  } catch {
    return null;
  }
}

export function mergeEditorMarkdownIntoDraftBody({
  draft,
  editorMarkdown,
  signature,
}: {
  draft: ComposeState;
  editorMarkdown: string | null | undefined;
  signature?: string;
}) {
  if (editorMarkdown == null) return draft.body;

  const [editableContent, quotedContent] = splitQuotedContent(draft.body);
  const [, appendedSignature] =
    draft.mode === "reply"
      ? splitAppendedSignature(editableContent, signature)
      : [editableContent, ""];

  if (appendedSignature) {
    return appendSignatureToBody(
      editorMarkdown + quotedContent,
      appendedSignature,
    );
  }
  if (quotedContent) return editorMarkdown + quotedContent;
  return editorMarkdown;
}

export function getCurrentDraftBodyFromEditor({
  draft,
  editor,
  signature,
}: {
  draft: ComposeState;
  editor: MarkdownEditor | null | undefined;
  signature?: string;
}) {
  return mergeEditorMarkdownIntoDraftBody({
    draft,
    editorMarkdown: getEditorMarkdown(editor),
    signature,
  });
}

export function getSelectedMarkdown(
  editor: MarkdownEditor,
  from: number,
  to: number,
) {
  if (from === to) return "";
  try {
    const serializer = (editor.storage as any).markdown?.serializer;
    if (!serializer || typeof serializer.serialize !== "function") return null;
    return serializer.serialize(editor.state.doc.cut(from, to)) as string;
  } catch {
    return null;
  }
}
