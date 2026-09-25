import { useAgentChatGenerating } from "@agent-native/core/client/agent-chat";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import {
  appendSignatureToBody,
  splitAppendedSignature,
} from "@shared/signature";
import type { ComposeState } from "@shared/types";
import {
  IconX,
  IconMinus,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconBold,
  IconItalic,
  IconLink,
  IconPaperclip,
  IconChevronDown,
  IconDots,
  IconLoader2,
  IconTrash,
  IconPlus,
} from "@tabler/icons-react";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type { CSSProperties, ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAccountFilter } from "@/hooks/use-account-filter";
import { useAliases } from "@/hooks/use-aliases";
import { useUpdateQueuedDraft } from "@/hooks/use-draft-queue";
import {
  useSendEmail,
  useAddOptimisticReply,
  useArchiveEmail,
} from "@/hooks/use-emails";
import { useSettings } from "@/hooks/use-emails";
import { useIsMobile } from "@/hooks/use-mobile";
import { useScheduleEmail } from "@/hooks/use-scheduled-jobs";
import { canUseAgentGenerate } from "@/lib/agent-generate";
import { expandAliasTokens } from "@/lib/alias-utils";
import { openFilePicker, uploadFile, uploadFiles } from "@/lib/upload";
import { cn } from "@/lib/utils";

import { AttachmentStrip } from "./AttachmentStrip";
import {
  getCurrentDraftBodyFromEditor,
  isSameScheduledDraft,
  splitQuotedContent,
} from "./compose-draft-context";
import { handleComposeSendLaterShortcut } from "./compose-shortcuts";
import { ComposeEditor, type ComposeEditorHandle } from "./ComposeEditor";
import { shouldMarkReplyDoneAfterSend } from "./mail-send-policy";
import {
  RecipientInput,
  computeRecipientMove,
  type RecipientField,
} from "./RecipientInput";
import { SendLaterButton } from "./SendLaterButton";

const SEND_UNDO_WINDOW_MS = 10_000;
const LAST_SEND_ACCOUNT_KEY = "mail:lastSendAccount";

type ComposeAccount = { email: string; displayName?: string };

export interface ComposePaletteCommands {
  send: () => void;
  sendLater: () => void;
  sendAndMarkDone: () => void;
}

function ComposeFieldRow({
  label,
  children,
  trailing,
}: {
  label: string;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-h-10 items-center gap-2 border-b border-border px-4">
      <span className="w-8 shrink-0 text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {children}
      {trailing}
    </div>
  );
}

function accountDisplayName(account: ComposeAccount) {
  return account.displayName?.trim() || account.email;
}

function AccountChip({ account }: { account: ComposeAccount }) {
  const displayName = accountDisplayName(account);

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md bg-accent px-2 py-0.5 text-xs text-accent-foreground">
      <span className="truncate font-medium">{displayName}</span>
      {displayName !== account.email && (
        <span className="truncate text-muted-foreground/70">
          {account.email}
        </span>
      )}
    </span>
  );
}

