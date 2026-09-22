import { Fragment } from "react";

export function trashPreviewBlocks(markdown: string) {
  return markdown.split(/\n{2,}/).filter((block) => block.trim().length > 0);
}

export function TrashPreviewContent({
  content,
  unsupportedEmbedLabel,
}: {
  content: string;
  unsupportedEmbedLabel: string;
}) {
  return (
    <div className="prose prose-neutral max-w-none dark:prose-invert">
      {trashPreviewBlocks(content).map((block, index) => {
        const trimmed = block.trim();
        if (
          /^<(iframe|script|video|audio)\b/i.test(trimmed) ||
          /^```(?:html|jsx|tsx)/i.test(trimmed)
        ) {
          return (
            <div
              key={index}
              className="not-prose rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground"
            >
              {unsupportedEmbedLabel}
            </div>
          );
        }
        const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
        if (heading) {
          const Tag = `h${heading[1].length}` as "h1" | "h2" | "h3";
          return <Tag key={index}>{heading[2]}</Tag>;
        }
        return (
          <p key={index} className="whitespace-pre-wrap">
            {trimmed
              .split(/(`[^`]+`)/)
              .map((part, partIndex) =>
                part.startsWith("`") && part.endsWith("`") ? (
                  <code key={partIndex}>{part.slice(1, -1)}</code>
                ) : (
                  <Fragment key={partIndex}>{part}</Fragment>
                ),
              )}
          </p>
        );
      })}
    </div>
  );
}
