import { useState, useEffect, useRef, useMemo } from "react";
import {
  IconX,
  IconMinus,
  IconBold,
  IconItalic,
  IconLink,
  IconPaperclip,
  IconChevronDown,
  IconLoader2,
  IconTrash,
  IconPlus,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSendEmail, useAddOptimisticReply } from "@/hooks/use-emails";
import { useAliases } from "@/hooks/use-aliases";
import { useScheduleEmail } from "@/hooks/use-scheduled-jobs";
import { SendLaterButton } from "./SendLaterButton";
import { expandAliasTokens } from "@/lib/alias-utils";
import { useAgentChatGenerating } from "@agent-native/core";
import { toast } from "sonner";
import type { ComposeState } from "@shared/types";
import { RecipientInput } from "./RecipientInput";
import { ComposeEditor, type ComposeEditorHandle } from "./ComposeEditor";
import { openFilePicker, uploadFile, formatFileSize } from "@/lib/upload";
import type { ComposeAttachment } from "@shared/types";
import { useAccountFilter } from "@/hooks/use-account-filter";

/**
 * Split a compose body into the editable portion and the quoted history.
 * Returns [editable, quoted] — quoted is empty string when there's no quote.
 */
function splitQuotedContent(body: string): [string, string] {
  // Match "— On ..., ... wrote:" (reply) or "— Forwarded message —" (forward)
  const replyMatch = body.match(/\n*— On .+? wrote:\n/);
  const fwdMatch = body.match(/\n*— Forwarded message —\n/);

  const match = replyMatch || fwdMatch;
  if (!match || match.index === undefined) return [body, ""];

  const editable = body.slice(0, match.index);
  const quoted = body.slice(match.index);
  return [editable, quoted];
}

const LAST_SEND_ACCOUNT_KEY = "mail:lastSendAccount";

function FromAccountSelector({
  accounts,
  value,
  onChange,
}: {
  accounts: Array<{ email: string }>;
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
      <select
        value={resolvedValue}
        onChange={(e) => {
          const email = e.target.value;
          localStorage.setItem(LAST_SEND_ACCOUNT_KEY, email);
          onChange(email);
        }}
        className="flex-1 bg-transparent py-2 text-sm outline-none text-foreground cursor-pointer"
      >
        {accounts.map((acct) => (
          <option key={acct.email} value={acct.email}>
            {acct.email}
          </option>
        ))}
      </select>
    </div>
  );
}

interface ComposeModalProps {
  drafts: ComposeState[];
  activeId: string | null;
  activeDraft: ComposeState | null;
  onSetActiveId: (id: string) => void;
  onUpdate: (id: string, partial: Partial<ComposeState>) => void;
  onClose: (id: string) => void;
  onCloseAll: () => void;
  onDiscard: (id: string) => void;
  onNewDraft: () => void;
  onFlush: (id: string) => Promise<unknown> | undefined;
  onReopen: (state: Omit<ComposeState, "id">) => void;
}

