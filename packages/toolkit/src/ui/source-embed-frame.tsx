import * as React from "react";

import { cn } from "../utils.js";

export interface SourceEmbedFrameProps extends Omit<
  React.HTMLAttributes<HTMLElement>,
  "title"
> {
  /** What the copy is, such as the panel's title. */
  title: React.ReactNode;
  /**
   * Where it comes from and when, already translated, such as
   * "Growth dashboard · Last 90 days · Copied Nov 7".
   */
  meta?: React.ReactNode;
  /** The source, opened in its own app. */
  href?: string;
  /** Label of the link to the source, such as "Open in Analytics". */
  openLabel?: React.ReactNode;
  onOpen?: () => void;
  /** Controls for the copy, such as Refresh; shown for editors only. */
  actions?: React.ReactNode;
  /**
   * A short line about the copy's state, such as "The panel changed since
   * this copy", shown under the header.
   */
  notice?: React.ReactNode;
  /** The copy itself. */
  children: React.ReactNode;
}

/**
 * The frame around a copy of another app's resource kept in a page: a chart
 * from Analytics, a screen from Design, a slide from Slides. It names the
 * source, links back to it and holds the copy's controls, so every kind of
 * copy reads the same way. It is a `figure`, captioned by its title.
 */
export const SourceEmbedFrame = React.forwardRef<
  HTMLElement,
  SourceEmbedFrameProps
>(
  (
    {
      title,
      meta,
      href,
      openLabel,
      onOpen,
      actions,
      notice,
      children,
      className,
      ...props
    },
    ref,
  ) => {
    const titleId = React.useId();
    return (
      <figure
        ref={ref}
        aria-labelledby={titleId}
        className={cn(
          "an-source-embed my-1 overflow-hidden rounded-lg border border-border bg-card text-card-foreground",
          className,
        )}
        {...props}
      >
        <figcaption className="flex items-start gap-3 px-3 pt-2.5">
          <div className="min-w-0 flex-1">
            <div
              id={titleId}
              className="truncate text-sm font-medium text-foreground"
            >
              {title}
            </div>
            {meta ? (
              <div className="truncate text-xs text-muted-foreground">
                {meta}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            {href && openLabel ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onOpen}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground underline-offset-2 hover:bg-muted hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {openLabel}
              </a>
            ) : null}
          </div>
        </figcaption>
        {notice ? (
          <div className="px-3 pt-1 text-xs text-muted-foreground">
            {notice}
          </div>
        ) : null}
        <div className="px-3 pb-3 pt-2">{children}</div>
      </figure>
    );
  },
);
SourceEmbedFrame.displayName = "SourceEmbedFrame";