function FromAccountSelector({
  accounts,
  value,
  onChange,
  label,
}: {
  accounts: ComposeAccount[];
  value: string | undefined;
  onChange: (email: string) => void;
  label: string;
}) {
  // On mount, if no account is set, apply the sticky default
  const resolvedValue =
    value ||
    (accounts.some(
      (a) => a.email === localStorage.getItem(LAST_SEND_ACCOUNT_KEY),
    )
      ? localStorage.getItem(LAST_SEND_ACCOUNT_KEY)!
      : accounts[0]?.email) ||
    "";
  const selectedAccount =
    accounts.find((account) => account.email === resolvedValue) ??
    (resolvedValue ? { email: resolvedValue } : accounts[0]);

  // Sync the sticky default into the draft if it wasn't set
  useEffect(() => {
    if (!value && resolvedValue) {
      onChange(resolvedValue);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ComposeFieldRow label={label}>
      <Select
        value={resolvedValue}
        onValueChange={(email) => {
          localStorage.setItem(LAST_SEND_ACCOUNT_KEY, email);
          onChange(email);
        }}
      >
        <SelectTrigger className="h-10 min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-sm shadow-none focus:ring-0">
          <SelectValue className="min-w-0 flex-1">
            {selectedAccount && <AccountChip account={selectedAccount} />}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {accounts.map((acct) => (
            <SelectItem key={acct.email} value={acct.email}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{accountDisplayName(acct)}</span>
                {accountDisplayName(acct) !== acct.email && (
                  <span className="truncate text-xs text-muted-foreground">
                    {acct.email}
                  </span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </ComposeFieldRow>
  );
}

interface ComposeModalProps {
  drafts: ComposeState[];
  activeId: string | null;
  activeDraft: ComposeState | null;
  initialExpanded?: boolean;
  onSetActiveId: (id: string) => void;
  onUpdate: (id: string, partial: Partial<ComposeState>) => void;
  onClose: (id: string) => void;
  onCloseAll: () => void;
  onDiscard: (id: string) => void;
  onStageForSend: (id: string) => void;
  onRestoreAfterSend: (id: string) => void;
  onNewDraft: () => void;
  onFlush: (id: string) => Promise<unknown> | undefined;
  onRegisterComposeCommands?: (commands: ComposePaletteCommands | null) => void;
  onInitialExpandedConsumed?: () => void;
}

function shouldStartComposeExpanded(initialExpanded: boolean) {
  // Superhuman opens both new and reopened drafts in the workspace card. Keep
  // fullscreen an explicit request so a draft never changes size by identity.
  return initialExpanded;
}

export function ComposeModal({
  drafts,
  activeId,
  activeDraft,
  initialExpanded = false,
  onSetActiveId,
  onUpdate,
  onClose,
  onCloseAll,
  onDiscard,
  onStageForSend,
  onRestoreAfterSend,
  onNewDraft,
  onFlush,
  onRegisterComposeCommands,
  onInitialExpandedConsumed,
}: ComposeModalProps) {
  const t = useT();
  const formatters = useFormatters();
  const isMobile = useIsMobile();
  const [minimized, setMinimized] = useState(false);
  const [isExpanded, setIsExpanded] = useState(
    shouldStartComposeExpanded(initialExpanded),
  );
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [showQuoted, setShowQuoted] = useState(false);
  const composeRef = useRef<HTMLDivElement>(null);
  const composePaletteCommandsRef = useRef<ComposePaletteCommands>({
    send: () => {},
    sendLater: () => {},
    sendAndMarkDone: () => {},
  });
  const knownDraftIdsRef = useRef(
    new Set(
      drafts
        .filter((draft) => {
          const isInitialNewCompose =
            draft.id === activeDraft?.id &&
            draft.mode === "compose" &&
            !draft.savedDraftId &&
            !draft.queuedDraftId;
          return !isInitialNewCompose;
        })
        .map((draft) => draft.id),
    ),
  );
  const pendingNewDraftIdsRef = useRef(new Set<string>());
  const focusNewDraftIdRef = useRef<string | null>(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  // Observe agent sidebar width so compose window stays to its left
  const [sidebarRight, setSidebarRight] = useState(16); // default 16px (right-4)
  useEffect(() => {
    function measure() {
      const panel = document.querySelector(".agent-sidebar-panel");
      // Also account for the resize handle (6px)
      const panelWidth = panel ? panel.getBoundingClientRect().width + 6 : 0;
      setSidebarRight(panelWidth > 0 ? panelWidth + 16 : 16);
    }
    measure();
    const observer = new MutationObserver(measure);
    // Watch for sidebar appearing/disappearing and style changes (resize)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const [isGenerating, sendToAgent] = useAgentChatGenerating();
  const sendEmail = useSendEmail();
  const addOptimisticReply = useAddOptimisticReply();
  const archiveEmail = useArchiveEmail();
  const updateQueuedDraft = useUpdateQueuedDraft();
  const scheduleEmail = useScheduleEmail();
  const { data: aliases = [] } = useAliases();
  const { data: settings } = useSettings();
  const { allAccounts } = useAccountFilter();
  const editorRef = useRef<ComposeEditorHandle>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const sendingIdsRef = useRef<Set<string>>(new Set());
  const schedulingRef = useRef(false);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  useEffect(() => {
    const [account] = allAccounts;
    if (
      allAccounts.length !== 1 ||
      !activeDraft ||
      activeDraft.mode !== "compose" ||
      activeDraft.savedDraftId ||
      activeDraft.queuedDraftId ||
      activeDraft.accountEmail
    ) {
      return;
    }
    onUpdate(activeDraft.id, { accountEmail: account.email });
  }, [activeDraft, allAccounts, onUpdate]);

  // Reset CC/BCC visibility and quote expansion when switching tabs
  useEffect(() => {
    setShowCcBcc(false);
    setShowQuoted(false);
  }, [activeId]);

  useEffect(() => {
    const currentDraftIds = new Set(drafts.map((draft) => draft.id));
    for (const draft of drafts) {
      const isNewCompose =
        draft.mode === "compose" && !draft.savedDraftId && !draft.queuedDraftId;
      if (isNewCompose && !knownDraftIdsRef.current.has(draft.id)) {
        pendingNewDraftIdsRef.current.add(draft.id);
      }
    }
    for (const id of pendingNewDraftIdsRef.current) {
      if (!currentDraftIds.has(id)) pendingNewDraftIdsRef.current.delete(id);
    }
    knownDraftIdsRef.current = currentDraftIds;
    if (!activeDraft || !pendingNewDraftIdsRef.current.delete(activeDraft.id)) {
      return;
    }
    setMinimized(false);
    focusNewDraftIdRef.current = activeDraft.id;
  }, [activeDraft?.id, drafts]);

  // The opener retains focus after React mounts the new draft. Restore the
  // keyboard-first compose flow after that click has finished.
  useEffect(() => {
    const draftId = focusNewDraftIdRef.current;
    if (!draftId || draftId !== activeDraft?.id || minimized) return;
    focusNewDraftIdRef.current = null;

    const focusTimer = setTimeout(() => {
      if (activeIdRef.current !== draftId) return;
      composeRef.current
        ?.querySelector<HTMLInputElement>(
          '[data-mail-recipient-input][data-recipient-field="to"]',
        )
        ?.focus();
    }, 0);

    return () => clearTimeout(focusTimer);
  }, [activeDraft?.id, minimized]);

  // Focus editor when reply/forward opens
  useEffect(() => {
    if (activeDraft?.mode && activeDraft.mode !== "compose") {
      setTimeout(() => editorRef.current?.getEditor()?.commands.focus(), 100);
    }
  }, [activeDraft?.mode, activeId]);

  useEffect(() => {
    if (!initialExpanded || !activeDraft) return;
    setMinimized(false);
    setIsExpanded(true);
    onInitialExpandedConsumed?.();
  }, [activeDraft?.id, initialExpanded, onInitialExpandedConsumed]);

  useEffect(() => {
    setScheduleOpen(false);
  }, [activeId]);

  // Partially typed recipients live in RecipientInput, outside the draft snapshot.
  const hasUncommittedRecipientText = () =>
    Array.from(
      composeRef.current?.querySelectorAll<HTMLInputElement>(
        "[data-mail-recipient-input]",
      ) ?? [],
    ).some((input) => input.value.trim().length > 0);

  const handleSend = async (explicitlyMarkDone = false) => {
    if (!activeDraft || !activeId || schedulingRef.current) return;
    if (sendingIdsRef.current.has(activeId)) return;
    if (hasUncommittedRecipientText()) {
      toast.error(t("mail.toasts.finishRecipientInput"));
      return;
    }
    if (!activeDraft.to.trim()) {
      toast.error(t("mail.toasts.pleaseAddRecipient"));
      return;
    }
    sendingIdsRef.current.add(activeId);
    const sendingId = activeId;

    // Snapshot draft data for potential undo
    const draftSnapshot = { ...activeDraft };
    const markDoneAfterSend = shouldMarkReplyDoneAfterSend(
      draftSnapshot,
      settings?.sendAndArchive === true,
      explicitlyMarkDone,
    );

    // Hide it during the undo window without deleting either draft copy.
    onStageForSend(activeId);

    // Show optimistic reply in the thread immediately (for replies)
    const undoOptimistic = draftSnapshot.replyToId
      ? addOptimisticReply({
          to: expandAliasTokens(draftSnapshot.to, aliases),
          cc: expandAliasTokens(draftSnapshot.cc ?? "", aliases) || undefined,
          subject: draftSnapshot.subject,
          body: draftSnapshot.body,
          replyToId: draftSnapshot.replyToId,
          replyToThreadId: draftSnapshot.replyToThreadId,
          accountEmail: draftSnapshot.accountEmail,
          attachments: draftSnapshot.attachments,
        })
      : undefined;

    let cancelled = false;
    let dispatchStarted = false;

    const handleUndo = () => {
      if (cancelled || dispatchStarted) return;
      cancelled = true;
      sendingIdsRef.current.delete(sendingId);
      clearTimeout(sendTimer);
      toast.dismiss(toastId);
      undoOptimistic?.();
      onRestoreAfterSend(sendingId);
    };

    // Keep undo available only while the provider call is still deferred.
    const toastId = toast(t("mail.compose.sending"), {
      action: { label: t("mail.actions.undo"), onClick: handleUndo },
      duration: Infinity,
    });

    // After the 10s undo window, actually send the email. Once dispatch starts, dismiss the
    // undo toast because a client-side flag cannot cancel an in-flight send.
    const sendTimer = setTimeout(() => {
      if (cancelled) return;
      dispatchStarted = true;
      sendingIdsRef.current.delete(sendingId);
      toast.dismiss(toastId);
      const sendingToastId = toast(t("mail.compose.sending"), {
        duration: Infinity,
      });
      void sendEmail
        .mutateAsync({
          to: expandAliasTokens(draftSnapshot.to, aliases),
          cc: expandAliasTokens(draftSnapshot.cc ?? "", aliases) || undefined,
          bcc: expandAliasTokens(draftSnapshot.bcc ?? "", aliases) || undefined,
          subject: draftSnapshot.subject,
          body: draftSnapshot.body,
          replyToId: draftSnapshot.replyToId,
          replyToThreadId: draftSnapshot.replyToThreadId,
          accountEmail: draftSnapshot.accountEmail,
          attachments: draftSnapshot.attachments,
        })
        .then((result) => {
          toast(t("mail.toasts.messageSent"), {
            id: sendingToastId,
            duration: 3_000,
          });
          onDiscard(sendingId);
          if (draftSnapshot.queuedDraftId) {
            updateQueuedDraft.mutate({
              id: draftSnapshot.queuedDraftId,
              status: "sent",
              sentMessageId: result?.id,
            });
          }
          if (markDoneAfterSend && draftSnapshot.replyToId) {
            archiveEmail.mutate({
              id: draftSnapshot.replyToId,
              accountEmail: draftSnapshot.accountEmail,
              threadId: draftSnapshot.replyToThreadId,
            });
          }
        })
        .catch(() => {
          toast.dismiss(sendingToastId);
          toast.error(t("mail.toasts.failedToSendEmail"));
          onRestoreAfterSend(sendingId);
        });
    }, SEND_UNDO_WINDOW_MS);
  };

  composePaletteCommandsRef.current = {
    send: () => {
      void handleSend();
    },
    sendLater: () => setScheduleOpen(true),
    sendAndMarkDone: () => {
      void handleSend(true);
    },
  };
  const hasActiveDraft = Boolean(activeId && activeDraft);
  useEffect(() => {
    if (!onRegisterComposeCommands) return;
    if (!hasActiveDraft || minimized) {
      onRegisterComposeCommands(null);
      return;
    }
    onRegisterComposeCommands({
      send: () => composePaletteCommandsRef.current.send(),
      sendLater: () => composePaletteCommandsRef.current.sendLater(),
      sendAndMarkDone: () =>
        composePaletteCommandsRef.current.sendAndMarkDone(),
    });
    return () => onRegisterComposeCommands(null);
  }, [hasActiveDraft, minimized, onRegisterComposeCommands]);

  const handleSendLater = async (runAt: number) => {
    if (!activeDraft || !activeId || schedulingRef.current) return;
    if (hasUncommittedRecipientText()) {
      toast.error(t("mail.toasts.finishRecipientInput"));
      return;
    }
    if (!activeDraft.to.trim()) {
      toast.error(t("mail.toasts.pleaseAddRecipient"));
      return;
    }

    schedulingRef.current = true;
    const schedulingId = activeId;
    const draftSnapshot = { ...activeDraft };

    try {
      await scheduleEmail.mutateAsync({
        threadId: draftSnapshot.replyToThreadId,
        accountEmail: draftSnapshot.accountEmail,
        runAt,
        payload: {
          to: expandAliasTokens(draftSnapshot.to, aliases),
          cc: expandAliasTokens(draftSnapshot.cc ?? "", aliases) || undefined,
          bcc: expandAliasTokens(draftSnapshot.bcc ?? "", aliases) || undefined,
          subject: draftSnapshot.subject,
          body: draftSnapshot.body,
          replyToId: draftSnapshot.replyToId,
          threadId: draftSnapshot.replyToThreadId,
          accountEmail: draftSnapshot.accountEmail,
          attachments: draftSnapshot.attachments,
        },
      });

      // Preserve edits made while the scheduling request was in flight.
      const currentDraft = draftsRef.current.find(
        (draft) => draft.id === schedulingId,
      );
      if (currentDraft && isSameScheduledDraft(currentDraft, draftSnapshot)) {
        onDiscard(schedulingId);
      }

      const scheduledDate = formatters.formatDate(new Date(runAt), {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      toast(t("mail.sendLater.scheduledFor", { date: scheduledDate }));
    } catch {
      toast.error(t("mail.toasts.failedToScheduleEmailDraftKeptOpen"));
    } finally {
      schedulingRef.current = false;
    }
  };

  const composeAnimationRef = useRef<Animation | null>(null);
  const focusBccAfterExpandRef = useRef(false);

  useEffect(() => {
    if (!showCcBcc || !focusBccAfterExpandRef.current) return;
    focusBccAfterExpandRef.current = false;
    composeRef.current
      ?.querySelector<HTMLInputElement>('[data-recipient-field="bcc"]')
      ?.focus();
  }, [showCcBcc]);

  const revealCcBcc = () => {
    if (!activeId || !activeDraft) return;
    setShowCcBcc(true);
    const missingFields: Partial<ComposeState> = {};
    if (activeDraft.cc === undefined) missingFields.cc = "";
    if (activeDraft.bcc === undefined) missingFields.bcc = "";
    if (Object.keys(missingFields).length > 0) {
      onUpdate(activeId, missingFields);
    }
  };

  const animateComposeLayout = useCallback((updateLayout: () => void) => {
    const compose = composeRef.current;
    const before = compose?.getBoundingClientRect();

    updateLayout();

    if (
      !compose ||
      !before ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    requestAnimationFrame(() => {
      const after = compose.getBoundingClientRect();
      if (after.width === 0 || after.height === 0) return;

      const translateX = before.left - after.left;
      const translateY = before.top - after.top;
      const scaleX = before.width / after.width;
      const scaleY = before.height / after.height;

      composeAnimationRef.current?.cancel();
      composeAnimationRef.current = compose.animate(
        [
          {
            transform: `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`,
            transformOrigin: "top left",
          },
          { transform: "none", transformOrigin: "top left" },
        ],
        {
          duration: 200,
          easing: "cubic-bezier(0.23, 1, 0.32, 1)",
        },
      );
    });
  }, []);

  useEffect(
    () => () => {
      composeAnimationRef.current?.cancel();
    },
    [],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Only handle shortcuts for events originating within the compose window
    // (prevents agent chat Cmd+Enter from triggering email send)
    if (!composeRef.current?.contains(e.target as Node)) return;

    if (
      (e.metaKey || e.ctrlKey) &&
      !e.altKey &&
      e.shiftKey &&
      e.key.toLowerCase() === "b" &&
      activeId &&
      activeDraft
    ) {
      e.preventDefault();
      if (showCcBcc) {
        composeRef.current
          ?.querySelector<HTMLInputElement>('[data-recipient-field="bcc"]')
          ?.focus();
      } else {
        focusBccAfterExpandRef.current = true;
        revealCcBcc();
      }
      return;
    }

    if (handleComposeSendLaterShortcut(e, () => setScheduleOpen(true))) {
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSend(e.shiftKey);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (activeId) onClose(activeId);
    }
  };

  const handleGenerate = async () => {
    if (!generatePrompt.trim() || !activeId || !activeDraft) return;
    if (!(await canUseAgentGenerate())) {
      toast.error(t("mail.toasts.aiEngineRequired"));
      window.dispatchEvent(new CustomEvent("agent-panel:open"));
      return;
    }

    await onFlush(activeId);
    const promptDraft = {
      ...activeDraft,
      body: getCurrentDraftBodyFromEditor({
        draft: activeDraft,
        editor: editorRef.current?.getEditor(),
        signature: settings?.signature,
      }),
    };

    const context = [
      promptDraft.to && `To: ${promptDraft.to}`,
      promptDraft.cc && `Cc: ${promptDraft.cc}`,
      promptDraft.subject && `Subject: ${promptDraft.subject}`,
      settings?.writingStyle?.trim() &&
        `User writing style:\n${settings.writingStyle.trim()}`,
      settings?.signature?.trim()
        ? `Configured signature:\n${settings.signature.trim()}`
        : "Configured signature: (none)",
      promptDraft.body && `Current draft:\n${promptDraft.body}`,
    ]
      .filter(Boolean)
      .join("\n");

    const draftContext = context || "(empty draft)";
    sendToAgent({
      message: generatePrompt.trim(),
      context: `The user is composing an email in Agent-Native Mail. Use the draft snapshot below as the source of truth, then update the existing draft by calling manage-draft with action "update", id "${activeId}", and the revised Markdown body. Do not only reply with the revised content; the Mail draft must be updated through the tool. Preserve recipients and subject unless the user explicitly asks to change them.\n\nDrafting rules:\n- Use the configured signature exactly when one is present, and do not duplicate it if it is already in the draft.\n- If no configured signature is present, do not invent or derive a sign-off from the user's name or email address.\n- Use Markdown only. Keep the copy natural, specific, and free of generic AI email filler unless the user asks for a formal template.\n\n${draftContext}`,
      submit: true,
    });

    setGeneratePrompt("");
    setGenerateOpen(false);
  };

  // Move a recipient chip between To/Cc/Bcc (drag-and-drop). The compose draft
  // owns all three fields, so it can remove from the source and add to the
  // target atomically.
  const moveRecipient = (
    value: string,
    from: RecipientField,
    to: RecipientField,
  ) => {
    if (!activeId || !activeDraft || from === to) return;
    const moved = computeRecipientMove(
      activeDraft[from] ?? "",
      activeDraft[to] ?? "",
      value,
    );
    const partial: Partial<ComposeState> = {};
    partial[from] = moved.from;
    partial[to] = moved.to;
    onUpdate(activeId, partial);
  };

  const handleAttachFiles = async (files: File[]) => {
    if (!activeId || !activeDraft || files.length === 0) return;
    try {
      const attachments = await uploadFiles(files);
      const existing = activeDraft.attachments ?? [];
      onUpdate(activeId, { attachments: [...existing, ...attachments] });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("mail.toasts.failedToAttachFile"),
      );
    }
  };

  const handleUploadImage = async (file: File) => {
    try {
      const result = await uploadFile(file);
      return result.url;
    } catch (err) {
      toast.error(t("mail.toasts.failedToUploadImage"));
      throw err;
    }
  };

  const handleAttach = async () => {
    const file = await openFilePicker("*/*");
    if (!file) return;
    await handleAttachFiles([file]);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    // All-image drops landing inside the editor are left alone here so
    // ComposeEditor's own handleDrop (bubble phase) can insert them inline;
    // everything else (non-image or mixed drops) still goes to attachments.
    const target = e.target as HTMLElement;
    const droppedOnEditor = target.closest(".compose-editor") != null;
    if (
      droppedOnEditor &&
      files.every((file) => file.type.startsWith("image/"))
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    void handleAttachFiles(files);
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    if (!activeId || !activeDraft) return;
    const existing = activeDraft.attachments ?? [];
    onUpdate(activeId, {
      attachments: existing.filter((a) => a.id !== attachmentId),
    });
  };

  const title = activeDraft
    ? activeDraft.queuedDraftId
      ? t("mail.compose.queuedDraft")
      : activeDraft.mode === "reply"
        ? t("mail.compose.reply")
        : activeDraft.mode === "forward"
          ? t("mail.compose.forward")
          : t("mail.compose.newMessage")
    : t("mail.compose.newMessage");

  const composeStyle = {
    right: isMobile ? 0 : sidebarRight,
    "--compose-right": `${isMobile ? 0 : sidebarRight}px`,
  } as CSSProperties & Record<"--compose-right", string>;

  return (
    <div
      ref={composeRef}
      className={cn(
        "compose-window fixed z-50 flex w-full flex-col bg-card sm:rounded-t-xl",
        minimized
          ? "bottom-0 h-11 rounded-t-xl sm:w-[540px]"
          : isExpanded
            ? "top-0 bottom-0 h-auto rounded-none sm:top-4 sm:bottom-4 sm:w-[min(960px,calc(100vw-var(--compose-right)-1rem))] sm:rounded-xl"
            : "bottom-0 h-[100dvh] sm:h-[min(540px,_calc(100dvh_-_2rem))] md:w-[min(490px,_calc(100vw_-_var(--compose-right)_-_1rem))] sm:rounded-xl",
      )}
      data-mail-compose
      style={composeStyle}
      onKeyDown={handleKeyDown}
      onDragOverCapture={handleDragOver}
      onDropCapture={handleDrop}
    >
      {/* Title bar with inline tabs */}
      <div className="flex h-11 shrink-0 items-center sm:rounded-t-xl px-2 gap-0">
        {/* Left side: tabs (or single title) */}
        <div className="flex flex-1 items-center min-w-0 overflow-x-auto hide-scrollbar gap-0.5">
          {drafts.length <= 1 ? (
            /* Single draft: just show the title */
            <span
              data-an-mask
              className="text-sm font-semibold text-foreground px-2 truncate"
            >
              {title}
            </span>
          ) : (
            /* Multiple drafts: show tabs */
            drafts.map((draft) => {
              const isActive = draft.id === activeId;
              const label =
                draft.subject?.trim() ||
                (draft.queuedDraftId
                  ? t("mail.compose.queuedDraft")
                  : draft.mode === "reply"
                    ? t("mail.compose.reply")
                    : draft.mode === "forward"
                      ? t("mail.compose.forward")
                      : t("mail.compose.newMessage"));
              return (
                <button
                  key={draft.id}
                  onClick={() => onSetActiveId(draft.id)}
                  className={cn(
                    "group flex items-center gap-1 rounded-md px-2 py-1 text-[12px] max-w-[140px] shrink-0 transition-colors",
                    isActive
                      ? "bg-accent/60 text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/30",
                  )}
                >
                  <span data-an-mask className="truncate">
                    {label}
                  </span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose(draft.id);
                    }}
                    className={cn(
                      "shrink-0 rounded-sm p-0.5 transition-colors",
                      isActive
                        ? "hover:bg-foreground/10"
                        : "opacity-0 group-hover:opacity-100 hover:bg-foreground/10",
                    )}
                  >
                    <IconX className="h-2.5 w-2.5" />
                  </span>
                </button>
              );
            })
          )}
          {/* + button: always visible, right after title/tabs */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t("mail.compose.newDraft")}
                onClick={onNewDraft}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent/30 transition-colors"
              >
                <IconPlus className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("mail.compose.newDraft")}</TooltipContent>
          </Tooltip>
        </div>

        {/* Right side: minimize & close */}
        <div className="flex items-center gap-1 shrink-0 ml-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                aria-label={
                  minimized
                    ? t("mail.compose.restoreCompose")
                    : t("mail.compose.minimizeCompose")
                }
                onClick={() => {
                  animateComposeLayout(() => {
                    setIsExpanded(false);
                    if (!minimized) setScheduleOpen(false);
                    setMinimized(!minimized);
                  });
                }}
              >
                <IconMinus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {minimized
                ? t("mail.compose.restore")
                : t("mail.compose.minimize")}
            </TooltipContent>
          </Tooltip>
          {!minimized && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  aria-label={
                    isExpanded
                      ? t("mail.compose.restoreComposeSize")
                      : t("mail.compose.fullScreenCompose")
                  }
                  aria-pressed={isExpanded}
                  onClick={() => {
                    animateComposeLayout(() => {
                      setMinimized(false);
                      setIsExpanded((value) => !value);
                    });
                  }}
                >
                  {isExpanded ? (
                    <IconArrowsMinimize className="h-3.5 w-3.5" />
                  ) : (
                    <IconArrowsMaximize className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isExpanded
                  ? t("mail.compose.restoreSize")
                  : t("mail.compose.fullScreen")}
              </TooltipContent>
            </Tooltip>
          )}
          <Button
            variant="ghost"
            size="icon"
            type="button"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={onCloseAll}
            aria-label={t("mail.compose.closeAllDrafts")}
          >
            <IconX className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {activeDraft && !minimized && (
        <>
          {/* Header fields */}
          <div className="border-b border-border">
            {allAccounts.length > 1 && (
              <FromAccountSelector
                accounts={allAccounts}
                value={activeDraft.accountEmail}
                label={t("mail.compose.from")}
                onChange={(email) =>
                  onUpdate(activeId!, { accountEmail: email })
                }
              />
            )}
            <ComposeFieldRow
              label={t("mail.compose.to")}
              trailing={
                <button
                  type="button"
                  aria-label={`${t("mail.draftQueue.cc")} / ${t("mail.draftQueue.bcc")}`}
                  aria-expanded={showCcBcc}
                  onClick={() => {
                    const next = !showCcBcc;
                    if (next) {
                      revealCcBcc();
                    } else {
                      setShowCcBcc(false);
                    }
                  }}
                  className="flex size-4 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                >
                  <IconChevronDown
                    className={cn(
                      "size-4 transition-transform",
                      showCcBcc && "rotate-180",
                    )}
                  />
                </button>
              }
            >
              <RecipientInput
                value={activeDraft.to}
                onChange={(val) => onUpdate(activeId!, { to: val })}
                autoFocus={activeDraft.mode === "compose"}
                ariaLabel={t("mail.compose.toRecipients")}
                field="to"
                onMoveRecipient={moveRecipient}
              />
            </ComposeFieldRow>

            {showCcBcc && (
              <>
                <ComposeFieldRow label={t("mail.compose.cc")}>
                  <RecipientInput
                    value={activeDraft.cc ?? ""}
                    onChange={(val) => onUpdate(activeId!, { cc: val })}
                    ariaLabel={t("mail.compose.ccRecipients")}
                    field="cc"
                    onMoveRecipient={moveRecipient}
                  />
                </ComposeFieldRow>
                <ComposeFieldRow label={t("mail.compose.bcc")}>
                  <RecipientInput
                    value={activeDraft.bcc ?? ""}
                    onChange={(val) => onUpdate(activeId!, { bcc: val })}
                    ariaLabel={t("mail.compose.bccRecipients")}
                    field="bcc"
                    onMoveRecipient={moveRecipient}
                  />
                </ComposeFieldRow>
              </>
            )}

            <div className="flex items-center px-4">
              <input
                type="text"
                value={activeDraft.subject}
                onChange={(e) =>
                  onUpdate(activeId!, { subject: e.target.value })
                }
                placeholder={t("mail.compose.subject")}
                className="flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {/* Body */}
          <ComposeBody
            activeDraft={activeDraft}
            activeId={activeId!}
            editorRef={editorRef}
            onUpdate={onUpdate}
            onFlush={onFlush}
            onClose={onClose}
            onSend={handleSend}
            isGenerating={isGenerating}
            sendToAgent={sendToAgent}
            setGenerateOpen={setGenerateOpen}
            showQuoted={showQuoted}
            setShowQuoted={setShowQuoted}
            signature={settings?.signature}
            autocompleteEnabled={settings?.autocompleteEnabled ?? false}
            onUploadImage={handleUploadImage}
          />

          {/* Attachments */}
          {activeDraft.attachments && activeDraft.attachments.length > 0 && (
            <AttachmentStrip
              attachments={activeDraft.attachments}
              onRemove={handleRemoveAttachment}
            />
          )}

          {/* Toolbar */}
          <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-2">
            <div className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label={t("mail.compose.bold")}
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => editorRef.current?.toggleBold()}
                  >
                    <IconBold className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("mail.compose.bold")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label={t("mail.compose.italic")}
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => editorRef.current?.toggleItalic()}
                  >
                    <IconItalic className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("mail.compose.italic")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label={t("mail.compose.insertLink")}
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => editorRef.current?.setLink()}
                  >
                    <IconLink className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("mail.compose.insertLink")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label={t("mail.compose.attachFile")}
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => void handleAttach()}
                  >
                    <IconPaperclip className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("mail.compose.attachFile")}</TooltipContent>
              </Tooltip>

              <div className="mx-1 h-4 w-px bg-border" />

              {isGenerating ? (
                <div className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{t("mail.compose.generating")}</span>
                </div>
              ) : (
                <Popover open={generateOpen} onOpenChange={setGenerateOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 px-2 text-xs"
                    >
                      {t("mail.compose.generate")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" className="w-80 p-3">
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-medium text-muted-foreground">
                        {t("mail.compose.agentPromptLabel")}
                      </label>
                      <textarea
                        ref={promptRef}
                        value={generatePrompt}
                        onChange={(e) => setGeneratePrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void handleGenerate();
                          }
                          if (e.key === "Escape") {
                            e.stopPropagation();
                            setGenerateOpen(false);
                          }
                        }}
                        placeholder={t("mail.compose.agentPromptPlaceholder")}
                        className="min-h-[60px] w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                        autoFocus
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">
                          <kbd className="kbd-hint">↵</kbd>{" "}
                          {t("mail.compose.toSubmit")}
                        </span>
                        <Button
                          size="sm"
                          onClick={handleGenerate}
                          disabled={!generatePrompt.trim()}
                          className="h-7 gap-1.5 px-3 text-xs"
                        >
                          {t("mail.compose.generate")}
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("mail.compose.deleteDraft")}
                    onClick={() => activeId && onDiscard(activeId)}
                    className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground/40 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                  >
                    <IconTrash className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("mail.compose.deleteDraft")}</TooltipContent>
              </Tooltip>
              <SendLaterButton
                onSend={handleSend}
                onSendLater={handleSendLater}
                open={scheduleOpen}
                onOpenChange={setScheduleOpen}
                isSending={sendEmail.isPending}
                isScheduling={scheduleEmail.isPending}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Compose body area — splits quoted history from editable content.
 * Shows "..." toggle for quoted content in reply/forward mode.
 */
function ComposeBody({
  activeDraft,
  activeId,
  editorRef,
  onUpdate,
  onFlush,
  onClose,
  onSend,
  isGenerating,
  sendToAgent,
  setGenerateOpen,
  showQuoted,
  setShowQuoted,
  signature,
  autocompleteEnabled,
  onUploadImage,
}: {
  activeDraft: ComposeState;
  activeId: string;
  editorRef: React.RefObject<ComposeEditorHandle | null>;
  onUpdate: (id: string, partial: Partial<ComposeState>) => void;
  onFlush: (id: string) => Promise<unknown> | undefined;
  onClose: (id: string) => void;
  onSend: (markDone?: boolean) => void;
  isGenerating: boolean;
  sendToAgent: (opts: {
    message: string;
    context?: string;
    submit?: boolean;
  }) => void;
  setGenerateOpen: (open: boolean) => void;
  showQuoted: boolean;
  setShowQuoted: (show: boolean) => void;
  signature?: string;
  autocompleteEnabled: boolean;
  onUploadImage: (file: File) => Promise<string>;
}) {
  const t = useT();
  const [editableContent, quotedContent] = useMemo(
    () => splitQuotedContent(activeDraft.body),
    [activeDraft.body],
  );
  const [messageContent, appendedSignature] = useMemo(
    () =>
      activeDraft.mode === "reply"
        ? splitAppendedSignature(editableContent, signature)
        : [editableContent, ""],
    [activeDraft.mode, editableContent, signature],
  );

  // Store quoted content in a ref so the onChange handler always has the latest
  const quotedRef = useRef(quotedContent);
  quotedRef.current = quotedContent;
  const appendedSignatureRef = useRef(appendedSignature);
  appendedSignatureRef.current = appendedSignature;

  const hasQuote = quotedContent.length > 0;
  const editorContent = appendedSignature
    ? messageContent
    : hasQuote
      ? editableContent
      : activeDraft.body;

  return (
    <div
      className="flex-1 overflow-y-auto px-4 py-3 cursor-text"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          editorRef.current?.getEditor()?.commands.focus("end");
        }
      }}
    >
      <ComposeEditor
        ref={editorRef}
        content={editorContent}
        onChange={(md) => {
          if (appendedSignatureRef.current) {
            onUpdate(activeId, {
              body: appendSignatureToBody(
                md + quotedRef.current,
                appendedSignatureRef.current,
              ),
            });
          } else if (hasQuote) {
            onUpdate(activeId, { body: md + quotedRef.current });
          } else {
            onUpdate(activeId, { body: md });
          }
        }}
        onGenerate={() => setGenerateOpen(true)}
        onSend={onSend}
        onClose={() => onClose(activeId)}
        onFlush={() => onFlush(activeId)}
        isGenerating={isGenerating}
        autocompleteEnabled={autocompleteEnabled}
        draftId={activeId}
        getCurrentDraftBody={(editor) =>
          getCurrentDraftBodyFromEditor({
            draft: activeDraft,
            editor,
            signature,
          })
        }
        sendToAgent={sendToAgent}
        onUploadImage={onUploadImage}
      />
      {hasQuote && (
        <>
          <button
            type="button"
            aria-label={
              showQuoted
                ? t("mail.thread.hideQuotedText")
                : t("mail.thread.showQuotedText")
            }
            onClick={() => setShowQuoted(!showQuoted)}
            className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-accent hover:text-muted-foreground"
          >
            <IconDots className="h-4 w-4" />
          </button>
          {showQuoted && (
            <pre className="mt-2 whitespace-pre-wrap text-[13px] text-muted-foreground/60 font-sans leading-relaxed">
              {quotedContent.trim()}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
