import { notifyChatThreadsUpdated } from "@agent-native/core/client/agent-chat";
import {
  actionErrorCode,
  actionErrorMessage,
  callAction,
  useActionMutation,
  useActionQuery,
  writeClientAppState,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import { useSession } from "@agent-native/core/client/use-session";
import { useDocumentTitle } from "@agent-native/toolkit/app/shared";
import { IconDots, IconTrash } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import type { z } from "zod";

import { WorkspaceAgent } from "@/components/agent";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TAB_ID } from "@/lib/tab-id";
import type { ResolvedRoute } from "@/routes/routing/registry";

import type getThreadSummary from "../../../actions/get-thread-summary";
import type { stopThreadReceipt } from "../../../shared/analytics-thread";
import { AskThreadHeader, SharedAskThread } from "./AskThreadContents";
import { ThreadPageSkeleton } from "./ThreadPageSkeleton";
import { useWorkspaceData } from "./WorkspaceDataContext";

/**
 * Thread route page: the core agent chat surface in page mode scoped to this
 * app/workspace. The adapter owns thread URL sync and scope checks.
 */
export function ThreadPage({ route }: { route: ResolvedRoute }) {
  const identity = useWorkspaceData()?.shell;
  const { session, isLoading: sessionLoading } = useSession();
  const currentOrg = useOrg();
  const orgId =
    identity &&
    !sessionLoading &&
    session?.email &&
    identity.user.email.toLowerCase() === session.email.toLowerCase() &&
    !currentOrg.isPending &&
    !currentOrg.isError &&
    currentOrg.data.orgId === identity.workspace.id
      ? identity.workspace.id
      : undefined;
  const threadId = route.params.threadId ?? null;
  const t = useT();
  useDocumentTitle([t("analytics.brand")], undefined, !orgId);
  if (sessionLoading || currentOrg.isPending) return <ThreadPageSkeleton />;
  if (currentOrg.isError)
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-destructive" role="alert">
          {t("analytics.ask.threadLoadError")}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() => void currentOrg.refetch()}
          >
            {t("analytics.ask.threadRetry")}
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/home/threads">
              {t("analytics.ask.threadBackToThreads")}
            </Link>
          </Button>
        </div>
      </div>
    );
  if (!orgId || !session?.email) return null;
  const email = session.email.toLowerCase();
  return (
    <VerifiedThreadPage
      key={JSON.stringify([orgId, email, threadId])}
      orgId={orgId}
      email={email}
      threadId={threadId}
    />
  );
}

