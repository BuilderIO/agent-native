import { useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ContentDatabaseItem, DocumentProperty } from "@shared/api";
import { commentPropertyTarget } from "@shared/comment-property-target";
import {
  IconLayoutSidebarRight,
  IconMessage,
  IconMessagePlus,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  type MutableRefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type CommentThread,
  collectionRowsShowingDocumentFilter,
  useComments,
} from "@/hooks/use-comments";
import { cn } from "@/lib/utils";

import { CommentDraftProvider } from "../comment-drafts";
import { CommentIconButton } from "../CommentRow";
import {
  CommentsSidebar,
  useCommentReplyDrafts,
  usePendingCommentDraft,
} from "../CommentsSidebar";
import { deviceCannotHover } from "./ContentTable";
import {
  DatabaseItemCommentsContext,
  databaseCommentMarkerClassName,
} from "./database-item-comments";

type CellCommentCard = {
  /** `start` opens on an empty composer, `read` on the cell's open threads. */
  mode: "start" | "read";
  key: number;
};

const NO_THREADS: CommentThread[] = [];

/** Who can start, and who can resolve, Comments on a row's Page. */
export function databaseItemCommentAccess(item: ContentDatabaseItem) {
  const { document } = item;
  if (document.source?.mode === "local-files") {
    return { canComment: false, canResolve: false };
  }
  const role = document.accessRole;
  return {
    canComment:
      document.canComment ??
      (role === "owner" ||
        role === "admin" ||
        role === "editor" ||
        role === "commenter"),
    canResolve: document.canEdit === true,
  };
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest("[contenteditable='true'], input, textarea")
  );
}

/**
 * A table cell's Comments: a marker when its Property has open threads, and a
 * button on hover or focus that starts one. Both open a card on the cell, so
 * reading, replying, and starting a thread happen without leaving the table.
 * Without a provider, cells show no Comment controls.
 */
