import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Monospace is the FURNITURE voice: labels, bylines, stat rows, indices, tags.
 * Prose — headlines, deks, body paragraphs — stays in the UI font so it reads
 * at length. Swapping either way costs the page its register.
 */
export const EDITION_LABEL_CLASS = "font-mono text-[0.72rem] text-plan-muted";

export const EDITION_META_CLASS = "font-mono text-xs text-plan-muted";

/** Read state, HN-style: a visited story dims and nothing else changes. */
export const EDITION_LINK_CLASS =
  "underline decoration-plan-line decoration-1 underline-offset-[5px] transition-[text-decoration-color] visited:text-plan-muted hover:decoration-current";

/** `01`, `02`, … — a fixed-width index the rail and the stories share. */
export function editionStoryNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/** A `// section` label. The slashes are decoration, not translated copy. */
export function EditionLabel({
  as: Tag = "p",
  children,
  className,
}: {
  as?: "h2" | "h3" | "p";
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tag className={cn(EDITION_LABEL_CLASS, className)}>
      <span aria-hidden="true">{"// "}</span>
      {children}
    </Tag>
  );
}

/**
 * A middot-separated run of facts: byline, cohort tail, story totals. Falsy
 * items drop out, so a caller can pass a stat it may not have without leaving
 * a stray separator behind.
 */
export function EditionMetaLine({
  items,
  className,
}: {
  items: ReactNode[];
  className?: string;
}) {
  const visible = items.filter(Boolean);
  if (visible.length === 0) return null;
  return (
    <p
      className={cn(
        EDITION_META_CLASS,
        "flex flex-wrap items-center gap-x-2 gap-y-1",
        className,
      )}
    >
      {visible.map((item, index) => (
        <span key={index} className="flex items-center gap-x-2">
          {index > 0 && <span aria-hidden="true">·</span>}
          {item}
        </span>
      ))}
    </p>
  );
}
