import {
  useState,
  useRef,
  useMemo,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  IconSend,
  IconBold,
  IconItalic,
  IconLink,
  IconPaperclip,
  IconLoader2,
  IconX,
  IconTrash,
  IconExternalLink,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSendEmail, useAddOptimisticReply } from "@/hooks/use-emails";
import { useAliases } from "@/hooks/use-aliases";
import { expandAliasTokens } from "@/lib/alias-utils";
import { useAgentChatGenerating } from "@agent-native/core";
import { toast } from "sonner";
import type {
  ComposeState,
  EmailMessage,
  ComposeAttachment,
} from "@shared/types";
import { RecipientInput } from "./RecipientInput";
import { ComposeEditor, type ComposeEditorHandle } from "./ComposeEditor";
import { openFilePicker, uploadFile, formatFileSize } from "@/lib/upload";

function splitQuotedContent(body: string): [string, string] {
  const replyMatch = body.match(/\n*— On .+? wrote:\n/);
  const fwdMatch = body.match(/\n*— Forwarded message —\n/);
  const match = replyMatch || fwdMatch;
  if (!match || match.index === undefined) return [body, ""];
  return [body.slice(0, match.index), body.slice(match.index)];
}

export interface InlineReplyHandle {
  focusEditor: () => void;
}

interface InlineReplyComposerProps {
  draft: ComposeState;
  messages: EmailMessage[];
  onUpdate: (id: string, partial: Partial<ComposeState>) => void;
  onDiscard: (id: string) => void;
  onClose: (id: string) => void;
  onPopOut: (id: string) => void;
  onFlush: (id: string) => Promise<unknown> | undefined;
  onReopen: (state: Omit<ComposeState, "id">) => void;
}

export const InlineReplyComposer = forwardRef<
  InlineReplyHandle,
  InlineReplyComposerProps
