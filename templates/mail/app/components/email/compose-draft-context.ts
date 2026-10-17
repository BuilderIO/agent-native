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

export const COMPOSE_TYPING_GRACE_MS = 1500;

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

export function isSameScheduledDraft(
  draft: ComposeState,
  snapshot: ComposeState,
): boolean {
  const comparable = ({
    id: _id,
    savedDraftId: _savedDraftId,
    savedDraftBackend: _savedDraftBackend,
    savedDraftAccountEmail: _savedDraftAccountEmail,
    ...state
  }: ComposeState) => JSON.stringify(state);
  return comparable(draft) === comparable(snapshot);
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
