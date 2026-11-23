import { useT } from "@agent-native/core/client/i18n";
import {
  registerActionChatRenderer,
  type ToolRendererProps,
} from "@agent-native/toolkit/app/chat/chat";
import { createContext, useContext } from "react";
import { z } from "zod";

import { focusPendingChange } from "./PendingChangesPanel";
import {
  proposalCell,
  proposalTitle,
  type NotebookReview,
} from "./useNotebookReview";

export const NotebookReviewContext = createContext<NotebookReview | null>(null);

const stagedResult = z.object({
  proposalIds: z.array(z.string()).min(1),
  threadId: z.string().optional(),
});

export function PendingChangeCard({ context }: ToolRendererProps) {
  const t = useT();
  const review = useContext(NotebookReviewContext);
  const result = stagedResult.safeParse(context.resultJson);
  if (
    !review?.page ||
    !review.threadId ||
    !result.success ||
    (result.data.threadId && result.data.threadId !== review.threadId)
  )
    return null;
  return review.page.changes.map((change, index) => {
    if (!result.data.proposalIds.includes(change.id)) return null;
    const contents = proposalCell(change)?.contents;
    const title =
      (contents?.kind === "text" && contents.text.trim().slice(0, 80)) ||
      proposalTitle(change, index + 1);
    return (
      <div className="flex items-center gap-2 text-sm" key={change.id}>
        {change.status === "undone" ? (
          <>
            <del className="text-muted-foreground">{title}</del>
            <span className="sr-only">{t("notebook.reviewUndone")}</span>
          </>
        ) : change.status === "confirmed" ? (
          <span>{title}</span>
        ) : (
          <button
            type="button"
            className="nb-inline-link"
            onClick={() => focusPendingChange(change.id)}
          >
            {title}
          </button>
        )}
      </div>
    );
  });
}

registerActionChatRenderer({
  id: "analytics-notebook-pending-change",
  renderer: "analytics2.notebook-proposal",
  Component: PendingChangeCard,
});