export function ComposeModal({
  drafts,
  activeId,
  activeDraft,
  onSetActiveId,
  onUpdate,
  onClose,
  onCloseAll,
  onDiscard,
  onNewDraft,
  onFlush,
  onReopen,
}: ComposeModalProps) {
  const isMobile = useIsMobile();
  const [minimized, setMinimized] = useState(false);
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
  const scheduleEmail = useScheduleEmail();
  const { data: aliases = [] } = useAliases();
  const { allAccounts } = useAccountFilter();
  const editorRef = useRef<ComposeEditorHandle>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);

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

  const handleSend = async () => {
    if (!activeDraft || !activeId) return;
    if (sendingRef.current) return;
    if (!activeDraft.to.trim()) {
      toast.error("Please add at least one recipient");
      return;
    }
    sendingRef.current = true;

    // Snapshot draft data for potential undo
    const draftSnapshot = { ...activeDraft };
    const { savedDraftId } = activeDraft;

    // Close composer immediately
    onDiscard(activeId);

    // Clean up any persistent draft
    if (savedDraftId) {
      fetch(`/api/emails/draft/${savedDraftId}`, { method: "DELETE" });
    }

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
        })
      : undefined;

    let cancelled = false;

    const handleUndo = () => {
      if (cancelled) return;
      cancelled = true;
      sendingRef.current = false;
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
      sendingRef.current = false;
      toast.dismiss(toastId);
      sendEmail.mutate(
        {
          to: expandAliasTokens(draftSnapshot.to, aliases),
          cc: expandAliasTokens(draftSnapshot.cc ?? "", aliases) || undefined,
          bcc: expandAliasTokens(draftSnapshot.bcc ?? "", aliases) || undefined,
          subject: draftSnapshot.subject,
          body: draftSnapshot.body,
          replyToId: draftSnapshot.replyToId,
          accountEmail: draftSnapshot.accountEmail,
        },
        {
          onError: () => {
            toast.error("Failed to send email");
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
      toast.error("Please add at least one recipient");
      return;
    }

    const draftSnapshot = { ...activeDraft };
    const { savedDraftId } = activeDraft;

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
        runAt,
      });

      // Job created successfully — now discard the draft
      onDiscard(activeId);
      if (savedDraftId) {
        fetch(`/api/emails/draft/${savedDraftId}`, { method: "DELETE" });
      }

      const scheduledDate = new Date(runAt).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      toast(`Scheduled for ${scheduledDate}`);
    } catch {
      toast.error("Failed to schedule email — draft kept open");
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

    // Flush current state to file so agent can read it
    await onFlush(activeId);

    const context = [
      activeDraft.to && `To: ${activeDraft.to}`,
      activeDraft.cc && `Cc: ${activeDraft.cc}`,
      activeDraft.subject && `Subject: ${activeDraft.subject}`,
      activeDraft.body && `Current draft:\n${activeDraft.body}`,
    ]
      .filter(Boolean)
      .join("\n");

    sendToAgent({
      message: generatePrompt.trim(),
      context: `The user is composing an email. The current draft is saved in application-state/compose-${activeId}.json.\n\nIMPORTANT: Update this EXISTING file (compose-${activeId}.json) — do NOT create a new compose file. Read it first, then write back to the same file with your changes.\n\n${context || "(empty draft)"}`,
      submit: true,
    });

    setGeneratePrompt("");
    setGenerateOpen(false);
  };

  const handleAttach = async () => {
    if (!activeId || !activeDraft) return;
    const file = await openFilePicker("*/*");
    if (!file) return;
    try {
      const result = await uploadFile(file);
      const attachment: ComposeAttachment = {
        id: result.filename,
        filename: result.filename,
        originalName: result.originalName,
        mimeType: result.mimeType,
        size: result.size,
        url: result.url,
      };
      const existing = activeDraft.attachments ?? [];
      onUpdate(activeId, { attachments: [...existing, attachment] });
    } catch {
      toast.error("Failed to attach file");
    }
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    if (!activeId || !activeDraft) return;
    const existing = activeDraft.attachments ?? [];
    onUpdate(activeId, {
      attachments: existing.filter((a) => a.id !== attachmentId),
    });
  };

  const title = activeDraft
    ? activeDraft.mode === "reply"
      ? "Reply"
      : activeDraft.mode === "forward"
        ? "Forward"
        : "New message"
    : "New message";

  return (
    <div
      ref={composeRef}
      className={cn(
        "compose-window fixed bottom-0 z-50 flex w-full sm:w-[540px] flex-col sm:rounded-t-xl bg-card",
        minimized ? "h-11 rounded-t-xl" : "h-[100dvh] sm:h-[520px]",
      )}
      style={{ right: isMobile ? 0 : sidebarRight }}
      onKeyDown={handleKeyDown}
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
                (draft.mode === "reply"
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
          <button
            onClick={onNewDraft}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent/30 transition-colors"
            title="New draft"
          >
            <IconPlus className="h-3 w-3" />
          </button>
        </div>

        {/* Right side: minimize & close */}
        <div className="flex items-center gap-1 shrink-0 ml-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setMinimized(!minimized)}
          >
            <IconMinus className="h-3.5 w-3.5" />
          </Button>
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
              />
              <button
                tabIndex={-1}
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
                  />
                </div>
                <div className="flex items-center border-b border-border px-4">
                  <span className="w-8 shrink-0 text-xs font-medium text-muted-foreground">
                    Bcc
                  </span>
                  <RecipientInput
                    value={activeDraft.bcc ?? ""}
                    onChange={(val) => onUpdate(activeId!, { bcc: val })}
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
                placeholder="Subject"
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
          />

          {/* Attachments */}
          {activeDraft.attachments && activeDraft.attachments.length > 0 && (
            <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-border px-3 py-2">
              {activeDraft.attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs"
                >
                  <IconPaperclip className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="truncate max-w-[140px]">
                    {att.originalName}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {formatFileSize(att.size)}
                  </span>
                  <button
                    onClick={() => handleRemoveAttachment(att.id)}
                    className="ml-0.5 rounded-sm p-0.5 text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors"
                  >
                    <IconX className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
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
                <TooltipContent>Bold</TooltipContent>
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
                <TooltipContent>Italic</TooltipContent>
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
                <TooltipContent>Insert link</TooltipContent>
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
                <TooltipContent>Attach file</TooltipContent>
              </Tooltip>

              <div className="mx-1 h-4 w-px bg-border" />

              {isGenerating ? (
                <div className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Generating…</span>
                </div>
              ) : (
                <Popover open={generateOpen} onOpenChange={setGenerateOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 px-2 text-xs"
                    >
                      Generate
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" className="w-80 p-3">
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-medium text-muted-foreground">
                        What should the agent write?
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
                        placeholder="e.g. Write a polite follow-up..."
                        className="min-h-[60px] w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                        autoFocus
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">
                          <kbd className="kbd-hint">↵</kbd> to submit
                        </span>
                        <Button
                          size="sm"
                          onClick={handleGenerate}
                          disabled={!generatePrompt.trim()}
                          className="h-7 gap-1.5 px-3 text-xs"
                        >
                          Generate
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => onDiscard(activeId)}
                className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground/40 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                title="Delete draft"
              >
                <IconTrash className="h-4 w-4" />
              </button>
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
}) {
  const [editableContent, quotedContent] = useMemo(
    () => splitQuotedContent(activeDraft.body),
    [activeDraft.body],
  );

  // Store quoted content in a ref so the onChange handler always has the latest
  const quotedRef = useRef(quotedContent);
  quotedRef.current = quotedContent;

  const hasQuote = quotedContent.length > 0;

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
        content={hasQuote ? editableContent : activeDraft.body}
        onChange={(md) => {
          if (hasQuote) {
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
        sendToAgent={sendToAgent}
      />
      {hasQuote && (
        <>
          <button
            type="button"
            onClick={() => setShowQuoted(!showQuoted)}
            className="mt-1 text-muted-foreground/50 hover:text-muted-foreground text-[13px] tracking-[0.15em] transition-colors"
          >
            ···
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
