import { useAgentChatGenerating, useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
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
import { useState, useEffect, useRef, useMemo } from "react";
import type { CSSProperties } from "react";
import { toast } from "sonner";

import { useAccountFilter } from "@/hooks/use-account-filter";
import { useAliases } from "@/hooks/use-aliases";
import { useUpdateQueuedDraft } from "@/hooks/use-draft-queue";
import { useSendEmail, useAddOptimisticReply } from "@/hooks/use-emails";
import { useSettings } from "@/hooks/use-emails";
import { useIsMobile } from "@/hooks/use-mobile";
import { useScheduleEmail } from "@/hooks/use-scheduled-jobs";
import { canUseAgentGenerate } from "@/lib/agent-generate";
import { expandAliasTokens } from "@/lib/alias-utils";
import { openFilePicker, uploadFiles } from "@/lib/upload";
import { cn } from "@/lib/utils";

import { AttachmentStrip } from "./AttachmentStrip";
import {
  getCurrentDraftBodyFromEditor,
  splitQuotedContent,
} from "./compose-draft-context";
import { ComposeEditor, type ComposeEditorHandle } from "./ComposeEditor";
import {
  RecipientInput,
  computeRecipientMove,
  type RecipientField,
} from "./RecipientInput";
import { SendLaterButton } from "./SendLaterButton";

const LAST_SEND_ACCOUNT_KEY = "mail:lastSendAccount";

function FromAccountSelector({
  accounts,
  value,
  onChange,
}: {
  accounts: Array<{ email: string; displayName?: string }>;
  value: string | undefined;
  onChange: (email: string) => void;
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

  // Sync the sticky default into the draft if it wasn't set
  useEffect(() => {
    if (!value && resolvedValue) {
      onChange(resolvedValue);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex items-center border-b border-border px-4">
      <span className="w-8 shrink-0 text-xs font-medium text-muted-foreground">
        From
      </span>
      <Select
        value={resolvedValue}
        onValueChange={(email) => {
          localStorage.setItem(LAST_SEND_ACCOUNT_KEY, email);
          onChange(email);
        }}
      >
        <SelectTrigger className="flex-1 border-0 bg-transparent py-2 text-sm shadow-none focus:ring-0 h-auto px-0 cursor-pointer">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((acct) => (
            <SelectItem key={acct.email} value={acct.email}>
              {acct.displayName
                ? `${acct.displayName} <${acct.email}>`
                : acct.email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
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
  onNewDraft: () => void;
  onFlush: (id: string) => Promise<unknown> | undefined;
  onReopen: (state: Omit<ComposeState, "id">) => void;
  onInitialExpandedConsumed?: () => void;
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
  onNewDraft,
  onFlush,
  onReopen,
  onInitialExpandedConsumed,
}: ComposeModalProps) {
  const t = useT();
  const isMobile = useIsMobile();
  const [minimized, setMinimized] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [showQuoted, setShowQuoted] = useState(false);

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
  const updateQueuedDraft = useUpdateQueuedDraft();
  const scheduleEmail = useScheduleEmail();
  const { data: aliases = [] } = useAliases();
  const { data: settings } = useSettings();
  const { allAccounts } = useAccountFilter();
  const editorRef = useRef<ComposeEditorHandle>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const sendingIdsRef = useRef<Set<string>>(new Set());

  // Reset CC/BCC visibility and quote expansion when switching tabs
  useEffect(() => {
    setShowCcBcc(false);
    setShowQuoted(false);
  }, [activeId]);

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

  const handleSend = async () => {
    if (!activeDraft || !activeId) return;
    if (sendingIdsRef.current.has(activeId)) return;
    if (!activeDraft.to.trim()) {
      toast.error(t("mail.toasts.pleaseAddRecipient"));
      return;
    }
    sendingIdsRef.current.add(activeId);
    const sendingId = activeId;

    // Snapshot draft data for potential undo
    const draftSnapshot = { ...activeDraft };

    // Close composer immediately
    onDiscard(activeId);

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

    const handleUndo = () => {
      if (cancelled) return;
      cancelled = true;
      sendingIdsRef.current.delete(sendingId);
      clearTimeout(sendTimer);
      clearTimeout(transitionTimer);
      toast.dismiss(toastId);
      undoOptimistic?.();
      // Reopen composer with the saved draft
      const { id: _id, ...reopenData } = draftSnapshot;
      onReopen(reopenData);
    };

    // Show "Sending..." toast with undo
    const toastId = toast("Sending...", {
      action: { label: "UNDO", onClick: handleUndo },
      duration: Infinity,
    });

    // After 1.5s, transition to "Message sent."
    const transitionTimer = setTimeout(() => {
      if (cancelled) return;
      toast("Message sent.", {
        id: toastId,
        action: { label: "UNDO", onClick: handleUndo },
        duration: Infinity,
      });
    }, 1500);

    // After 5s, actually send the email
    const sendTimer = setTimeout(() => {
      if (cancelled) return;
      sendingIdsRef.current.delete(sendingId);
      toast.dismiss(toastId);
      sendEmail.mutate(
        {
          to: expandAliasTokens(draftSnapshot.to, aliases),
          cc: expandAliasTokens(draftSnapshot.cc ?? "", aliases) || undefined,
          bcc: expandAliasTokens(draftSnapshot.bcc ?? "", aliases) || undefined,
          subject: draftSnapshot.subject,
          body: draftSnapshot.body,
          replyToId: draftSnapshot.replyToId,
          replyToThreadId: draftSnapshot.replyToThreadId,
          accountEmail: draftSnapshot.accountEmail,
          attachments: draftSnapshot.attachments,
        },
        {
          onSuccess: (result) => {
            if (draftSnapshot.queuedDraftId) {
              updateQueuedDraft.mutate({
                id: draftSnapshot.queuedDraftId,
                status: "sent",
                sentMessageId: result?.id,
              });
            }
          },
          onError: () => {
            toast.error(t("mail.toasts.failedToSendEmail"));
            // Reopen composer on failure
            const { id: _id, ...reopenData } = draftSnapshot;
            onReopen(reopenData);
          },
        },
      );
    }, 5000);
  };

  const handleSendLater = async (runAt: number) => {
    if (!activeDraft || !activeId) return;
    if (!activeDraft.to.trim()) {
      toast.error(t("mail.toasts.pleaseAddRecipient"));
      return;
    }

    const draftSnapshot = { ...activeDraft };

    try {
      await scheduleEmail.mutateAsync({
        to: expandAliasTokens(draftSnapshot.to, aliases),
        cc: expandAliasTokens(draftSnapshot.cc ?? "", aliases) || undefined,
        bcc: expandAliasTokens(draftSnapshot.bcc ?? "", aliases) || undefined,
        subject: draftSnapshot.subject,
        body: draftSnapshot.body,
        replyToId: draftSnapshot.replyToId,
        threadId: draftSnapshot.replyToThreadId,
        accountEmail: draftSnapshot.accountEmail,
        attachments: draftSnapshot.attachments,
        runAt,
      });

      // Job created successfully — now discard the draft
      onDiscard(activeId);

      const scheduledDate = new Date(runAt).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      toast(`Scheduled for ${scheduledDate}`);
    } catch {
      toast.error(t("mail.toasts.failedToScheduleEmailDraftKeptOpen"));
    }
  };

  const composeRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Only handle shortcuts for events originating within the compose window
    // (prevents agent chat Cmd+Enter from triggering email send)
    if (!composeRef.current?.contains(e.target as Node)) return;

    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
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
    } catch {
      toast.error(t("mail.toasts.failedToAttachFile"));
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
      ? "Queued draft"
      : activeDraft.mode === "reply"
        ? "Reply"
        : activeDraft.mode === "forward"
          ? "Forward"
          : "New message"
    : "New message";

  const composeStyle = {
    right: isMobile ? 0 : sidebarRight,
    "--compose-right": `${isMobile ? 0 : sidebarRight}px`,
  } as CSSProperties & Record<"--compose-right", string>;

  return (
    <div
      ref={composeRef}
      className={cn(
        "compose-window fixed z-50 flex w-full flex-col bg-card transition-[width,height,top,bottom] duration-150 sm:rounded-t-xl",
        minimized
          ? "bottom-0 h-11 rounded-t-xl sm:w-[540px]"
          : isExpanded
            ? "top-0 bottom-0 h-auto rounded-none sm:top-4 sm:bottom-4 sm:w-[min(960px,calc(100vw-var(--compose-right)-1rem))] sm:rounded-xl"
            : "bottom-0 h-[100dvh] sm:h-[520px] sm:w-[540px]",
      )}
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
            <span className="text-sm font-semibold text-foreground px-2 truncate">
              {title}
            </span>
          ) : (
            /* Multiple drafts: show tabs */
            drafts.map((draft) => {
              const isActive = draft.id === activeId;
              const label =
                draft.subject?.trim() ||
                (draft.queuedDraftId
                  ? "Queued draft"
                  : draft.mode === "reply"
                    ? "Reply"
                    : draft.mode === "forward"
                      ? "Forward"
                      : "New message");
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
                  <span className="truncate">{label}</span>
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
                className="h-7 w-7"
                aria-label={
                  minimized
                    ? t("mail.compose.restoreCompose")
                    : t("mail.compose.minimizeCompose")
                }
                onClick={() => {
                  setIsExpanded(false);
                  setMinimized(!minimized);
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
                  className="h-7 w-7"
                  aria-label={
                    isExpanded
                      ? t("mail.compose.restoreComposeSize")
                      : t("mail.compose.fullScreenCompose")
                  }
                  aria-pressed={isExpanded}
                  onClick={() => {
                    setMinimized(false);
                    setIsExpanded((value) => !value);
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
            className="h-7 w-7"
            onClick={onCloseAll}
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
                onChange={(email) =>
                  onUpdate(activeId!, { accountEmail: email })
                }
              />
            )}
            <div className="flex items-center border-b border-border px-4">
              <span className="w-8 shrink-0 text-xs font-medium text-muted-foreground">
                To
              </span>
              <RecipientInput
                value={activeDraft.to}
                onChange={(val) => onUpdate(activeId!, { to: val })}
                autoFocus={activeDraft.mode === "compose"}
                field="to"
                onMoveRecipient={moveRecipient}
              />
              <button
                onClick={() => {
                  const next = !showCcBcc;
                  setShowCcBcc(next);
                  if (next) {
                    if (activeDraft.cc === undefined)
                      onUpdate(activeId!, { cc: "" });
                    if (activeDraft.bcc === undefined)
                      onUpdate(activeId!, { bcc: "" });
                  }
                }}
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
              >
                <IconChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform",
                    showCcBcc && "rotate-180",
                  )}
                />
              </button>
            </div>

            {showCcBcc && (
              <>
                <div className="flex items-center border-b border-border px-4">
                  <span className="w-8 shrink-0 text-xs font-medium text-muted-foreground">
                    Cc
                  </span>
                  <RecipientInput
                    value={activeDraft.cc ?? ""}
                    onChange={(val) => onUpdate(activeId!, { cc: val })}
                    field="cc"
                    onMoveRecipient={moveRecipient}
                  />
                </div>
                <div className="flex items-center border-b border-border px-4">
                  <span className="w-8 shrink-0 text-xs font-medium text-muted-foreground">
                    Bcc
                  </span>
                  <RecipientInput
                    value={activeDraft.bcc ?? ""}
                    onChange={(val) => onUpdate(activeId!, { bcc: val })}
                    field="bcc"
                    onMoveRecipient={moveRecipient}
                  />
                </div>
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
                    className="h-7 w-7"
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
                    className="h-7 w-7"
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
                    className="h-7 w-7"
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
                    className="h-7 w-7"
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
                            handleGenerate();
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
                disabled={!activeDraft.to.trim()}
                isSending={sendEmail.isPending}
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
}: {
  activeDraft: ComposeState;
  activeId: string;
  editorRef: React.RefObject<ComposeEditorHandle | null>;
  onUpdate: (id: string, partial: Partial<ComposeState>) => void;
  onFlush: (id: string) => Promise<unknown> | undefined;
  onClose: (id: string) => void;
  onSend: () => void;
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
        draftId={activeId}
        getCurrentDraftBody={(editor) =>
          getCurrentDraftBodyFromEditor({
            draft: activeDraft,
            editor,
            signature,
          })
        }
        sendToAgent={sendToAgent}
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
