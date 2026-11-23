import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useIsMobile } from "@agent-native/toolkit/hooks";
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

import {
  proposalTitle,
  type NotebookReview,
  type PendingChange,
} from "./useNotebookReview";

export function focusPendingChange(proposalId: string) {
  const proposal = document.querySelector<HTMLElement>(
    `[data-notebook-proposal="${CSS.escape(proposalId)}"]`,
  );
  proposal?.scrollIntoView({ block: "nearest" });
  proposal
    ?.querySelector<HTMLElement>("[data-notebook-proposal-heading]")
    ?.focus();
}

export function PendingChangesPanel({
  review,
  onViewVersions,
  onLeaveThread,
}: {
  review: NotebookReview;
  onViewVersions: () => void;
  onLeaveThread?: (() => void) | undefined;
}) {
  const t = useT();
  const mobile = useIsMobile();
  const formatters = useFormatters();
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const { changes } = review;
  const conflicts = changes.some(({ status }) => status === "conflicted");
  const jump = (change: PendingChange) => {
    setFocused(change.id);
    if (mobile && expanded) {
      setExpanded(false);
      requestAnimationFrame(() => focusPendingChange(change.id));
    } else {
      focusPendingChange(change.id);
    }
  };
  useEffect(() => {
    if (changes.length === 0 && !expanded) return;
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        expanded &&
        !mobile &&
        !review.decisionGroup
      ) {
        setExpanded(false);
        trigger.current?.focus();
        return;
      }
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (event.code !== "KeyK" && event.key.toLowerCase() !== "k") ||
        (event.target instanceof Element &&
          event.target.closest("input, textarea, [contenteditable=true]"))
      )
        return;
      const index = changes.findIndex(({ id }) => id === focused);
      const next =
        changes[
          (changes.length +
            (index < 0
              ? event.shiftKey
                ? -1
                : 0
              : index + (event.shiftKey ? -1 : 1))) %
            changes.length
        ];
      if (!next) return;
      event.preventDefault();
      setFocused(next.id);
      focusPendingChange(next.id);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [changes, expanded, focused, mobile, review.decisionGroup]);
  if (review.loading)
    return (
      <Skeleton
        className="h-10 w-full"
        role="status"
        aria-label={t("notebook.reviewLoading")}
      />
    );
  if (review.error) {
    const forbidden = [
      "review_forbidden",
      "thread_not_found",
      "review_context_required",
    ].includes(review.error);
    return (
      <div className="nb-banner" role="alert">
        {t(
          forbidden ? "notebook.reviewForbidden" : "notebook.reviewLoadFailed",
        )}
        {forbidden && onLeaveThread ? (
          <Button variant="ghost" size="sm" onClick={onLeaveThread}>
            {t("notebook.reviewBackToNotebook")}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={review.showLatest}>
            {t("notebook.reviewViewLatest")}
          </Button>
        )}
      </div>
    );
  }
  if (!review.ready) return null;
  const group = review.decisionGroup?.choice;
  const groupedTitles =
    group?.selection.kind === "selected"
      ? changes.flatMap((change, index) =>
          group.selection.kind === "selected" &&
          group.selection.ids.includes(change.id)
            ? [proposalTitle(change, index + 1)]
            : [],
        )
      : [];
  const adjacent = (direction: number) => {
    const index = changes.findIndex(({ id }) => id === focused);
    const next =
      changes[
        (changes.length +
          (index < 0 ? (direction < 0 ? -1 : 0) : index + direction)) %
          changes.length
      ];
    if (next) jump(next);
  };
  const rows = (
    <ul className="m-0 list-none divide-y p-0">
      {changes.map((change, index) => {
        const title = proposalTitle(change, index + 1);
        return (
          <li key={change.id} className="flex items-center gap-1 px-1 py-1">
            <Button
              size="sm"
              variant="ghost"
              className="min-w-0 flex-1 justify-start"
              onClick={() => jump(change)}
            >
              <span className="truncate">{title}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={review.busy}
              aria-label={t("notebook.reviewUndoCell", { cell: title })}
              onClick={() => review.choose("undo", change.id)}
            >
              <IconX size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={review.busy || change.status === "conflicted"}
              aria-label={t("notebook.reviewConfirmCell", {
                cell: title,
              })}
              onClick={() => review.choose("confirm", change.id)}
            >
              <IconCheck size={14} />
            </Button>
          </li>
        );
      })}
    </ul>
  );
  return (
    <>
      <div className="nb-pending-panel">
        {review.checkpointId ? (
          <div role="status" className="flex items-center gap-2 text-sm">
            {t("notebook.reviewSavedVersion")}
            <Button size="sm" variant="link" onClick={onViewVersions}>
              {t("notebook.reviewViewVersion")}
            </Button>
          </div>
        ) : null}
        {(review.decisionFailed || conflicts) && (
          <div className="nb-banner" role="alert">
            {t(
              review.conflict || conflicts
                ? "notebook.reviewConflict"
                : "notebook.reviewFailed",
            )}
            <Button size="sm" variant="ghost" onClick={review.showLatest}>
              {t("notebook.reviewViewLatest")}
            </Button>
          </div>
        )}
        {changes.length === 0 ? (
          <p className="m-0 py-2 text-sm text-muted-foreground" role="status">
            {t("notebook.reviewEmpty")}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1 py-1">
              <Button
                ref={trigger}
                size="sm"
                variant="ghost"
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
              >
                {t("notebook.reviewCount", { count: changes.length })}
                <IconChevronDown size={14} aria-hidden="true" />
              </Button>
              <span aria-hidden="true">·</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={review.busy}
                aria-label={t("notebook.reviewUndoAll")}
                onClick={() => review.choose("undo")}
              >
                {t("notebook.pendingReviewUndo")}
              </Button>
              <span aria-hidden="true">·</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={
                  review.busy ||
                  changes.some(({ status }) => status === "conflicted")
                }
                aria-label={t("notebook.reviewConfirmAll")}
                onClick={() => review.choose("confirm")}
              >
                {t("notebook.pendingReviewConfirm")}
              </Button>
            </div>
            {mobile ? (
              <Dialog open={expanded} onOpenChange={setExpanded}>
                <DialogContent
                  className="nb-review-sheet"
                  aria-describedby={undefined}
                  onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    trigger.current?.focus();
                  }}
                >
                  <DialogTitle>
                    {t("notebook.reviewCount", { count: changes.length })}
                  </DialogTitle>
                  {rows}
                  <DialogFooter className="sticky bottom-0 bg-background">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="nb-pending-undo"
                      disabled={review.busy}
                      onClick={() => review.choose("undo")}
                    >
                      {t("notebook.pendingReviewUndo")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="nb-pending-confirm"
                      disabled={
                        review.busy ||
                        changes.some(({ status }) => status === "conflicted")
                      }
                      onClick={() => review.choose("confirm")}
                    >
                      {t("notebook.pendingReviewConfirm")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : (
              expanded && rows
            )}
          </>
        )}
        <Dialog
          open={group !== undefined}
          onOpenChange={(open) => {
            if (!open) review.resolveGroup(false);
          }}
        >
          <DialogContent>
            <DialogTitle>{t("notebook.pendingReviewViewChanges")}</DialogTitle>
            <DialogDescription>
              {t("notebook.reviewDependsOn", {
                cells: formatters.formatList(groupedTitles),
              })}
            </DialogDescription>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => review.resolveGroup(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                variant="outline"
                onClick={() => review.resolveGroup(true)}
              >
                {t(
                  group?.decision === "undo"
                    ? "notebook.pendingReviewUndo"
                    : "notebook.pendingReviewConfirm",
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {changes.length > 0 && (
        <div className="nb-pending-navigation">
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("notebook.reviewPrevious")}
            onClick={() => adjacent(-1)}
          >
            <IconChevronUp size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("notebook.pendingReviewViewChanges")}
            aria-keyshortcuts="Alt+K"
            onClick={() => adjacent(1)}
          >
            {t("notebook.pendingReviewViewChanges")}
            <kbd aria-hidden="true">{t("notebook.reviewShortcut")}</kbd>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("notebook.reviewNext")}
            onClick={() => adjacent(1)}
          >
            <IconChevronDown size={14} />
          </Button>
        </div>
      )}
    </>
  );
}
