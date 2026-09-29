import { Button } from "@agent-native/toolkit/ui/button";
import { IconChevronDown, IconHistory, IconX } from "@tabler/icons-react";
import React, { useEffect, useId, useMemo, useState } from "react";

import { parseChangelog, type ChangelogEntry } from "../../changelog/parse.js";
import {
  markdownModule,
  remarkGfmFn,
  useMarkdownReady,
  markdownUrlTransform,
} from "../chat/markdown-renderer.js";
import {
  DEFAULT_LOCALE,
  useOptionalLocale,
  useT,
  type LocaleCode,
} from "../i18n.js";
import { cn } from "../utils.js";

export {
  getChangelogLatestId,
  useChangelogSeen,
} from "./use-changelog-seen.js";

function formatEntryHeading(entry: ChangelogEntry, locale: LocaleCode): string {
  if (!entry.date) return entry.title;
  const formatted = formatEntryDate(entry.date, locale);
  return entry.version ? `${entry.version} · ${formatted}` : formatted;
}

function formatEntryDate(date: string, locale: LocaleCode): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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

function ChangelogCards({ entries }: { entries: ChangelogEntry[] }) {
  const locale = useOptionalLocale()?.locale ?? DEFAULT_LOCALE;
  const groups = new Map<
    string,
    { heading: string; entries: ChangelogEntry[] }
  >();

  for (const entry of entries) {
    const key = entry.date ?? entry.id;
    const heading = entry.date
      ? formatEntryDate(entry.date, locale)
      : entry.title;
    const group = groups.get(key);
    if (group) group.entries.push(entry);
    else groups.set(key, { heading, entries: [entry] });
  }

  return (
    <div className="space-y-6">
      {[...groups].map(([key, group]) => (
        <section key={key}>
          <h4 className="mb-3 text-sm font-semibold text-foreground">
            {group.heading}
          </h4>
          <div className="space-y-3">
            {group.entries.map((entry) => (
              <article
                key={entry.id}
                className="rounded-lg border border-border bg-card p-4 text-card-foreground"
              >
                {entry.version && (
                  <h5 className="mb-2 text-xs font-semibold text-muted-foreground">
                    {entry.version}
                  </h5>
                )}
                <ChangelogBody markdown={entry.body} />
              </article>
            ))}
          </div>
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
  /** Number of entries shown and revealed per click. Defaults to ten. */
  limit?: number;
  title?: string;
  /** Drop the heading, for a page whose header already names it. */
  hideTitle?: boolean;
  /** @deprecated Inline cards do not have a close control. */
  closeLabel?: string;
  emptyText?: string;
  viewAllLabel?: string;
  /** @deprecated Changelog cards reveal entries incrementally instead of collapsing. */
  collapseLabel?: string;
  className?: string;
}

export function ChangelogSettingsCard({
  markdown,
  limit = 10,
  title,
  hideTitle = false,
  emptyText,
  viewAllLabel,
  className,
}: ChangelogSettingsCardProps) {
  const t = useT();
  const entries = useMemo(() => parseChangelog(markdown), [markdown]);
  const pageSize = Math.max(1, Math.floor(limit));
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const bodyId = useId();
  const heading = title ?? t("agentChat.settingsShell.page.whatsNew");

  const visibleEntries = entries.slice(0, visibleCount);
  const hasMore = entries.length > visibleEntries.length;

  return (
    <div className={cn("space-y-4 text-card-foreground", className)}>
      {hideTitle ? null : (
        <div className="flex items-center gap-2">
          <IconHistory className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{heading}</h3>
        </div>
      )}
      <div id={bodyId}>
        {entries.length > 0 ? (
          <ChangelogCards entries={visibleEntries} />
        ) : (
          <ChangelogEntries
            entries={[]}
            emptyText={
              emptyText ?? t("agentChat.settingsShell.appGroup.whatsNewEmpty")
            }
          />
        )}
      </div>
      {hasMore && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setVisibleCount((count) => count + pageSize)}
          aria-controls={bodyId}
        >
          {viewAllLabel ?? t("agentChat.share.loadMore")}
          <IconChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

export { parseChangelog };
export type { ChangelogEntry };