function VerifiedThreadPage({
  orgId,
  email,
  threadId,
}: {
  orgId: string;
  email: string;
  threadId: string | null;
}) {
  const t = useT();
  const navigate = useNavigate();
  const deleteThreadAction = useActionMutation("delete-thread");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const summary = useActionQuery<
    Awaited<ReturnType<typeof getThreadSummary.run>>
  >(
    "get-thread-summary",
    { threadId: threadId ?? "" },
    {
      enabled: Boolean(threadId),
      queryKeyScope: [orgId, email],
    },
  );
  const refetchSummary = summary.refetch;
  useEffect(() => {
    if (!threadId) return;
    const refresh = () => {
      void refetchSummary();
    };
    window.addEventListener("agent-chat:threads-updated", refresh);
    return () =>
      window.removeEventListener("agent-chat:threads-updated", refresh);
  }, [threadId, refetchSummary]);
  const threadSummary =
    summary.data?.thread?.id === threadId ? summary.data : undefined;
  const summaryError = threadSummary ? null : summary.error;
  const thread = threadSummary?.thread;
  const canDelete = thread?.owned === true;
  const binding = threadSummary?.binding ?? null;
  const rawTitle = thread?.title.trim();
  const title =
    rawTitle ||
    t(binding ? "analytics.ask.threadTitle" : "analytics.lists.untitledThread");
  const headerTitle =
    rawTitle ||
    t(
      binding || !threadId
        ? "analytics.ask.threadTitle"
        : "analytics.lists.untitledThread",
    );
  const showAskHeader =
    !summaryError &&
    !(threadId && !thread) &&
    threadSummary?.canSubmit !== false;
  const deleteMenu = canDelete ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("analytics.lists.actionsFor", { name: title })}
          disabled={deleting}
          size="icon-sm"
          variant="ghost"
        >
          <IconDots aria-hidden="true" size={16} stroke={1.8} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="text-destructive"
          onSelect={() => {
            setDeleteError(null);
            setDeleteOpen(true);
          }}
        >
          <IconTrash aria-hidden="true" size={16} stroke={1.8} />
          {t("analytics.lists.deleteThread")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;
  useDocumentTitle([thread ? title : t("analytics.brand")], undefined);
  useEffect(() => {
    if (!binding) return;
    const key = `analytics-thread:${TAB_ID}`;
    void writeClientAppState(
      key,
      {
        threadId: binding.threadId,
        projectId: binding.projectId,
        view: "agent",
      },
      { requestSource: TAB_ID },
    ).catch((error: unknown) =>
      console.warn("[analytics] Could not sync the Ask route", error),
    );
  }, [binding]);

  const stopAsk = async () => {
    if (!binding) return true;
    const latest = await refetchSummary();
    if (latest.error) throw latest.error;
    const throughSequence = latest.data?.throughSequence;
    if (!throughSequence) return true;
    const result = await callAction<z.infer<typeof stopThreadReceipt>>(
      "stop-analytics-thread",
      {
        threadId: binding.threadId,
        opId: crypto.randomUUID(),
        throughSequence,
      },
    );
    if (result.outcome === "stopped") toast.success(t("analytics.ask.stopped"));
    return false;
  };

  const deleteThread = async () => {
    if (!threadId || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteThreadAction.mutateAsync({ threadId });
      notifyChatThreadsUpdated();
      if (mounted.current) void navigate("/home/threads");
    } catch (error) {
      if (mounted.current)
        setDeleteError(
          actionErrorMessage(error) ?? t("analytics.lists.deleteThreadFailed"),
        );
    } finally {
      if (mounted.current) setDeleting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {summaryError ? (
        <div className="flex flex-col items-start gap-3 p-6">
          <p className="text-sm text-destructive" role="alert">
            {["not_found", "thread_not_found"].includes(
              actionErrorCode(summaryError) ?? "",
            )
              ? t("analytics.ask.threadNotFound")
              : actionErrorCode(summaryError) === "thread_forbidden"
                ? t("analytics.ask.threadForbidden")
                : (actionErrorMessage(summaryError) ??
                  t("analytics.ask.threadLoadError"))}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void refetchSummary()}
            >
              {t("analytics.ask.threadRetry")}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => void navigate("/home/threads")}
            >
              {t("analytics.ask.threadBackToThreads")}
            </Button>
          </div>
        </div>
      ) : null}
      {showAskHeader ? (
        <AskThreadHeader
          binding={binding}
          threadId={threadId}
          threadTitle={rawTitle}
          title={headerTitle}
          listed={threadSummary?.listed ?? true}
          workingHead={threadSummary?.workingHead ?? null}
          canShare={threadSummary?.canShare ?? false}
          canSubmit={threadSummary?.canSubmit ?? true}
          identity={email}
          refetch={refetchSummary}
          trailingActions={deleteMenu}
        />
      ) : canDelete ? (
        <div className="flex shrink-0 justify-end px-2 pt-2">{deleteMenu}</div>
      ) : null}
      <div className="min-h-0 flex-1">
        {binding && !summary.data?.canSubmit ? (
          <SharedAskThread
            threadId={binding.threadId}
            identity={email}
            title={title}
          />
        ) : !summaryError ? (
          <WorkspaceAgent
            mode="thread"
            orgId={orgId}
            threadId={threadId}
            askBinding={binding}
            onStopAsk={stopAsk}
          />
        ) : null}
      </div>
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!deleting) setDeleteOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("analytics.lists.deleteThreadTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("analytics.lists.deleteThreadDescription", { name: title })}
            </AlertDialogDescription>
            {deleteError ? (
              <p className="text-sm text-destructive" role="alert">
                {deleteError}
              </p>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void deleteThread();
              }}
            >
              {t("analytics.lists.deleteThreadConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
