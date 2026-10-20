import { useT } from "@agent-native/core/client/i18n";
import {
  suggestionTextPresentationForSource,
  suggestionTextPresentation,
  type SuggestionPresentationContext,
  type SuggestionPresentationNode,
} from "@shared/suggestion-text";
import { Fragment, type ReactNode } from "react";

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
      <code key={key} className="rounded bg-muted px-1 font-mono text-[0.9em]">
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

export function SuggestionText({
  content,
  context,
}: {
  content: string;
  context?: SuggestionPresentationContext;
}) {
  const t = useT();
  const presented = context
    ? suggestionTextPresentationForSource(content, context)
    : suggestionTextPresentation(content);
  if (!presented) {
    return (
      <span data-suggestion-text-unavailable="true">
        {t("editor.sourceComponent.previewUnavailable")}
      </span>
    );
  }
  // A new paragraph's own line break would open or close the card with an
  // empty line; the lines between stay.
  let start = 0;
  let end = presented.length;
  while (start < end && presented[start]!.type === "lineBreak") start += 1;
  while (end > start && presented[end - 1]!.type === "lineBreak") end -= 1;
  const nodes = presented.slice(start, end);
  return (
    <span className="whitespace-pre-wrap break-words">
      {nodes.map((node, index) => renderNode(node, String(index)))}
    </span>
  );
}
