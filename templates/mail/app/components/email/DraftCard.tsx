import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  mcpAppLinkUrl,
  openMcpAppHostLink,
  updateMcpAppModelContext,
} from "@agent-native/core/client/mcp-app-host";
import { reportWriteFailure } from "@agent-native/core/client/write-failure";
import {
  SaveOverlapError,
  saveWithMerge,
  type SavedRecord,
} from "@agent-native/core/save-conflict";
import type { ComposeState, DraftCardData, EmailMessage } from "@shared/types";
import {
  IconAlertCircle,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconMail,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
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
import { useDraftConflictPrompt } from "@/hooks/use-draft-conflict-prompt";

import { ComposeModal } from "./ComposeModal";
import { CollapsedMessageRow, ExpandedMessageCard } from "./EmailThread";

// Older messages past this many fold into one row until the reader opens them.
const VISIBLE_THREAD_TAIL = 3;
// How much of the newest message stays in view when the thread opens.
const LATEST_MESSAGE_MIN_VISIBLE = 120;
// Every save rewrites the Gmail draft, so a save waits for a pause in typing.
const SAVE_DELAY_MS = 1_500;
const EDITABLE_FIELDS = ["to", "cc", "bcc", "subject", "body"] as const;
// A card's session reaches only its draft's read and edit. The read carries the
// signature and image setting, and recipients get no address book to
// autocomplete from.
const QUERIES_THE_CARD_CANNOT_FETCH = [
  ["settings"],
  ["aliases"],
  ["contacts"],
  ["snippets"],
] as const;

type DraftEdits = Partial<Pick<ComposeState, (typeof EDITABLE_FIELDS)[number]>>;

const noop = () => {};

function restrictCardQueries(queryClient: QueryClient) {
  for (const key of QUERIES_THE_CARD_CANNOT_FETCH) {
    queryClient.setQueryDefaults(key, { enabled: false });
  }
}

function draftCardQueryKey(draftId: string) {
  return ["draft-card", draftId] as const;
}

// What a save writes. Leaving out the rest keeps other writers' changes to them.
function changedFields(from: ComposeState, to: ComposeState) {
  return Object.fromEntries(
    EDITABLE_FIELDS.filter((field) => to[field] !== from[field]).map(
      (field) => [field, to[field]],
    ),
  );
}

/**
 * One draft as a chat-sized card: the conversation it answers, then the
 * editable draft. Outside agents embed it from manage-draft. Its session is
 * limited to this draft, so sending and deleting open in Mail.
 */
export function DraftCard({ draftId }: { draftId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  // Before the composer's first render, which starts these queries.
  useState(() => restrictCardQueries(queryClient));
  // Leaving the card puts Mail's own queries back, without the card's partial
  // settings.
  useEffect(() => {
    restrictCardQueries(queryClient);
    return () => {
      for (const key of QUERIES_THE_CARD_CANNOT_FETCH) {
        queryClient.setQueryDefaults(key, {});
      }
      queryClient.removeQueries({ queryKey: ["settings"], exact: true });
    };
  }, [queryClient]);

  const card = useQuery<DraftCardData>({
    queryKey: draftCardQueryKey(draftId),
    queryFn: async () => {
      const data = (await callAction(
        "get-draft-card",
        { id: draftId },
        { method: "GET" },
      )) as DraftCardData;
      if (data.draft) queryClient.setQueryData(["settings"], data.settings);
      return data;
    },
    enabled: Boolean(draftId),
    staleTime: 60_000,
    // request-storm-allow: one query for the one draft on this card, at most once a minute, to notice a draft deleted in Mail.
    refetchOnWindowFocus: true,
  });
  const loaded = card.data?.draft ? card.data : null;
  const { edits, update, flush, flushAll, conflictPrompt } =
    useDraftEdits(draftId);

  useReportDraftGoneToModel(draftId, card.data);
  // A draft this card showed and can't read now was sent or deleted, most
  // likely by Send in Mail.
  const [showedDraft, setShowedDraft] = useState(false);
  if (card.data?.draft && !showedDraft) setShowedDraft(true);

  const draft = useMemo<ComposeState | null>(
    () => (loaded ? { ...loaded.draft, ...edits } : null),
    [loaded, edits],
  );
  const accountFilter = useMemo(() => {
    // The card renders outside AppLayout, which provides the accounts for the
    // composer everywhere else.
    const accounts = loaded?.accounts ?? [];
    return {
      activeAccounts: new Set(accounts.map((account) => account.email)),
      allAccounts: accounts,
    };
  }, [loaded?.accounts]);

  const deepLink = loaded?.deepLink;
  const handleSendInMail = useCallback(async () => {
    if (!deepLink || !(await flushAll())) return;
    const url = mcpAppLinkUrl(deepLink);
    // The host opens the link in the user's browser; without one, or when it
    // refuses, the card opens it as it would anywhere.
    const handled = openMcpAppHostLink(url);
    if (handled && (await handled)) return;
    // The waits above can outlast the click, and then the browser blocks the
    // tab. "noopener" would hide that, so it's cleared on the tab instead.
    const tab = window.open(url, "_blank");
    if (tab) {
      tab.opener = null;
      return;
    }
    toast.error(t("mail.draftCard.openBlocked"), {
      action: {
        label: t("mail.draftCard.sendInMail"),
        onClick: () => window.open(url, "_blank", "noopener,noreferrer"),
      },
    });
  }, [deepLink, flushAll, t]);

  let body: ReactNode;
  if (showedDraft && card.data?.draft === null) {
    body = (
      <CardNotice
        icon={<IconMail className="size-5 text-muted-foreground" />}
        title={t("mail.draftCard.goneTitle")}
      />
    );
  } else if (!draftId || card.data?.draft === null) {
    body = (
      <CardNotice
        icon={<IconTrash className="size-5 text-muted-foreground" />}
        title={t("mail.draftCard.notFoundTitle")}
      />
    );
  } else if (draft && loaded) {
    const thread = loaded.thread;
    body = (
      <>
        <DraftCardHeader draft={draft} subject={thread.messages[0]?.subject} />
        {thread.status !== "none" && (
          <DraftThreadSection
            messages={thread.messages}
            unavailable={thread.status === "unavailable"}
          />
        )}
        <div className="flex min-h-[220px] flex-1 flex-col gap-2 p-2">
          <ComposeModal
            presentation="card"
            drafts={[draft]}
            activeId={draft.id}
            activeDraft={draft}
            onSetActiveId={noop}
            onUpdate={update}
            onClose={noop}
            onCloseAll={noop}
            onDiscard={noop}
            onStageForSend={noop}
            onRestoreAfterSend={noop}
            onNewDraft={noop}
            onFlush={flush}
            onSendInMail={() => void handleSendInMail()}
          />
        </div>
      </>
    );
  } else if (card.isError) {
    body = (
      <CardNotice
        icon={<IconAlertCircle className="size-5 text-destructive" />}
        title={t("mail.draftCard.loadFailed")}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void card.refetch()}
          >
            {t("mail.error.tryAgain")}
          </Button>
        }
      />
    );
  } else {
    body = <DraftCardSkeleton />;
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
      {conflictPrompt}
    </AccountFilterContext.Provider>
  );
}

