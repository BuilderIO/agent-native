import { useT } from "@agent-native/core/client/i18n";
import { IconFileText } from "@tabler/icons-react";
import { useId, useState } from "react";
import { Link } from "react-router";

import { useBacklinks } from "@/hooks/use-backlinks";

import { ContentIcon } from "../icons/ContentIcon";

export const BACKLINKS_FOLDED_COUNT = 5;

function refusedRead(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403 || status === 404;
}

export function DocumentBacklinks({ documentId }: { documentId: string }) {
  const t = useT();
  const { query, list } = useBacklinks(documentId);
  const [unfolded, setUnfolded] = useState(false);
  const titleId = useId();
  if (query.isError && refusedRead(query.error)) return null;
  const pages = list?.pages ?? [];
  const hidden = Math.max(0, pages.length - BACKLINKS_FOLDED_COUNT);
  const shown = unfolded ? pages : pages.slice(0, BACKLINKS_FOLDED_COUNT);

  return (
    <section
      className="mt-6 grid gap-1 border-t border-border px-2 pt-3 text-xs text-muted-foreground"
      data-document-backlinks
      aria-labelledby={titleId}
    >
      <h3 id={titleId} className="flex items-center gap-1.5 pb-0.5 font-medium">
        {t("backlinks.title")}
        {list && list.count > 0 ? (
          <span className="tabular-nums" data-document-backlinks-count>
            <span aria-hidden="true">· </span>
            {list.more ? `${list.count}+` : list.count}
          </span>
        ) : null}
      </h3>
      {query.isError ? (
        <p className="flex flex-wrap items-center gap-x-2">
          <span>{t("backlinks.loadFailed")}</span>
          <button
            type="button"
            className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => void query.refetch()}
          >
            {t("backlinks.retry")}
          </button>
        </p>
      ) : !list ? (
        <div
          className="h-4 w-32 animate-pulse rounded bg-muted/40"
          role="status"
          aria-label={t("backlinks.loading")}
        />
      ) : pages.length === 0 ? (
        <p data-document-backlinks-empty>{t("backlinks.none")}</p>
      ) : (
        <>
          <ul className="-mx-1 grid gap-px" data-document-backlinks-list>
            {shown.map((page) => (
              <li key={page.id} className="min-w-0">
                <Link
                  to={`/page/${encodeURIComponent(page.id)}`}
                  className="flex min-h-7 min-w-0 items-center gap-1.5 rounded px-1 py-1 text-sm text-foreground/85 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-document-backlink={page.id}
                >
                  <ContentIcon
                    value={page.icon}
                    size={14}
                    className="shrink-0"
                    fallback={
                      <IconFileText
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    }
                  />
                  <span className="truncate">
                    {page.title.trim() || t("sidebar.untitled")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {hidden > 0 ? (
            <button
              type="button"
              className="justify-self-start rounded py-0.5 font-medium text-foreground/80 underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={unfolded}
              onClick={() => setUnfolded((open) => !open)}
              data-document-backlinks-toggle
            >
              {unfolded
                ? t("backlinks.showFewer")
                : t("backlinks.showMore", { count: hidden })}
            </button>
          ) : null}
          {(list.more || pages.length < list.count) &&
          (unfolded || hidden === 0) ? (
            <p>{t("backlinks.notAllListed")}</p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function BacklinkCount({
  documentId,
  onOpen,
}: {
  documentId: string;
  onOpen: () => void;
}) {
  const t = useT();
  const { query, list } = useBacklinks(documentId);
  if (query.isError && refusedRead(query.error)) return null;
  if (!list || list.count === 0) return null;
  return (
    <button
      type="button"
      className="-mr-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onOpen}
      data-document-backlink-count
    >
      {list.more
        ? t("backlinks.linkedFromMore", { count: list.count })
        : t("backlinks.linkedFrom", { count: list.count })}
    </button>
  );
}
