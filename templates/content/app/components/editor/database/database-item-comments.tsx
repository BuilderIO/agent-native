import { useT } from "@agent-native/core/client/i18n";
import type { ContentDatabaseItem } from "@shared/api";
import { IconMessage } from "@tabler/icons-react";
import { createContext, useContext } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * What a row's Comments open on: one thread, a new comment on one Property,
 * or a new comment on the whole Page. Without one, they open on the list.
 */
export type DatabaseItemCommentTarget =
  | { threadId: string }
  | { propertyId: string }
  | { pageComment: true };

/**
 * Opens a row with its Comments showing, on `target` or else the list.
 * Without a provider, rows show no Comment markers.
 */
export type OpenDatabaseItemComments = (
  item: ContentDatabaseItem,
  target: DatabaseItemCommentTarget | null,
) => void;

export const DatabaseItemCommentsContext =
  createContext<OpenDatabaseItemComments | null>(null);

export const databaseCommentMarkerClassName =
  "flex h-6 min-w-6 shrink-0 items-center justify-center gap-0.5 rounded px-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring comment-marker";

/** The count of a row's open Comment threads, beside its name. */
export function DatabaseRowCommentCount({
  item,
}: {
  item: ContentDatabaseItem;
}) {
  const t = useT();
  const openComments = useContext(DatabaseItemCommentsContext);
  const count = item.comments?.open ?? 0;
  if (!openComments || count === 0) return null;
  const label = t("comments.openRowComments", {
    count,
    title: item.document.title || "Untitled",
  });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={databaseCommentMarkerClassName}
          aria-label={label}
          data-database-row-comments={count}
          onClick={(event) => {
            event.stopPropagation();
            openComments(item, null);
          }}
        >
          <IconMessage className="size-3.5" aria-hidden="true" />
          {count}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