export function DatabaseCellComments({
  item,
  property,
  rowSelected = false,
  besideEditButton = false,
}: {
  item: ContentDatabaseItem;
  property: DocumentProperty;
  /**
   * Touch screens can't hover, so there the Comment button shows on a
   * selected row's cells, like the row's selection controls.
   */
  rowSelected?: boolean;
  /** The cell's value editor keeps its own button at the cell's end. */
  besideEditButton?: boolean;
}) {
  const t = useT();
  const { session } = useSession();
  const openComments = useContext(DatabaseItemCommentsContext);
  const [card, setCard] = useState<CellCommentCard | null>(null);
  const cardKeyRef = useRef(0);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const controlsRef = useRef<HTMLSpanElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  // Set while the card holds unsent text, so a stray click or Escape keeps it.
  const keepOpenRef = useRef(false);
  // Set when focus belongs elsewhere once the card closes: wherever the user
  // clicked, or the row's peek, which closes if focus returns to the table.
  const skipFocusReturnRef = useRef(false);
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    if (!layer || typeof ResizeObserver === "undefined") return;
    const measure = () =>
      setOverflowing(layer.scrollHeight > layer.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(layer);
    for (const child of layer.children) observer.observe(child);
    measure();
    return () => observer.disconnect();
  }, [layer, card?.key]);

  if (!openComments) return null;
  const { canComment, canResolve } = databaseItemCommentAccess(item);
  const propertyId = property.definition.id;
  const name = property.definition.name;
  const summary = item.comments?.properties[propertyId];
  if (!summary && !canComment && !card) return null;

  const open = (mode: CellCommentCard["mode"], opener: HTMLButtonElement) => {
    // A card holding unsent text stays as it is.
    if (keepOpenRef.current) return;
    if (card?.mode === mode) {
      close();
      return;
    }
    openerRef.current = opener;
    skipFocusReturnRef.current = false;
    setCard({ mode, key: ++cardKeyRef.current });
  };
  const close = () => setCard(null);
  // Once its last thread is resolved, the marker that opened the card goes
  // away, so focus returns to the cell's Comment button instead.
  const settle = () => {
    if (startRef.current) openerRef.current = startRef.current;
    close();
  };
  const startLabel = t("comments.commentOnProperty", { name });
  const markerLabel = summary
    ? t("comments.openPropertyComments", { count: summary.open, name })
    : "";

  return (
    <PopoverPrimitive.Root
      open={!!card}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <PopoverPrimitive.Anchor asChild>
        <span
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
        />
      </PopoverPrimitive.Anchor>
      <span
        ref={controlsRef}
        className="relative ms-auto flex min-h-6 shrink-0 items-center"
      >
        {canComment ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                ref={startRef}
                type="button"
                className={cn(
                  "pointer-events-none absolute end-full top-0 flex size-6 items-center justify-center rounded bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-focus-within/cell:pointer-events-auto group-focus-within/cell:opacity-100 group-hover/cell:pointer-events-auto group-hover/cell:opacity-100 [@media(any-hover:none)]:hidden",
                  besideEditButton ? "me-6" : "me-0.5",
                  card?.mode === "start" && "pointer-events-auto opacity-100",
                  rowSelected &&
                    "[@media(any-hover:none)]:pointer-events-auto [@media(any-hover:none)]:flex [@media(any-hover:none)]:opacity-100",
                )}
                aria-label={startLabel}
                aria-haspopup="dialog"
                aria-expanded={card?.mode === "start"}
                data-database-cell-comment-start
                onClick={(event) => {
                  event.stopPropagation();
                  // A card is cramped under a phone's keyboard, so touch
                  // screens write the comment in the row's peek.
                  if (deviceCannotHover()) {
                    openComments(item, null, propertyId);
                    return;
                  }
                  open("start", event.currentTarget);
                }}
              >
                <IconMessagePlus className="size-3.5" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{startLabel}</TooltipContent>
          </Tooltip>
        ) : null}
        {summary ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={databaseCommentMarkerClassName}
                aria-label={markerLabel}
                aria-haspopup="dialog"
                aria-expanded={card?.mode === "read"}
                data-database-cell-comments={summary.open}
                onClick={(event) => {
                  event.stopPropagation();
                  open("read", event.currentTarget);
                }}
              >
                <IconMessage className="size-3.5" aria-hidden="true" />
                {summary.open > 1 ? summary.open : null}
              </button>
            </TooltipTrigger>
            <TooltipContent>{markerLabel}</TooltipContent>
          </Tooltip>
        ) : null}
      </span>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={setLayer}
          align="end"
          sideOffset={4}
          collisionPadding={12}
          className="database-cell-comment-card"
          data-database-cell-comment-card={card?.mode}
          data-overflowing={overflowing ? "" : undefined}
          onOpenAutoFocus={(event) => {
            if (card?.mode !== "start") return;
            // The composer takes focus once it mounts, but only from the page.
            event.preventDefault();
            if (globalThis.document.activeElement instanceof HTMLElement) {
              globalThis.document.activeElement.blur();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = openerRef.current;
            if (!skipFocusReturnRef.current && opener?.isConnected) {
              opener.focus({ preventScroll: true });
            }
          }}
          onEscapeKeyDown={(event) => {
            // A composer's Escape closes its menus or cancels an empty draft.
            if (keepOpenRef.current || isEditableTarget(event.target)) {
              event.preventDefault();
            }
          }}
          onInteractOutside={(event) => {
            // The cell's own buttons switch or close the card when clicked.
            if (
              keepOpenRef.current ||
              (event.target instanceof Node &&
                controlsRef.current?.contains(event.target))
            ) {
              event.preventDefault();
            } else {
              skipFocusReturnRef.current = true;
            }
          }}
        >
          {card ? (
            <CommentDraftProvider
              documentId={item.document.id}
              currentUserEmail={session?.email}
              currentUserOrgId={session?.orgId}
            >
              <DatabaseCellCommentCard
                key={card.key}
                item={item}
                property={property}
                mode={card.mode}
                canComment={canComment}
                canResolve={canResolve}
                currentUserEmail={session?.email ?? undefined}
                currentUserOrgId={session?.orgId ?? undefined}
                keepOpenRef={keepOpenRef}
                onClose={close}
                onSettled={settle}
                onOpenRow={(threadId) => {
                  // The peek returns focus to the cell when it closes.
                  skipFocusReturnRef.current = true;
                  openerRef.current?.focus({ preventScroll: true });
                  close();
                  openComments(item, threadId);
                }}
              />
            </CommentDraftProvider>
          ) : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function DatabaseCellCommentCard({
  item,
  property,
  mode,
  canComment,
  canResolve,
  currentUserEmail,
  currentUserOrgId,
  keepOpenRef,
  onClose,
  onSettled,
  onOpenRow,
}: {
  item: ContentDatabaseItem;
  property: DocumentProperty;
  mode: CellCommentCard["mode"];
  canComment: boolean;
  canResolve: boolean;
  currentUserEmail?: string;
  currentUserOrgId?: string;
  keepOpenRef: MutableRefObject<boolean>;
  onClose: () => void;
  onSettled: () => void;
  onOpenRow: (threadId: string) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const documentId = item.document.id;
  const propertyId = property.definition.id;
  const { data: threads, isLoading, refetch } = useComments(documentId);
  // The marker can be newer than this row's cached threads, so a card opened
  // from it reads the threads again before deciding the cell has none.
  const [listedSinceOpen, setListedSinceOpen] = useState(mode === "start");
  const replyDrafts = useCommentReplyDrafts(documentId, currentUserEmail);
  const {
    pendingComment,
    setPendingComment,
    changePendingComment,
    completePendingComment,
  } = usePendingCommentDraft(documentId);
  // After posting, the card shows the new thread rather than every thread.
  const [postedThreadId, setPostedThreadId] = useState<string | null>(null);

  useEffect(() => {
    if (mode === "read") {
      const marked = item.comments?.properties[propertyId]?.open ?? 0;
      void refetch()
        .then(({ data }) => {
          const open = data?.filter(
            (thread) =>
              thread.property?.propertyId === propertyId && !thread.resolved,
          ).length;
          // A marker that no longer matches refreshes the row's counts.
          if (open !== undefined && open !== marked) {
            void queryClient.invalidateQueries({
              ...collectionRowsShowingDocumentFilter(documentId),
              refetchType: "active",
            });
          }
        })
        .finally(() => setListedSinceOpen(true));
      return;
    }
    setPendingComment({
      quotedText: "",
      offsetTop: 0,
      property: commentPropertyTarget(property),
      databaseId: item.databaseId,
    });
    // Runs once per card; the card remounts each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const propertyThreads = useMemo(
    () =>
      threads?.filter((thread) => thread.property?.propertyId === propertyId) ??
      NO_THREADS,
    [threads, propertyId],
  );
  const openThreads = propertyThreads.filter(
    (thread) =>
      !thread.resolved &&
      (!postedThreadId || thread.threadId === postedThreadId),
  );
  const postedThread = postedThreadId
    ? propertyThreads.find((thread) => thread.threadId === postedThreadId)
    : undefined;
  // Resolving the last thread, or the one just posted, closes the card, as
  // does a read that found none or failed.
  const settled =
    !pendingComment &&
    (postedThreadId
      ? postedThread?.resolved === true
      : mode === "read" && listedSinceOpen && openThreads.length === 0);
  useEffect(() => {
    if (settled) onSettled();
  }, [settled, onSettled]);

  const openReplyThreadId = replyDrafts.openReply?.threadId ?? null;
  // Text still being written or sent; a failed send puts it back.
  const unsent =
    !!pendingComment?.submitting ||
    !!pendingComment?.text.trim() ||
    (!!openReplyThreadId && !!replyDrafts.get(openReplyThreadId).text.trim()) ||
    propertyThreads.some((thread) => replyDrafts.isSubmitting(thread.threadId));
  useEffect(() => {
    keepOpenRef.current = unsent;
    return () => {
      keepOpenRef.current = false;
    };
  }, [keepOpenRef, unsent]);

  return (
    <CommentsSidebar
      compact
      surface="popover"
      presentation="inline"
      alignToAnchors={false}
      forceVisible
      replyDrafts={replyDrafts}
      documentId={documentId}
      // While composing, the card shows only the new comment.
      threads={pendingComment ? NO_THREADS : propertyThreads}
      visibleThreadId={postedThreadId}
      documentProperties={item.properties}
      isLoading={
        !pendingComment &&
        (isLoading || (!listedSinceOpen && openThreads.length === 0))
      }
      pendingComment={pendingComment}
      onPendingChange={changePendingComment}
      onPendingDone={(id, threadId) => {
        if (!completePendingComment(id)) return;
        if (threadId) setPostedThreadId(threadId);
        else onClose();
      }}
      currentUserEmail={currentUserEmail}
      currentUserOrgId={currentUserOrgId}
      canComment={canComment}
      canResolve={canResolve}
      onClose={onClose}
      renderThreadActions={(thread) =>
        thread.threadId.startsWith("optimistic-") ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <CommentIconButton
                aria-label={t("comments.openRow")}
                data-database-cell-comment-open-row
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenRow(thread.threadId);
                }}
              >
                <IconLayoutSidebarRight size={18} />
              </CommentIconButton>
            </TooltipTrigger>
            <TooltipContent>{t("comments.openRow")}</TooltipContent>
          </Tooltip>
        )
      }
    />
  );
}
