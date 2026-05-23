import type { ComposeState } from "@shared/types";
import {
  appendSignatureToBody,
  splitAppendedSignature,
} from "@shared/signature";

type MarkdownEditor = {
  isDestroyed?: boolean;
  storage: any;
  state: {
    doc: {
      cut: (from: number, to: number) => unknown;
    };
  };
};

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
