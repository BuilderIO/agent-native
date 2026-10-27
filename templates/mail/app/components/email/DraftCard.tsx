import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { updateMcpAppModelContext } from "@agent-native/core/client/mcp-app-host";
import type { ComposeState, EmailMessage } from "@shared/types";
import {
  IconAlertCircle,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCheck,
  IconClock,
  IconLoader2,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import type { ReactNode, RefObject } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountFilterContext } from "@/hooks/use-account-filter";
import {
  DRAFT_DELETE_FAILED_EVENT,
  DRAFT_SAVE_FAILED_EVENT,
  useComposeState,
} from "@/hooks/use-compose-state";
import { useEmail, useThreadMessages } from "@/hooks/use-emails";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";
import { ensureThread } from "@/lib/thread-cache";
import { cn } from "@/lib/utils";

import { ComposeModal, type ComposeSendProgress } from "./ComposeModal";
import { CollapsedMessageRow, ExpandedMessageCard } from "./EmailThread";

// Older messages past this many fold into one row until the reader opens them.
const VISIBLE_THREAD_TAIL = 3;
// How much of the newest message stays in view when the thread opens.
const LATEST_MESSAGE_MIN_VISIBLE = 120;

type CardOutcome =
  | { status: "queued"; undo: () => void }
  | { status: "sending" }
  | { status: "sent" }
  | { status: "scheduled"; runAt: number }
  // Shown at once; the model hears about it only once the delete has stuck.
  | { status: "deleted"; confirmed: boolean };

type MailAccount = { email: string; displayName?: string; photoUrl?: string };

const noop = () => {};

/**
 * One draft as a chat-sized card: the conversation it answers, then the
 * editable draft with Send. Outside agents embed it from manage-draft.
 */
