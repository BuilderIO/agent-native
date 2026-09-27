import { IconChevronDown, IconHistory, IconX } from "@tabler/icons-react";
import React, { useEffect, useId, useMemo, useState } from "react";

import { parseChangelog, type ChangelogEntry } from "../../changelog/parse.js";
import {
  markdownModule,
  remarkGfmFn,
  useMarkdownReady,
  markdownUrlTransform,
} from "../chat/markdown-renderer.js";
import { DEFAULT_LOCALE, useOptionalLocale, type LocaleCode } from "../i18n.js";
import { cn } from "../utils.js";

export {
  getChangelogLatestId,
  useChangelogSeen,
} from "./use-changelog-seen.js";

function formatEntryHeading(entry: ChangelogEntry, locale: LocaleCode): string {
  if (entry.date) {
    const [y, m, d] = entry.date.split("-").map(Number);
    if (y && m && d) {
      const formatted = new Date(y, m - 1, d).toLocaleDateString(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      return entry.version ? `${entry.version} · ${formatted}` : formatted;
    }
  }
  return entry.title;
}

const changelogMarkdownComponents = {
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3
      {...props}
      className="mb-1.5 mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:mt-0"
    />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul
      {...props}
      className="mb-2 ml-1 list-disc space-y-1 pl-4 text-sm text-foreground marker:text-muted-foreground"
    />
  ),
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
    <ol
      {...props}
      className="mb-2 ml-1 list-decimal space-y-1 pl-4 text-sm text-foreground marker:text-muted-foreground"
    />
  ),
  li: (props: React.HTMLAttributes<HTMLLIElement>) => (
    <li {...props} className="leading-relaxed" />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props} className="mb-2 text-sm leading-relaxed text-foreground" />
  ),
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      {...props}
      target="_blank"
      rel="noreferrer"
      className="font-medium underline underline-offset-2"
    />
  ),
  code: (props: React.HTMLAttributes<HTMLElement>) => (
    <code
      {...props}
      className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
    />
  ),
};

function ChangelogBody({ markdown }: { markdown: string }) {
  const ready = useMarkdownReady();
  const ReactMarkdown = markdownModule?.default;
  const gfm = remarkGfmFn;

  if (!ready || !ReactMarkdown || !gfm) {
    return (
      <div className="whitespace-pre-wrap text-sm text-foreground">
        {markdown}
      </div>
    );
  }
  return (
    <ReactMarkdown
      remarkPlugins={[gfm]}
      components={changelogMarkdownComponents}
      urlTransform={markdownUrlTransform}
    >
      {markdown}
    </ReactMarkdown>
  );
}

function ChangelogEntries({
  entries,
  emptyText,
}: {
  entries: ChangelogEntry[];
  emptyText: string;
}) {
  const locale = useOptionalLocale()?.locale ?? DEFAULT_LOCALE;

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <div className="space-y-6">
      {entries.map((entry) => (
        <section key={entry.id}>
          <h4 className="mb-2 text-sm font-semibold text-foreground">
            {formatEntryHeading(entry, locale)}
          </h4>
          <ChangelogBody markdown={entry.body} />
        </section>
      ))}
    </div>
  );
}

export interface ChangelogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  markdown: string;
  title?: string;
  closeLabel?: string;
  emptyText?: string;
}

export function ChangelogDialog({
  open,
  onOpenChange,
  markdown,
  title = "What's new",
  closeLabel = "Close",
  emptyText = "No updates have been published yet.",
}: ChangelogDialogProps) {
  const entries = useMemo(() => parseChangelog(markdown), [markdown]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="mt-[8vh] flex max-h-[80vh] w-full max-w-xl flex-col rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <IconHistory className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{title}</h3>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label={closeLabel}
            className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <ChangelogEntries entries={entries} emptyText={emptyText} />
        </div>
      </div>
    </div>
  );
}

export interface ChangelogSettingsCardProps {
  markdown: string;
  limit?: number;
  title?: string;
  closeLabel?: string;
  emptyText?: string;
  viewAllLabel?: string;
  collapseLabel?: string;
  className?: string;
}

export function ChangelogSettingsCard({
  markdown,
  limit = 2,
  title = "What's new",
  emptyText = "No updates yet.",
  viewAllLabel = "View all updates",
  collapseLabel = "Show fewer updates",
  className,
}: ChangelogSettingsCardProps) {
  const entries = useMemo(() => parseChangelog(markdown), [markdown]);
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();

  if (entries.length === 0) return null;

  const shown = entries.slice(0, limit);
  const hasMore = entries.length > shown.length;
  const visibleEntries = expanded ? entries : shown;

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <IconHistory className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="px-5 py-4">
        <div
          id={bodyId}
          className={cn(
            "overflow-hidden transition-[max-height] duration-200 ease-[var(--ease-collapse)]",
            expanded ? "max-h-96 overflow-y-auto pr-1" : "max-h-[9.5rem]",
          )}
        >
          <ChangelogEntries entries={visibleEntries} emptyText={emptyText} />
        </div>
        {hasMore && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls={bodyId}
            className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-foreground underline underline-offset-2"
          >
            <span>{expanded ? collapseLabel : viewAllLabel}</span>
            <IconChevronDown
              className={cn(
                "h-4 w-4 transition-transform duration-200 ease-[var(--ease-collapse)]",
                expanded && "rotate-180",
              )}
              aria-hidden="true"
            />
          </button>
        )}
      </div>
    </div>
  );
}

export { parseChangelog };
export type { ChangelogEntry };
