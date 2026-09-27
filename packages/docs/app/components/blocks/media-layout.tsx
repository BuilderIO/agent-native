import type { BlockRenderContext } from "@agent-native/core/blocks";
import { IconArrowsMaximize, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { MediaAlign } from "./media-shared";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function MediaLightbox({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Media preview"
      onClick={onClose}
      className="docs-media-lightbox-backdrop"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="docs-media-lightbox-panel"
      >
        {children}
      </div>
      <button
        ref={closeButtonRef}
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className="docs-media-lightbox-close"
      >
        <IconX className="docs-media-lightbox-close-icon" aria-hidden="true" />
      </button>
    </div>
  );
}

export function MediaFrame({
  className,
  align,
  width,
  caption,
  text,
  ctx,
  media,
  expandable,
}: {
  className: string;
  align?: MediaAlign;
  width?: number;
  caption?: string;
  text?: string;
  ctx: BlockRenderContext;
  media: ReactNode;
  expandable?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const resolvedAlign = align ?? "full";
  const hasText = Boolean(text && text.trim());
  const sideBySide = resolvedAlign !== "full" && hasText;

  const captionNode = caption && (
    <div className="docs-media-caption">
      {ctx.renderMarkdown?.(caption) ?? <p>{caption}</p>}
    </div>
  );

  const figure = (
    <div
      className="docs-media-figure"
      style={
        sideBySide && width
          ? { flexBasis: `${width}px`, maxWidth: `${width}px` }
          : undefined
      }
    >
      <div className="docs-media-figure-inner">
        {media}
        {expandable && (
          <button
            type="button"
            className="docs-media-expand"
            aria-label="Expand"
            onClick={() => setExpanded(true)}
          >
            <IconArrowsMaximize
              className="docs-media-expand-icon"
              aria-hidden="true"
            />
          </button>
        )}
      </div>
      {captionNode}
    </div>
  );

  const textColumn = hasText && (
    <div className="docs-media-text">
      {ctx.renderMarkdown?.(text!) ?? <p>{text}</p>}
    </div>
  );

  const frame = !sideBySide ? (
    <div className={`docs-media docs-media-full ${className}`}>
      {figure}
      {textColumn}
    </div>
  ) : (
    <div className={`docs-media docs-media-${resolvedAlign} ${className}`}>
      {resolvedAlign === "right" && textColumn}
      {figure}
      {resolvedAlign === "left" && textColumn}
    </div>
  );

  return (
    <>
      {frame}
      {expandable && expanded && (
        <MediaLightbox onClose={() => setExpanded(false)}>
          {media}
          {captionNode}
          {textColumn}
        </MediaLightbox>
      )}
    </>
  );
}