/**
 * The reader's unsaved edits, shown over the stored draft and saved through
 * manage-draft. A save names the revision the edits started from, so a change
 * the reader hasn't seen can't be overwritten: one to another field merges in,
 * and one to the same field asks which to keep.
 */
function useDraftEdits(draftId: string) {
  const t = useT();
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<DraftEdits>({});
  const editsRef = useRef<DraftEdits>({});
  // What the edits started from. A read can't move it under them, or a change to
  // a field being edited would go unnoticed.
  const baseRef = useRef<SavedRecord<ComposeState> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSaveRef = useRef<Promise<boolean>>(Promise.resolve(true));

  const { resolveOverlap, prompt: conflictPrompt } = useDraftConflictPrompt(
    (restoreOnto) => {
      const shown = queryClient.getQueryData<DraftCardData>(
        draftCardQueryKey(draftId),
      );
      if (shown?.draft) {
        update(draftId, restoreOnto({ ...shown.draft, ...editsRef.current }));
      }
    },
  );

  const save = useCallback(async (): Promise<boolean> => {
    const sent = editsRef.current;
    const base = baseRef.current;
    if (!base || Object.keys(sent).length === 0) return true;
    try {
      const saved = await saveWithMerge<ComposeState>({
        base,
        mine: { ...base.value, ...sent },
        resolveOverlap,
        parseCurrent: (current) => {
          // Sent or deleted during this save. Merging would store it again, so
          // this fails and the read below says it's gone.
          if (!current) throw new Error(`Draft ${draftId} is gone.`);
          return current as ComposeState;
        },
        save: async ({ value, revision, base: from }) => {
          const result = (await callAction("manage-draft", {
            action: "update",
            id: draftId,
            expectedRevision: revision ?? undefined,
            ...changedFields(from, value),
          })) as { draft: ComposeState; revision: string };
          return { value: result.draft, revision: result.revision };
        },
      });
      baseRef.current = saved;
      const key = draftCardQueryKey(draftId);
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<DraftCardData>(key, (current) =>
        current?.draft
          ? {
              ...current,
              draft: saved.value,
              revision: saved.revision ?? current.revision,
            }
          : current,
      );
      // Anything typed while this save ran is still unsaved.
      const remaining = Object.fromEntries(
        Object.entries(editsRef.current).filter(
          ([field, value]) => sent[field as keyof DraftEdits] !== value,
        ),
      );
      editsRef.current = remaining;
      setEdits(remaining);
      reportToModel(
        draftId,
        "edited",
        `The user edited email draft ${draftId} in the Mail card. To change it ` +
          `again, send expectedRevision "${saved.revision}". It now reads:\n` +
          `To: ${saved.value.to}\nCc: ${saved.value.cc ?? ""}\n` +
          `Bcc: ${saved.value.bcc ?? ""}\nSubject: ${saved.value.subject}\n\n` +
          saved.value.body,
      );
      return true;
    } catch (error) {
      console.error(`Couldn't save draft ${draftId}:`, error);
      // The prompt already said so when it couldn't ask.
      if (!(error instanceof SaveOverlapError)) {
        reportWriteFailure(error, {
          label: t("mail.toasts.failedToSaveDraft"),
        });
      }
      // The draft may be gone by now; the read says so.
      void queryClient.invalidateQueries({
        queryKey: draftCardQueryKey(draftId),
      });
      return false;
    }
  }, [draftId, queryClient, resolveOverlap, t]);

  // Saves run one at a time, so they can't land out of order. Resolves once
  // everything typed so far is saved, or false when that failed.
  const flush = useCallback((): Promise<boolean> => {
    clearTimeout(timerRef.current);
    const next = lastSaveRef.current.then(save);
    lastSaveRef.current = next;
    return next;
  }, [save]);

  // Typing can go on while a save runs, so this waits until nothing is left.
  const flushAll = useCallback(async (): Promise<boolean> => {
    do {
      if (!(await flush())) return false;
    } while (Object.keys(editsRef.current).length > 0);
    return true;
  }, [flush]);

  const update = useCallback(
    (_id: string, partial: Partial<ComposeState>) => {
      const changed: DraftEdits = {};
      for (const field of EDITABLE_FIELDS) {
        const value = partial[field];
        if (value !== undefined) changed[field] = value;
      }
      if (Object.keys(changed).length === 0) return;
      // Nothing unsaved, so this starts from the draft on screen.
      if (Object.keys(editsRef.current).length === 0) {
        const shown = queryClient.getQueryData<DraftCardData>(
          draftCardQueryKey(draftId),
        );
        // The composer's last change after the draft went: nothing to edit.
        if (!shown?.draft) return;
        baseRef.current = { value: shown.draft, revision: shown.revision };
      }
      editsRef.current = { ...editsRef.current, ...changed };
      setEdits(editsRef.current);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [draftId, flush, queryClient],
  );

  // A host can tear the card down with the chat, so a hidden card saves now.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") void flushRef.current();
    };
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      document.removeEventListener("visibilitychange", flushWhenHidden);
      void flushRef.current();
    };
  }, []);

  return { edits, update, flush, flushAll, conflictPrompt };
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

