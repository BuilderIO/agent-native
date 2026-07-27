/**
 * Changelog UI — renders an app's CHANGELOG.md as an in-app "What's new"
 * surface. Core owns all of this; a template just passes its own
 * `CHANGELOG.md?raw` content in (Vite inlines it at build time, so this works
 * on every host with no runtime file access or server route).
 *
 * Surfaces:
 *   - <ChangelogDialog>      a self-contained modal listing every release.
 *   - <ChangelogSettingsCard> a settings-page card with the latest updates.
 *   - useChangelogSeen()     tracks the last release a user has seen (so the
 *                            command menu can show an "unseen" dot).
 *
 * The command menu's built-in `changelog` prop (see CommandMenu.tsx) wires the
 * dialog automatically — most templates never touch these directly.
 */

import { IconX, IconHistory } from "@tabler/icons-react";
import React, { useEffect, useMemo, useState } from "react";

import { parseChangelog, type ChangelogEntry } from "../../changelog/parse.js";
import {
  markdownModule,
  remarkGfmFn,
  useMarkdownReady,
  markdownUrlTransform,
} from "../chat/markdown-renderer.js";
import { DEFAULT_LOCALE, useOptionalLocale, type LocaleCode } from "../i18n.js";
import { cn } from "../utils.js";

// ─── Date formatting ──────────────────────────────────────────────────────────

function formatEntryHeading(entry: ChangelogEntry, locale: LocaleCode): string {
  if (entry.date) {
    // Parse as a plain calendar date (avoid TZ shifting YYYY-MM-DD back a day).
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

// ─── Markdown body ────────────────────────────────────────────────────────────
// A small, self-contained renderer for a release body. Avoids depending on the
// typography plugin (`prose`) being generated in the host template by applying
// explicit utility classes that Tailwind scans from core's compiled output.

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
    // The react-markdown chunk loads on module eval; this is typically only one
    // frame. Show readable plain text rather than nothing in the meantime.
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

// ─── Unseen tracking ──────────────────────────────────────────────────────────

function seenStorageKey(appKey: string): string {
  return `an:changelog-seen:${appKey}`;
}

/**
 * Tracks the latest release a user has already seen (per browser, via
 * localStorage). Returns whether there's an unseen release and a `markSeen`
 * callback to clear the indicator once the changelog is opened.
 */
export function useChangelogSeen(
  appKey: string,
  latestId: string | undefined,
): { unseen: boolean; markSeen: () => void } {
  const [seenId, setSeenId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      setSeenId(window.localStorage.getItem(seenStorageKey(appKey)));
    } catch {
      // Private mode / disabled storage — treat as "nothing seen yet".
    }
    setHydrated(true);
  }, [appKey]);

  const markSeen = React.useCallback(() => {
    if (!latestId) return;
    setSeenId(latestId);
    try {
      window.localStorage.setItem(seenStorageKey(appKey), latestId);
    } catch {
      // Ignore storage failures; the dot just won't persist.
    }
  }, [appKey, latestId]);

  // Don't flag "unseen" until hydrated, and never on a first-ever visit (no
  // stored value) — only once the user has seen *something* and a newer
  // release appears. This avoids nagging brand-new users.
  const unseen =
    hydrated && !!latestId && seenId !== null && seenId !== latestId;

  return { unseen, markSeen };
}

// ─── Shared markup ────────────────────────────────────────────────────────────

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

// ─── Dialog ───────────────────────────────────────────────────────────────────

export interface ChangelogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Raw CHANGELOG.md contents (e.g. `import md from "../CHANGELOG.md?raw"`). */
  markdown: string;
  /** Dialog heading. Default: "What's new". */
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

// ─── Settings card ────────────────────────────────────────────────────────────

export interface ChangelogSettingsCardProps {
  /** Raw CHANGELOG.md contents (e.g. `import md from "../CHANGELOG.md?raw"`). */
  markdown: string;
  /** How many recent releases to show inline before "View all". Default: 2. */
  limit?: number;
  /** Card heading. Default: "What's new". */
  title?: string;
  closeLabel?: string;
  emptyText?: string;
  viewAllLabel?: string;
  className?: string;
}

export function ChangelogSettingsCard({
  markdown,
  limit = 2,
  title = "What's new",
  closeLabel = "Close",
  emptyText = "No updates yet.",
  viewAllLabel = "View all updates",
  className,
}: ChangelogSettingsCardProps) {
  const entries = useMemo(() => parseChangelog(markdown), [markdown]);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (entries.length === 0) return null;

  const shown = entries.slice(0, limit);
  const hasMore = entries.length > shown.length;

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
        <ChangelogEntries entries={shown} emptyText={emptyText} />
        {hasMore && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="mt-4 text-sm font-medium text-foreground underline underline-offset-2"
          >
            {viewAllLabel}
          </button>
        )}
      </div>
      <ChangelogDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        markdown={markdown}
        title={title}
        closeLabel={closeLabel}
        emptyText={emptyText}
      />
    </div>
  );
}

export { parseChangelog };
export type { ChangelogEntry };
