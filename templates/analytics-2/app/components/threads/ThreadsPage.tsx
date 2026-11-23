import {
  notifyChatThreadsUpdated,
  useChatThreadList,
} from "@agent-native/core/client/agent-chat";
import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import {
  formatLocaleDate,
  useReaderLocale,
} from "@agent-native/toolkit/app/shared/reader-locale";
import { Badge } from "@agent-native/toolkit/ui/badge";
import {
  IconAlertCircle,
  IconDots,
  IconMessageCircle,
  IconPlus,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import { Avatar } from "@/components/shell/primitives";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { workspaceChatScope } from "@/lib/workspace-chat-scope";

import { useThreadCreators } from "./use-thread-creators";

const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,22.5rem)_10rem_minmax(10rem,1fr)] items-center gap-4";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function formatThreadUpdated(
  updatedAt: number,
  now: number,
  locale: string,
  t: ReturnType<typeof useT>,
) {
  const parsed = updatedAt;
  const diff = Math.abs(now - parsed);
  if (diff >= WEEK_MS) {
    return formatLocaleDate(parsed, locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  const seconds = Math.round(diff / 1000);
  const minutes = Math.round(diff / MINUTE_MS);
  const hours = Math.round(diff / HOUR_MS);
  const days = Math.round(diff / DAY_MS);
  const unit = (count: number, one: string, many: string) =>
    t(`analytics.searchResultDates.${count === 1 ? one : many}`, { count });
  const span =
    seconds < 45
      ? unit(Math.max(seconds, 1), "second", "seconds")
      : seconds < 90
        ? unit(1, "minute", "minutes")
        : minutes < 45
          ? unit(minutes, "minute", "minutes")
          : minutes < 90
            ? unit(1, "hour", "hours")
            : hours < 22
              ? unit(hours, "hour", "hours")
              : hours < 36
                ? unit(1, "day", "days")
                : unit(days, "day", "days");
  return t(`analytics.searchResultDates.${now < parsed ? "future" : "past"}`, {
    value: span,
  });
}

/**
 * The workspace's agent threads.
 *
 * The source lists one row per thread (title, updated) and, with nothing yet,
 * an empty state with an icon, "No threads yet" and a line telling the reader
 * what the list is for. Edits to one conversation never add a second row, so the
 * history hook collapses edit rows for this list.
 */
export function ThreadsPage() {
  const t = useT();
  const locale = useReaderLocale();
  const navigate = useNavigate();
  const org = useOrg();
  const orgId = org.data?.orgId ?? undefined;
  const threads = useChatThreadList({
    ownership: "mine",
    collapseEdits: true,
    enabled: Boolean(orgId),
    ...(orgId ? { scope: workspaceChatScope(orgId) } : {}),
  });
  const deleteThreadAction = useActionMutation("delete-thread");
  const renameThreadAction = useActionMutation("rename-thread");
  const actionButtons = useRef(new Map<string, HTMLButtonElement>());
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const [renaming, setRenaming] = useState<
    (typeof threads.threads)[number] | null
  >(null);
  const [title, setTitle] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renamePending, setRenamePending] = useState(false);
  const saveRename = async () => {
    if (
      !renaming ||
      !title.trim() ||
      title.trim() === renaming.title.trim() ||
      renamePending
    )
      return;
    setRenamePending(true);
    setRenameError(null);
    try {
      await renameThreadAction.mutateAsync({ threadId: renaming.id, title });
      notifyChatThreadsUpdated();
      await threads.refresh();
      setRenaming(null);
    } catch (error) {
      setRenameError(
        actionErrorMessage(error) ?? t("analytics.lists.renameThreadFailed"),
      );
    } finally {
      setRenamePending(false);
    }
  };

  // The server groups revisions by their trusted edit lineage before paging.
  // Also discard repeated ids if a page overlaps a concurrent list refresh.
  const seen = new Set<string>();
  // Deleting a thread notifies the chat history and refreshes the list after the
  // action confirms the write.
  const [deleting, setDeleting] = useState<
    (typeof threads.threads)[number] | null
  >(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteThread = async (id: string) => {
    if (deletePending) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await deleteThreadAction.mutateAsync({ threadId: id });
      notifyChatThreadsUpdated();
      await threads.refresh();
      setDeleting(null);
    } catch (error) {
      setDeleteError(
        actionErrorMessage(error) ?? t("analytics.lists.deleteThreadFailed"),
      );
    } finally {
      setDeletePending(false);
    }
  };

  const rows = threads.threads
    .filter((thread) => !thread.archivedAt)
    .filter((thread) => {
      if (seen.has(thread.id)) return false;
      seen.add(thread.id);
      return true;
    });

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const ownerEmails = [
    ...new Set(rows.map((thread) => thread.ownerEmail.toLowerCase())),
  ];
  const creatorsQuery = useThreadCreators(ownerEmails);
  const now = Date.now();
  const rowIdsKey = rows.map((thread) => thread.id).join("\0");

  useEffect(() => {
    const valid = new Set(rows.map((thread) => thread.id));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [rowIdsKey]);

  const visibleSelectedCount = rows.reduce(
    (count, thread) => count + (selectedIds.has(thread.id) ? 1 : 0),
    0,
  );
  const allSelected = rows.length > 0 && visibleSelectedCount === rows.length;
  const headerChecked: boolean | "indeterminate" = allSelected
    ? true
    : visibleSelectedCount > 0
      ? "indeterminate"
      : false;

  const toggleAll = (checked: boolean) => {
    setSelectedIds(
      checked ? new Set(rows.map((thread) => thread.id)) : new Set(),
    );
  };

  const toggleRow = (threadId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(threadId);
      else next.delete(threadId);
      return next;
    });
  };

  const orgLoading = !orgId && org.isPending;
  const loadError = org.isError || Boolean(threads.error);
  const retryLoad = () => {
    if (org.isError) void org.refetch();
    else void threads.refresh();
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <IconMessageCircle aria-hidden="true" size={20} stroke={1.8} />
          <h1 className="text-lg font-semibold text-foreground">
            {t("analytics.lists.threads")}
          </h1>
        </div>
        {/* /ask is not a route in this app, so the click fell through the catch-all
            to Home instead of starting a thread (tester rows 175/182). The thread
            route owns the composer. */}
        <Button onClick={() => navigate("/thread")} size="sm">
          <IconPlus aria-hidden="true" size={16} stroke={1.8} />
          {t("analytics.lists.createThread")}
        </Button>
      </header>

      {loadError ? (
        <div
          className="flex flex-wrap items-center gap-3 py-6 text-sm text-destructive"
          role="alert"
        >
          <span>{t("analytics.lists.threadsLoadFailedDetail")}</span>
          <Button type="button" size="sm" variant="outline" onClick={retryLoad}>
            {t("error.retry")}
          </Button>
        </div>
      ) : orgLoading || threads.loading ? (
        <p className="py-6 text-sm text-muted-foreground" role="status">
          {t("analytics.lists.loadingThreads")}
        </p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card px-6 py-12 text-center">
          <IconMessageCircle
            aria-hidden="true"
            className="text-muted-foreground"
            size={28}
            stroke={1.6}
          />
          <p className="text-sm font-medium text-foreground">
            {t("analytics.lists.threadsEmpty")}
          </p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {t("analytics.lists.threadsEmptyHint")}
          </p>
          <Button
            onClick={() => navigate("/thread")}
            size="sm"
            variant="outline"
          >
            {t("analytics.lists.startThread")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visibleSelectedCount > 0 ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs">
              <span className="font-medium text-foreground">
                {t("analytics.lists.selectedCount", {
                  count: visibleSelectedCount,
                })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setSelectedIds(new Set())}
              >
                {t("analytics.lists.deselectAll")}
              </Button>
            </div>
          ) : null}
          <div
            aria-label={t("analytics.lists.threads")}
            className="rounded-lg border border-border bg-card"
            role="table"
          >
            <div
              className={`${ROW_GRID} border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground`}
              role="row"
            >
              <div className="flex items-center gap-2" role="columnheader">
                <Checkbox
                  aria-label={t("analytics.lists.selectAllRows")}
                  checked={headerChecked}
                  onCheckedChange={(checked) => toggleAll(checked === true)}
                />
                <span>{t("analytics.lists.itemName")}</span>
              </div>
              <div role="columnheader">{t("analytics.lists.lastUpdated")}</div>
              <div className="hidden sm:block" role="columnheader">
                {t("analytics.lists.creator")}
              </div>
            </div>
            {creatorsQuery.error ? (
              <p className="px-4 py-2 text-xs text-destructive" role="alert">
                {t("analytics.organizationCatalog.loadError")}
              </p>
            ) : null}
            {rows.map((thread) => {
              const label = thread.title.trim() || "Untitled thread";
              const isSelected = selectedIds.has(thread.id);
              const creator = creatorsQuery.creators.get(
                thread.ownerEmail.toLowerCase(),
              );
              return (
                <div
                  className={`${ROW_GRID} group/row relative border-b border-border px-4 py-3 last:border-b-0 hover:bg-accent/40`}
                  key={thread.id}
                  role="row"
                >
                  <div className="flex min-w-0 items-center gap-2" role="cell">
                    <span
                      className="relative z-10 inline-flex shrink-0 items-center"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Checkbox
                        aria-label={t("analytics.lists.selectRow", {
                          title: label,
                        })}
                        checked={isSelected}
                        onCheckedChange={(checked) =>
                          toggleRow(thread.id, checked === true)
                        }
                      />
                    </span>
                    <IconMessageCircle
                      aria-hidden="true"
                      className="shrink-0 text-muted-foreground"
                      size={16}
                      stroke={1.75}
                    />
                    <Link
                      className="truncate text-sm text-foreground after:absolute after:inset-0"
                      to={`/thread/${encodeURIComponent(thread.id)}`}
                    >
                      {label}
                    </Link>
                    {thread.accessBasis === "owner" ? null : (
                      <Badge variant="secondary">Shared</Badge>
                    )}
                    {thread.accessBasis === "owner" ? (
                      <div className="relative z-10 ml-auto shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100 has-[[data-state=open]]:opacity-100 [@media(hover:none)]:opacity-100">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              ref={(button) => {
                                if (button)
                                  actionButtons.current.set(thread.id, button);
                                else actionButtons.current.delete(thread.id);
                              }}
                              aria-label={`Actions for ${label}`}
                              className="size-6 [&_svg]:size-4"
                              size="icon-sm"
                              variant="ghost"
                            >
                              <IconDots
                                size={16}
                                stroke={1.8}
                                aria-hidden="true"
                              />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => {
                                returnFocus.current =
                                  actionButtons.current.get(thread.id) ?? null;
                                setTitle(thread.title);
                                setRenameError(null);
                                setRenaming(thread);
                              }}
                            >
                              <IconPencil
                                size={16}
                                stroke={1.8}
                                aria-hidden="true"
                              />
                              {t("analytics.lists.actionRename")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onSelect={() => {
                                setDeleteError(null);
                                setDeleting(thread);
                              }}
                            >
                              <IconTrash
                                size={16}
                                stroke={1.8}
                                aria-hidden="true"
                              />
                              {t("analytics.lists.deleteThreadConfirm")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ) : null}
                  </div>
                  <div
                    className="truncate text-xs text-muted-foreground"
                    role="cell"
                    title={new Date(thread.updatedAt).toLocaleString(locale)}
                  >
                    {formatThreadUpdated(thread.updatedAt, now, locale, t)}
                  </div>
                  <div
                    className="hidden min-w-0 items-center gap-2 text-xs text-muted-foreground sm:flex"
                    role="cell"
                  >
                    {creatorsQuery.isLoading ? (
                      <Skeleton className="h-4 w-24" />
                    ) : creator ? (
                      <>
                        <Avatar
                          avatarUrl={creator.imageUrl ?? undefined}
                          email={creator.email}
                          name={creator.name ?? ""}
                        />
                        <span className="truncate">
                          {creator.name ?? creator.email}
                        </span>
                      </>
                    ) : creatorsQuery.error ? (
                      <IconAlertCircle
                        aria-hidden="true"
                        className="text-destructive"
                        size={16}
                      />
                    ) : (
                      <span className="truncate">
                        {t("analytics.lists.workspaceUser")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open && !renamePending) setRenaming(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            if (returnFocus.current?.isConnected) {
              event.preventDefault();
              returnFocus.current.focus();
            }
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveRename();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {t("analytics.lists.renameThreadTitle")}
              </DialogTitle>
            </DialogHeader>
            <Input
              aria-label={t("analytics.lists.threadTitle")}
              placeholder={t("analytics.lists.threadTitle")}
              maxLength={500}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
            />
            {renameError ? (
              <p role="alert" className="text-sm text-destructive">
                {renameError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={renamePending}
                onClick={() => setRenaming(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={
                  renamePending ||
                  !title.trim() ||
                  title.trim() === renaming?.title.trim()
                }
              >
                {t("analytics.lists.actionRename")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deletePending) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("analytics.lists.deleteThreadTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("analytics.lists.deleteThreadDescription")}
            </AlertDialogDescription>
            {deleteError ? (
              <p className="text-sm text-destructive" role="alert">
                {deleteError}
              </p>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletePending}
              onClick={(event) => {
                event.preventDefault();
                if (deleting) void deleteThread(deleting.id);
              }}
            >
              {t("analytics.lists.deleteThreadConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {threads.hasMore ? (
        <Button
          disabled={threads.loadingMore}
          onClick={() => void threads.loadMore()}
          size="sm"
          variant="ghost"
        >
          {threads.loadingMore ? (
            <Skeleton className="h-4 w-16" />
          ) : (
            "Load more"
          )}
        </Button>
      ) : null}
    </main>
  );
}
