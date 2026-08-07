import type { BlockRenderContext } from "@agent-native/core/blocks";
import type { ReactNode } from "react";

import type { MediaAlign } from "./media-shared";

/**
 * Shared layout for the `image` and `video` blocks: full width, or a flex row
 * with the media on one side and markdown `text` as the paired content on the
 * other. `align="left"` puts the media on the left (text on the right);
 * `align="right"` mirrors it. Falls back to full width whenever there's no
 * paired text, since a side-by-side row needs both columns to make sense.
 */
export function MediaFrame({
  className,
  align,
  width,
  caption,
  text,
  ctx,
  media,
}: {
  className: string;
  align?: MediaAlign;
  width?: number;
  caption?: string;
  text?: string;
  ctx: BlockRenderContext;
  media: ReactNode;
}) {
  const resolvedAlign = align ?? "full";
  const hasText = Boolean(text && text.trim());
  const sideBySide = resolvedAlign !== "full" && hasText;

  const figure = (
    <div
      className="docs-media-figure"
      style={
        sideBySide && width
          ? { flexBasis: `${width}px`, maxWidth: `${width}px` }
          : undefined
      }
    >
      {media}
      {caption && (
        <div className="docs-media-caption">
          {ctx.renderMarkdown?.(caption) ?? <p>{caption}</p>}
        </div>
      )}
    </div>
  );

  const textColumn = hasText && (
    <div className="docs-media-text">
      {ctx.renderMarkdown?.(text!) ?? <p>{text}</p>}
    </div>
  );

  if (!sideBySide) {
    return (
      <div className={`docs-media docs-media-full ${className}`}>
        {figure}
        {textColumn}
      </div>
    );
  }

  return (
    <div className={`docs-media docs-media-${resolvedAlign} ${className}`}>
      {resolvedAlign === "right" && textColumn}
      {figure}
      {resolvedAlign === "left" && textColumn}
    </div>
  );
}