export function DraftCard({ draftId }: { draftId: string }) {
  const t = useT();
  const compose = useComposeState();
  const googleStatus = useGoogleAuthStatus();
  const googleAccounts = googleStatus.data?.accounts;
  const accounts = useMemo<MailAccount[]>(
    () => googleAccounts ?? [],
    [googleAccounts],
  );
  // The card renders outside AppLayout, which provides the accounts for the
  // From picker everywhere else.
  const accountFilter = useMemo(
    () => ({
      activeAccounts: new Set(accounts.map((account) => account.email)),
      allAccounts: accounts,
    }),
    [accounts],
  );

  // A draft leaves compose.drafts while it is staged to send, so the card keeps
  // the last one it showed for the header and thread.
  const draft = compose.drafts.find((d) => d.id === draftId) ?? null;
  const lastDraftRef = useRef<ComposeState | null>(null);
  if (draft) lastDraftRef.current = draft;
  const shownDraft = draft ?? lastDraftRef.current;

  const [outcome, setOutcome] = useState<CardOutcome | null>(null);
  const outcomeRef = useRef<CardOutcome | null>(null);
  const [sendFailed, setSendFailed] = useState(false);
  const settle = useCallback((next: CardOutcome | null) => {
    outcomeRef.current = next;
    setOutcome(next);
  }, []);

  const handleSendProgress = useCallback(
    (progress: ComposeSendProgress) => {
      if (progress.status === "failed") {
        setSendFailed(true);
        settle(null);
        return;
      }
      setSendFailed(false);
      if (progress.status === "queued") {
        settle({
          status: "queued",
          undo: () => {
            if (outcomeRef.current?.status !== "queued") return;
            progress.undo();
            settle(null);
          },
        });
        return;
      }
      settle(progress);
    },
    [settle],
  );

  // The composer discards the draft after it sends or schedules it too; only a
  // discard with nothing in flight is the reader deleting it.
  const { discard } = compose;
  const [deleteFailed, setDeleteFailed] = useState(false);
  const handleDiscard = useCallback(
    (id: string) => {
      const deleted = discard(id);
      if (outcomeRef.current) return;
      settle({ status: "deleted", confirmed: false });
      void deleted.then((ok) => {
        if (outcomeRef.current?.status !== "deleted") return;
        if (ok) {
          settle({ status: "deleted", confirmed: true });
        } else {
          settle(null);
          setDeleteFailed(true);
        }
      });
    },
    [discard, settle],
  );

  useReportOutcomeToModel(draftId, outcome);
  useDraftFailureToasts(draftId, outcomeRef);

  const thread = useDraftThread(shownDraft, accounts);
  const cardDraft = useMemo(
    () =>
      draft && thread.resolvedThreadId && !draft.replyToThreadId
        ? { ...draft, replyToThreadId: thread.resolvedThreadId }
        : draft,
    [draft, thread.resolvedThreadId],
  );

  let body: ReactNode;
  if (!shownDraft && compose.isLoading) {
    body = <DraftCardSkeleton />;
  } else if (!shownDraft && compose.isError) {
    body = (
      <CardNotice
        icon={<IconAlertCircle className="size-5 text-destructive" />}
        title={t("mail.draftCard.loadFailed")}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void compose.refetch()}
          >
            {t("mail.error.tryAgain")}
          </Button>
        }
      />
    );
  } else if (deleteFailed && !draft) {
    body = (
      <CardNotice
        icon={<IconAlertCircle className="size-5 text-destructive" />}
        title={t("mail.toasts.failedToDeleteDraft")}
      />
    );
  } else if (!shownDraft || (!draft && !outcome)) {
    body = (
      <CardNotice
        icon={<IconTrash className="size-5 text-muted-foreground" />}
        title={t("mail.draftCard.notFoundTitle")}
      />
    );
  } else {
    body = (
      <>
        <DraftCardHeader draft={shownDraft} subject={thread.subject} />
        {thread.wanted && (
          <DraftThreadSection
            messages={thread.messages}
            loading={thread.loading}
            unavailable={thread.unavailable}
            compact={!outcome}
          />
        )}
        <div
          className={cn(
            "flex flex-col gap-2 p-2",
            outcome && thread.wanted ? "shrink-0" : "min-h-[220px] flex-1",
          )}
        >
          {sendFailed && draft && (
            <div
              role="alert"
              className="flex shrink-0 items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive"
            >
              <IconAlertCircle className="size-4 shrink-0" />
              {t("mail.toasts.failedToSendEmail")}
            </div>
          )}
          {thread.lookupFailed && draft && (
            <div
              role="alert"
              className="flex shrink-0 items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive"
            >
              <IconAlertCircle className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                {t("mail.draftCard.threadLookupFailed")}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void thread.retryLookup()}
              >
                {t("mail.error.tryAgain")}
              </Button>
            </div>
          )}
          {outcome && <OutcomePanel outcome={outcome} />}
          <ComposeModal
            presentation="card"
            drafts={cardDraft ? [cardDraft] : []}
            activeId={cardDraft ? cardDraft.id : null}
            activeDraft={cardDraft}
            onSetActiveId={noop}
            onUpdate={compose.update}
            onClose={noop}
            onCloseAll={noop}
            onDiscard={handleDiscard}
            onStageForSend={compose.stageForSend}
            onRestoreAfterSend={compose.restoreAfterSend}
            onNewDraft={noop}
            onFlush={compose.flush}
            onSendProgress={handleSendProgress}
            sendDisabled={thread.lookupPending}
          />
        </div>
      </>
    );
  }

  // An inline chat card's document is shorter than its frame (core clamps it),
  // so the card stops at the document's height.
  return (
    <AccountFilterContext.Provider value={accountFilter}>
      <div
        data-mail-draft-card
        className="flex h-dvh max-h-full w-full flex-col overflow-hidden bg-background text-foreground"
      >
        {body}
      </div>
    </AccountFilterContext.Provider>
  );
}

function DraftCardHeader({
  draft,
  subject,
}: {
  draft: ComposeState;
  subject?: string | undefined;
}) {
  const t = useT();
  const Icon =
    draft.mode === "reply"
      ? IconArrowBackUp
      : draft.mode === "forward"
        ? IconArrowForwardUp
        : IconPencil;
  const label =
    draft.mode === "reply"
      ? t("mail.compose.reply")
      : draft.mode === "forward"
        ? t("mail.compose.forward")
        : t("mail.compose.newMessage");
  const title = draft.mode === "compose" ? "" : draft.subject.trim() || subject;

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3">
      <Icon className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />
      <span className="shrink-0 text-[13px] font-semibold">{label}</span>
      {title && (
        <span
          data-an-mask
          className="min-w-0 truncate text-[13px] text-muted-foreground"
        >
          {title}
        </span>
      )}
    </header>
  );
}