function DraftThreadSection({
  messages,
  unavailable,
}: {
  messages: EmailMessage[];
  unavailable: boolean;
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
      // On a phone the recipients wrap, so the thread gives the draft more room.
      className="relative max-h-[35%] min-h-0 shrink overflow-y-auto border-b border-border/60 px-2 py-2 sm:max-h-[45%]"
    >
      {unavailable ? (
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
                attachmentNamesOnly
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

// Tell the chat's model what the reader did, so its next turn works from the
// draft as it stands and doesn't offer to send one that's gone.
function reportToModel(
  draftId: string,
  status: "edited" | "gone",
  text: string,
) {
  const reported = updateMcpAppModelContext({
    structuredContent: { draftId, status },
    content: [{ type: "text", text }],
  });
  // Outside a chat there's no model to tell. In one, the card already shows
  // the change, so a failed report only costs the model this update.
  if (reported) {
    void reported.then(
      (ok) => {
        if (!ok) {
          console.warn(`The chat didn't take the update for draft ${draftId}.`);
        }
      },
      (error) => {
        console.warn(`Couldn't tell the chat about draft ${draftId}:`, error);
      },
    );
  }
}

// A draft that was here and isn't has been sent or deleted, most likely in the
// Mail tab the card opened.
function useReportDraftGoneToModel(
  draftId: string,
  data: DraftCardData | undefined,
) {
  const hadDraftRef = useRef(false);
  useEffect(() => {
    if (data?.draft) {
      hadDraftRef.current = true;
    } else if (data && hadDraftRef.current) {
      hadDraftRef.current = false;
      reportToModel(
        draftId,
        "gone",
        `Email draft ${draftId} is no longer in Mail: it was sent or deleted.`,
      );
    }
  }, [draftId, data]);
}
