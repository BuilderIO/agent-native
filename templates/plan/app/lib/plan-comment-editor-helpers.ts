import { emailToName } from "@agent-native/core/client";
import {
  formatPlanCommentMentionToken,
  type PlanCommentMention,
  type PlanCommentResolutionTarget,
} from "@shared/comment-context";

export type CommentDraft = {
  message: string;
  mentions: PlanCommentMention[];
  resolutionTarget: PlanCommentResolutionTarget;
};

export function displayNameForMention(email: string) {
  return emailToName(email).replace(/\s+/g, " ").trim() || email;
}

export function createMentionChip(mention: PlanCommentMention) {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.mentionEmail = mention.email;
  chip.dataset.mentionLabel = mention.label;
  chip.className =
    "inline-flex max-w-[12rem] items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary";
  chip.textContent = `@${mention.label}`;
  return chip;
}

export function appendMessageToEditor(root: HTMLElement, message: string) {
  root.replaceChildren();
  const pattern = /@\[([^\]]+)\]\(mailto:([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(message)) !== null) {
    if (match.index > lastIndex) {
      root.append(
        document.createTextNode(message.slice(lastIndex, match.index)),
      );
    }
    const label = match[1]?.trim();
    const email = decodeURIComponent(match[2] ?? "")
      .trim()
      .toLowerCase();
    if (label && email) {
      root.append(createMentionChip({ label, email }));
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < message.length) {
    root.append(document.createTextNode(message.slice(lastIndex)));
  }
}

export function serializeCommentEditor(root: HTMLElement) {
  const serialize = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    const mentionEmail = node.dataset.mentionEmail;
    if (mentionEmail) {
      return formatPlanCommentMentionToken({
        email: mentionEmail,
        label: node.dataset.mentionLabel || displayNameForMention(mentionEmail),
      });
    }
    if (node.tagName === "BR") return "\n";
    return Array.from(node.childNodes).map(serialize).join("");
  };
  return Array.from(root.childNodes)
    .map(serialize)
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function commentBodyText(message: string) {
  return message
    .replace(/@\[([^\]]+)\]\(mailto:[^)]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function canSubmitInlineCommentDraft(input: {
  draft: CommentDraft;
  isSubmitting?: boolean;
  lockToAgent?: boolean;
}) {
  const needsHumanMention =
    !input.lockToAgent &&
    input.draft.resolutionTarget === "human" &&
    input.draft.mentions.length === 0;
  return (
    commentBodyText(input.draft.message).length > 0 &&
    !needsHumanMention &&
    !input.isSubmitting
  );
}

export function mentionQueryAtCaret(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !root.contains(range.startContainer)) return null;
  const textBeforeCaretRange = range.cloneRange();
  textBeforeCaretRange.selectNodeContents(root);
  textBeforeCaretRange.setEnd(range.startContainer, range.startOffset);
  const text = textBeforeCaretRange.toString();
  const match = /(?:^|\s)@([a-zA-Z0-9._+-]{0,64})$/.exec(text);
  if (!match) return null;
  const start = text.lastIndexOf("@");
  const end = text.length;
  const startPosition = textPositionInRoot(root, start);
  const endPosition = textPositionInRoot(root, end);
  if (!startPosition || !endPosition) return null;
  const queryRange = document.createRange();
  queryRange.setStart(startPosition.node, startPosition.offset);
  queryRange.setEnd(endPosition.node, endPosition.offset);
  return {
    query: match[1] ?? "",
    range: queryRange,
  };
}

function textPositionInRoot(root: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let lastText: Text | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (offset <= seen + length) {
      return { node, offset: Math.max(0, offset - seen) };
    }
    seen += length;
    lastText = node;
    node = walker.nextNode() as Text | null;
  }
  if (lastText && offset === seen) {
    return { node: lastText, offset: lastText.textContent?.length ?? 0 };
  }
  return null;
}
