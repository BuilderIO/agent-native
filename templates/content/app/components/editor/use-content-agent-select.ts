import { useT } from "@agent-native/core/client/i18n";
import {
  agentSelectNodeIdentity,
  findAgentSelectNode,
  registerAgentSelectable,
  useAgentSelectableSource,
  type AgentSelectable,
} from "@agent-native/toolkit/app/agent-select";
import { useEffect, useRef } from "react";

import type { CommentThread } from "@/hooks/use-comments";

const EDITOR_SELECTOR = ".content-editor";
const FIELD_SELECTOR = "[data-block-field-id]";
const PRIMARY_FIELD_SELECTOR = "[data-primary-block-field-panel]";
const THREAD_ATTRIBUTE = "data-comment-thread";
const TITLE_LIMIT = 40;
const TEXT_LIMIT = 500;
const COMMENT_LIMIT = 200;

type ThreadsGetter = () => readonly CommentThread[];

function excerpt(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > limit
    ? `${collapsed.slice(0, limit - 1)}…`
    : collapsed;
}

// innerText keeps the breaks between blocks that textContent runs together.
function renderedText(element: Element): string {
  const rendered = (element as Partial<HTMLElement>).innerText;
  return typeof rendered === "string" ? rendered : element.textContent;
}

/** The Blocks field an editor shows, or null for the page body. */
export function contentEditorFieldId(editorRoot: Element): string | null {
  if (editorRoot.closest(PRIMARY_FIELD_SELECTOR)) return null;
  return (
    editorRoot.closest(FIELD_SELECTOR)?.getAttribute("data-block-field-id") ??
    null
  );
}

/** The visible editor for a Blocks field (null: the page body). */
function findContentEditor(fieldId: string | null): Element | null {
  for (const editor of document.querySelectorAll(EDITOR_SELECTOR)) {
    if (
      contentEditorFieldId(editor) === fieldId &&
      editor.getClientRects().length > 0
    ) {
      return editor;
    }
  }
  return null;
}

/**
 * The block a pointer target belongs to, or null: its list item when it is in
 * a list (comments usually point at one bullet), else its top-level block.
 */
export function contentBlockForTarget(
  target: Element,
): { block: HTMLElement; editor: HTMLElement } | null {
  const editor = target.closest<HTMLElement>(EDITOR_SELECTOR);
  if (!editor || target === editor) return null;
  const item = target.closest<HTMLElement>("li");
  if (item && editor.contains(item)) return { block: item, editor };
  let block = target as HTMLElement;
  while (block.parentElement && block.parentElement !== editor) {
    block = block.parentElement;
  }
  return block.parentElement === editor ? { block, editor } : null;
}

/** The open comment threads highlighted inside a block, in order. */
export function contentBlockThreads(
  block: Element,
  threads: readonly CommentThread[],
): CommentThread[] {
  const ids = new Set<string>();
  for (const highlight of block.querySelectorAll(`[${THREAD_ATTRIBUTE}]`)) {
    const id = highlight.getAttribute(THREAD_ATTRIBUTE);
    if (id) ids.add(id);
  }
  return threads.filter(
    (thread) => !thread.resolved && ids.has(thread.threadId),
  );
}

function threadLines(threads: readonly CommentThread[]): string[] {
  if (threads.length === 0) return [];
  return [
    "Open comment threads on this block:",
    ...threads.map((thread) => {
      const root = thread.comments.find(
        (comment) => comment.parent_id === null,
      );
      const replies = Math.max(0, thread.comments.length - 1);
      const author = root
        ? root.author_name || root.author_email || "unknown"
        : "unknown";
      const body = root ? excerpt(root.content, COMMENT_LIMIT) : "";
      const quote = thread.quotedText
        ? ` on ${JSON.stringify(excerpt(thread.quotedText, 80))}`
        : "";
      const replyNote =
        replies > 0
          ? ` (${replies} ${replies === 1 ? "reply" : "replies"})`
          : "";
      return `- thread ${thread.threadId} by ${author}${quote}: ${JSON.stringify(body)}${replyNote}`;
    }),
  ];
}

export function contentBlockSelectable(
  documentId: string,
  getThreads: ThreadsGetter,
  target: Element,
): AgentSelectable | null {
  const found = contentBlockForTarget(target);
  if (!found) return null;
  const { block, editor } = found;
  const fieldId = contentEditorFieldId(editor);
  const identity = agentSelectNodeIdentity(block, editor);
  const tag = block.tagName.toLowerCase();
  const findBlock = () => {
    const root = editor.isConnected ? editor : findContentEditor(fieldId);
    return root ? findAgentSelectNode(root, identity) : null;
  };
  return {
    kind: "block",
    id: `${documentId}/${fieldId ?? "body"}/${identity.path}`,
    title: excerpt(renderedText(block) || tag, TITLE_LIMIT),
    parent: { kind: "page", id: documentId },
    getContext: () => {
      const current = findBlock() ?? block;
      const text = excerpt(renderedText(current), TEXT_LIMIT);
      return [
        `Page id: ${documentId}`,
        fieldId ? `Blocks field id: ${fieldId}` : "",
        `Block type: ${tag}`,
        text ? `Block text: ${text}` : "",
        ...threadLines(contentBlockThreads(current, getThreads())),
        "Edit only this block: read the page with get-document, then change this text with edit-document. Reply to a thread with add-comment and its threadId.",
      ]
        .filter(Boolean)
        .join("\n");
    },
    getElement: findBlock,
  };
}

/**
 * Offer the open page and its blocks to the composer's Select mode. A picked
 * block carries the open comment threads anchored in it.
 */
export function useContentAgentSelect(
  documentId: string | null | undefined,
  pageTitle: string | null | undefined,
  threads: readonly CommentThread[] | undefined,
): void {
  const threadsRef = useRef(threads ?? []);
  threadsRef.current = threads ?? [];
  const t = useT();
  const title = pageTitle?.trim() || t("sidebar.untitled");

  useEffect(() => {
    if (!documentId) return;
    return registerAgentSelectable({
      kind: "page",
      id: documentId,
      title,
      getContext: () =>
        [
          `Page id: ${documentId}`,
          `Page title: ${title}`,
          "Read it with get-document and change it with edit-document.",
        ].join("\n"),
      getElement: () => findContentEditor(null),
    });
  }, [documentId, title]);

  useAgentSelectableSource(
    documentId
      ? (target) =>
          contentBlockSelectable(documentId, () => threadsRef.current, target)
      : null,
  );
}