>(function InlineReplyComposer(
  {
    draft,
    messages,
    onUpdate,
    onDiscard,
    onClose,
    onPopOut,
    onFlush,
    onReopen,
  },
  ref,
) {
  const [showQuoted, setShowQuoted] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [isGenerating, sendToAgent] = useAgentChatGenerating();
  const sendEmail = useSendEmail();
  const addOptimisticReply = useAddOptimisticReply();
  const { data: aliases = [] } = useAliases();
  const editorRef = useRef<ComposeEditorHandle>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    focusEditor: () => {
      editorRef.current?.getEditor()?.commands.focus();
    },
  }));

  // Auto-focus editor and scroll into view on mount
  useEffect(() => {
    setTimeout(() => {
      editorRef.current?.getEditor()?.commands.focus();
      composerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }, 100);
  }, []);

  // Resolve recipient display names from thread messages
  const recipientDisplay = useMemo(() => {
    const emails = draft.to
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    return emails
      .map((email) => {
        const lower = email.toLowerCase();
        // Check senders
        const senderMsg = messages.find(
          (m) => m.from.email.toLowerCase() === lower,
        );
        if (
          senderMsg?.from.name &&
          senderMsg.from.name !== senderMsg.from.email
        )
          return senderMsg.from.name;
        // Check recipients
        for (const m of messages) {
          const r = [...m.to, ...(m.cc || [])].find(
            (r) => r.email.toLowerCase() === lower,
          );
          if (r?.name && r.name !== r.email) return r.name;
        }
        return email;
      })
      .join(", ");
  }, [draft.to, messages]);

  // Split quoted content
  const [editableContent, quotedContent] = useMemo(
    () => splitQuotedContent(draft.body),
    [draft.body],
  );
  const quotedRef = useRef(quotedContent);
  quotedRef.current = quotedContent;
  const hasQuote = quotedContent.length > 0;

  const handleSend = async () => {
    if (!draft.to.trim()) {
      toast.error("Please add at least one recipient");
      return;
    }

    const draftSnapshot = { ...draft };
    const { savedDraftId } = draft;

    onDiscard(draft.id);

    if (savedDraftId) {
      fetch(`/api/emails/draft/${savedDraftId}`, { method: "DELETE" });
    }

    // Show optimistic reply in the thread immediately
    const undoOptimistic = addOptimisticReply({
      to: expandAliasTokens(draftSnapshot.to, aliases),
      cc: expandAliasTokens(draftSnapshot.cc ?? "", aliases) || undefined,
      subject: draftSnapshot.subject,
      body: draftSnapshot.body,
      replyToId: draftSnapshot.replyToId,
      replyToThreadId: draftSnapshot.replyToThreadId,
      accountEmail: draftSnapshot.accountEmail,
    });

    let cancelled = false;

    const handleUndo = () => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(sendTimer);
      clearTimeout(transitionTimer);
      toast.dismiss(toastId);
      undoOptimistic?.();
      const { id: _id, ...reopenData } = draftSnapshot;
      onReopen(reopenData);
    };

    const toastId = toast("Sending...", {
      action: { label: "UNDO", onClick: handleUndo },
      duration: Infinity,
    });

    const transitionTimer = setTimeout(() => {
      if (cancelled) return;
      toast("Message sent.", {
        id: toastId,
        action: { label: "UNDO", onClick: handleUndo },
        duration: Infinity,
      });
    }, 1500);

    const sendTimer = setTimeout(() => {
      if (cancelled) return;
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
            const { id: _id, ...reopenData } = draftSnapshot;
            onReopen(reopenData);
          },
        },
      );
    }, 5000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!composerRef.current?.contains(e.target as Node)) return;
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose(draft.id);
    }
  };

  const handleGenerate = async () => {
    if (!generatePrompt.trim()) return;
    await onFlush(draft.id);
    const context = [
      draft.to && `To: ${draft.to}`,
      draft.cc && `Cc: ${draft.cc}`,
      draft.subject && `Subject: ${draft.subject}`,
      draft.body && `Current draft:\n${draft.body}`,
    ]
      .filter(Boolean)
      .join("\n");
    sendToAgent({
      message: generatePrompt.trim(),
      context: `The user is composing an email reply. The current draft is saved in application-state/compose-${draft.id}.json.\n\nIMPORTANT: Update this EXISTING file (compose-${draft.id}.json) — do NOT create a new compose file. Read it first, then write back to the same file with your changes.\n\n${context || "(empty draft)"}`,
      submit: true,
    });
    setGeneratePrompt("");
    setGenerateOpen(false);
  };

  const handleAttach = async () => {
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
      const existing = draft.attachments ?? [];
      onUpdate(draft.id, { attachments: [...existing, attachment] });
    } catch {
      toast.error("Failed to attach file");
    }
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    const existing = draft.attachments ?? [];
    onUpdate(draft.id, {
      attachments: existing.filter((a) => a.id !== attachmentId),
    });
  };

  return (
    <div
      ref={composerRef}
      className="rounded-lg bg-card dark:bg-[hsl(220,5%,10%)] overflow-hidden"
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      {draft.mode === "forward" ? (
        <>
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <span className="text-[13px] font-semibold text-green-400">
              Forward
            </span>
            <button
              onClick={() => onPopOut(draft.id)}
              className="flex h-9 w-9 sm:h-6 sm:w-6 items-center justify-center rounded text-muted-foreground/40 hover:text-foreground transition-colors"
              title="Pop out to compose window"
            >
              <IconExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-center border-b border-border/30 px-4 pb-2">
            <span className="w-8 shrink-0 text-xs font-medium text-muted-foreground">
              To
            </span>
            <RecipientInput
              value={draft.to}
              onChange={(val) => onUpdate(draft.id, { to: val })}
              autoFocus
            />
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[13px] font-semibold text-green-400">
              Draft
            </span>
            <span className="text-[13px] text-muted-foreground/70 truncate">
              to {recipientDisplay}
            </span>
          </div>
          <button
            onClick={() => onPopOut(draft.id)}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/40 hover:text-foreground transition-colors shrink-0"
            title="Pop out to compose window"
          >
            <IconExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Body */}
      <div
        className="px-4 pb-2 min-h-[80px] cursor-text"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            editorRef.current?.getEditor()?.commands.focus("end");
          }
        }}
      >
        <ComposeEditor
          ref={editorRef}
          content={hasQuote ? editableContent : draft.body}
          onChange={(md) => {
            if (hasQuote) {
              onUpdate(draft.id, { body: md + quotedRef.current });
            } else {
              onUpdate(draft.id, { body: md });
            }
          }}
          onGenerate={() => setGenerateOpen(true)}
          onSend={handleSend}
          onClose={() => onClose(draft.id)}
          onFlush={() => onFlush(draft.id)}
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

      {/* Attachments */}
      {draft.attachments && draft.attachments.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-border/30 px-3 py-2">
          {draft.attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs"
            >
              <IconPaperclip className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="truncate max-w-[140px]">{att.originalName}</span>
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
      <div className="flex shrink-0 items-center justify-between border-t border-border/30 px-3 py-2">
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => onDiscard(draft.id)}
              >
                <IconTrash className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Discard draft</TooltipContent>
          </Tooltip>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={sendEmail.isPending || !draft.to.trim()}
            className="gap-1.5"
          >
            <IconSend className="h-3.5 w-3.5" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
});