function useDraftThread(draft: ComposeState | null, accounts: MailAccount[]) {
  const replyToId =
    draft && draft.mode !== "compose" ? draft.replyToId : undefined;
  // get-email needs the exact account; a mailbox without Google is "local".
  const onlyAccount = accounts.length === 1 ? accounts[0] : undefined;
  const accountEmail =
    draft?.accountEmail ??
    draft?.savedDraftAccountEmail ??
    (onlyAccount
      ? onlyAccount.email
      : accounts.length === 0
        ? "local"
        : undefined);
  const threadAccount = accountEmail === "local" ? undefined : accountEmail;
  const knownThreadId = draft?.replyToThreadId;
  // Agents often pass only the message they answer, so look up its thread.
  const lookupId = replyToId && !knownThreadId ? replyToId : undefined;
  const email = useEmail(lookupId, accountEmail);
  // Send waits for the lookup, and its first answer sticks, so a reply's
  // thread can't change while it's being scheduled. A failed lookup isn't an
  // answer: Send stays held until a retry finds the message.
  const lookupKey =
    lookupId && accountEmail ? `${accountEmail}\n${lookupId}` : null;
  const [settledLookup, setSettledLookup] = useState<{
    key: string;
    threadId?: string;
  } | null>(null);
  const lookup = settledLookup?.key === lookupKey ? settledLookup : null;
  if (lookupKey && !lookup && email.data) {
    setSettledLookup({ key: lookupKey, threadId: email.data.threadId });
  }
  const lookupPending = Boolean(lookupKey && !lookup);
  const lookupFailed = lookupPending && email.isError;
  const resolvedThreadId = replyToId
    ? (knownThreadId ?? lookup?.threadId)
    : undefined;
  // A thread often shares its first message's ID, which is worth trying for
  // the conversation when the lookup fails or can't run. The draft never gets
  // it, since a reply sent into the wrong thread is worse than one Gmail
  // threads itself.
  const threadId =
    resolvedThreadId ??
    (replyToId && (!lookupPending || lookupFailed) ? replyToId : undefined);

  // The thread cache reports no errors and refetches a failed thread on every
  // render, so the card catches the failure and stops asking.
  const [failedThreadId, setFailedThreadId] = useState<string | null>(null);
  const failed = threadId !== undefined && failedThreadId === threadId;
  const thread = useThreadMessages(
    failed ? undefined : threadId,
    threadAccount,
  );
  useEffect(() => {
    if (!threadId) return;
    let live = true;
    ensureThread(threadId, threadAccount).catch(() => {
      if (live) setFailedThreadId(threadId);
    });
    return () => {
      live = false;
    };
  }, [threadId, threadAccount]);

  const messages = useMemo(
    () => (thread.data ?? []).filter((message) => !message.isDraft),
    [thread.data],
  );
  const loading = !failed && (!threadId || (thread.isLoading && !thread.data));

  return {
    wanted: Boolean(replyToId),
    resolvedThreadId,
    lookupPending,
    lookupFailed,
    retryLookup: email.refetch,
    subject: messages[0]?.subject,
    messages,
    loading,
    unavailable: failed || (!loading && messages.length === 0),
  };
}

