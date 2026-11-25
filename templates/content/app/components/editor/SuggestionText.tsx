import { useT } from "@agent-native/core/client/i18n";
import {
  clipSuggestionPresentation,
  suggestionPresentationLength,
  suggestionTextPresentationForSource,
  suggestionTextPresentation,
  type SuggestionPresentationContext,
  type SuggestionPresentationNode,
} from "@shared/suggestion-text";
import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const UNBROKEN_CODE = 24;

function renderNode(node: SuggestionPresentationNode, key: string): ReactNode {
  if (node.type === "text") return <Fragment key={key}>{node.value}</Fragment>;
  if (node.type === "indent" || node.type === "block")
    return <Fragment key={key}>{node.value}</Fragment>;
  if (node.type === "lineBreak") return <br key={key} />;
  const children = node.children.map((child, index) =>
    renderNode(child, `${key}-${index}`),
  );
  if (node.type === "strong") return <strong key={key}>{children}</strong>;
  if (node.type === "emphasis") return <em key={key}>{children}</em>;
  if (node.type === "strike") return <s key={key}>{children}</s>;
  if (node.type === "code")
    return (
      <code
        key={key}
        className={cn(
          "rounded bg-muted px-1 font-mono text-[0.9em]",
          suggestionPresentationLength(node.children) <= UNBROKEN_CODE &&
            "whitespace-nowrap",
        )}
      >
        {children}
      </code>
    );
  if (node.type === "underline") return <u key={key}>{children}</u>;
  if (node.type === "link") {
    return (
      <Fragment key={key}>
        <span className="underline underline-offset-2">{children}</span>
        <span> ({node.url})</span>
      </Fragment>
    );
  }
}

export function suggestionTextNodes(
  content: string,
  context?: SuggestionPresentationContext,
): SuggestionPresentationNode[] | null {
  const presented = context
    ? suggestionTextPresentationForSource(content, context)
    : suggestionTextPresentation(content);
  if (!presented) return null;
  let start = 0;
  let end = presented.length;
  const isBreak = (node: SuggestionPresentationNode | undefined) =>
    node?.type === "lineBreak";
  while (start < end && isBreak(presented[start])) start += 1;
  while (end > start && isBreak(presented[end - 1])) end -= 1;
  const marker = (count: number): SuggestionPresentationNode[] =>
    count ? [{ type: "text", value: "↵".repeat(count) }] : [];
  return [
    ...marker(start),
    ...presented.slice(start, end),
    ...marker(presented.length - end),
  ];
}

export function SuggestionText({
  content,
  context,
  clip,
}: {
  content: string;
  context?: SuggestionPresentationContext | undefined;
  clip?: { head: number; tail: number } | undefined;
}) {
  const t = useT();
  const whole = suggestionTextNodes(content, context);
  if (!whole) {
    return (
      <span data-suggestion-text-unavailable="true">
        {t("editor.sourceComponent.previewUnavailable")}
      </span>
    );
  }
  const nodes = clip ? clipSuggestionPresentation(whole, clip) : whole;
  return (
    <span className="whitespace-pre-wrap break-words">
      {nodes.map((node, index) => renderNode(node, String(index)))}
    </span>
  );
}