function DraftThreadSection({
  messages,
  loading,
  unavailable,
  compact,
}: {
  messages: EmailMessage[];
  loading: boolean;
  unavailable: boolean;
  compact: boolean;
}) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const latestRef = useRef<HTMLDivElement>(null);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const latestId = messages[messages.length - 1]?.id;

  // Keep the earlier rows in view when they fit, but always show the start of
  // the newest message, which is the one the draft answers.
  useLayoutEffect(() => {
    const box = scrollRef.current;
    const latest = latestRef.current;
    if (!box || !latest) return;
    const target =
      latest.offsetTop + LATEST_MESSAGE_MIN_VISIBLE - box.clientHeight;
    if (target <= 0) {
      box.scrollTop = 0;
      return;
    }
    // Start at a whole row rather than partway through one.
    const rows = Array.from(latest.parentElement?.children ?? []);
    const first = rows.find(
      (row): row is HTMLElement =>
        row instanceof HTMLElement && row.offsetTop >= target,
    );
    box.scrollTop = (first ?? latest).offsetTop;
  }, [latestId]);

  const toggle = (id: string) =>
    setToggled((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const folded = !showAll && messages.length > VISIBLE_THREAD_TAIL + 1;
  const hiddenCount = folded ? messages.length - VISIBLE_THREAD_TAIL : 0;
  const visible = folded ? messages.slice(hiddenCount) : messages;

  return (
    <div
      ref={scrollRef}
      className={cn(
        "relative min-h-0 shrink overflow-y-auto border-b border-border/60 px-2 py-2",
        // On a phone the recipients wrap, so the thread gives the draft more room.
        compact ? "max-h-[35%] sm:max-h-[45%]" : "flex-1",
      )}
    >
      {loading ? (
        <div className="space-y-2 px-2 py-1">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : unavailable ? (
        <p className="px-2 py-1 text-[13px] text-muted-foreground">
          {t("mail.draftCard.threadUnavailable")}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {folded && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="rounded px-3 py-2 text-start text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
            >
              {t("mail.draftCard.earlierMessages", { count: hiddenCount })}
            </button>
          )}
          {visible.map((message) => {
            const isLatest = message.id === latestId;
            const expanded = isLatest !== toggled.has(message.id);
            return expanded ? (
              <ExpandedMessageCard
                key={message.id}
                ref={isLatest ? latestRef : undefined}
                email={message}
                onCollapse={() => toggle(message.id)}
              />
            ) : (
              <CollapsedMessageRow
                key={message.id}
                ref={isLatest ? latestRef : undefined}
                email={message}
                onClick={() => toggle(message.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function OutcomePanel({ outcome }: { outcome: CardOutcome }) {
  const t = useT();
  const formatters = useFormatters();

  if (outcome.status === "queued" || outcome.status === "sending") {
    return (
      <div
        role="status"
        className="flex flex-1 items-center justify-center gap-3 py-6 text-[13px] text-muted-foreground"
      >
        <IconLoader2 className="size-4 animate-spin" />
        {t("mail.compose.sending")}
        {outcome.status === "queued" && (
          <Button variant="outline" size="sm" onClick={outcome.undo}>
            {t("mail.actions.undo")}
          </Button>
        )}
      </div>
    );
  }

  const { icon, text } =
    outcome.status === "sent"
      ? {
          icon: (
            <span className="flex size-8 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <IconCheck className="size-4" />
            </span>
          ),
          text: t("mail.toasts.messageSent"),
        }
      : outcome.status === "scheduled"
        ? {
            icon: <IconClock className="size-5 text-muted-foreground" />,
            text: t("mail.sendLater.scheduledFor", {
              date: formatters.formatDate(new Date(outcome.runAt), {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              }),
            }),
          }
        : {
            icon: <IconTrash className="size-5 text-muted-foreground" />,
            text: t("mail.draftCard.deleted"),
          };

  return (
    <div
      role="status"
      className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-[13px] font-medium"
    >
      {icon}
      {text}
    </div>
  );
}

function CardNotice({
  icon,
  title,
  action,
}: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      {icon}
      <p className="text-sm font-medium">{title}</p>
      {action}
    </div>
  );
}

function DraftCardSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-3 p-3">
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="min-h-24 w-full flex-1" />
    </div>
  );
}

// Tell the chat's model what the reader did, so its next turn doesn't offer to
// send a draft that already went out.
function useReportOutcomeToModel(draftId: string, outcome: CardOutcome | null) {
  useEffect(() => {
    if (
      !outcome ||
      outcome.status === "queued" ||
      outcome.status === "sending" ||
      (outcome.status === "deleted" && !outcome.confirmed)
    ) {
      return;
    }
    const runAt =
      outcome.status === "scheduled"
        ? new Date(outcome.runAt).toISOString()
        : undefined;
    const text =
      outcome.status === "sent"
        ? `The user sent email draft ${draftId} from the Mail card.`
        : outcome.status === "scheduled"
          ? `The user scheduled email draft ${draftId} to send at ${runAt}.`
          : `The user deleted email draft ${draftId} from the Mail card.`;
    const reported = updateMcpAppModelContext({
      structuredContent: {
        draftId,
        status: outcome.status,
        ...(runAt ? { runAt } : {}),
      },
      content: [{ type: "text", text }],
    });
    // Outside a chat there's no model to tell. In one, the card already shows
    // the outcome, so a failed report only costs the model this update.
    if (reported) {
      void reported.then(
        (ok) => {
          if (!ok) {
            console.warn(
              `The chat didn't take the update for draft ${draftId}.`,
            );
          }
        },
        (error) => {
          console.warn(`Couldn't tell the chat about draft ${draftId}:`, error);
        },
      );
    }
  }, [draftId, outcome]);
}

// The inbox shows these from AppLayout, which the card renders without. A
// delete the reader asked for gets the card's own failure state instead.
function useDraftFailureToasts(
  draftId: string,
  outcomeRef: RefObject<CardOutcome | null>,
) {
  const t = useT();
  useEffect(() => {
    const handleSaveFailed = (event: Event) => {
      const failedId =
        event instanceof CustomEvent ? event.detail?.draftId : undefined;
      if (failedId && failedId !== draftId) return;
      toast.error(t("mail.toasts.failedToSaveDraft"));
    };
    const handleDeleteFailed = () => {
      if (outcomeRef.current?.status === "deleted") return;
      toast.error(t("mail.toasts.failedToDeleteDraft"));
    };
    window.addEventListener(DRAFT_SAVE_FAILED_EVENT, handleSaveFailed);
    window.addEventListener(DRAFT_DELETE_FAILED_EVENT, handleDeleteFailed);
    return () => {
      window.removeEventListener(DRAFT_SAVE_FAILED_EVENT, handleSaveFailed);
      window.removeEventListener(DRAFT_DELETE_FAILED_EVENT, handleDeleteFailed);
    };
  }, [draftId, outcomeRef, t]);
}
