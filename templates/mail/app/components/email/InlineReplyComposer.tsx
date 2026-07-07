import { useAgentChatGenerating, useT } from "@agent-native/core/client";
import {
  appendSignatureToBody,
  splitAppendedSignature,
} from "@shared/signature";
import type { ComposeState, EmailMessage } from "@shared/types";
import {
  IconSend,
  IconBold,
  IconItalic,
  IconLink,
  IconPaperclip,
  IconLoader2,
  IconDots,
  IconTrash,
  IconExternalLink,
  IconChevronDown,
} from "@tabler/icons-react";
import {
  useState,
  useRef,
  useMemo,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { toast } from "sonner";

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
import { useAliases } from "@/hooks/use-aliases";
import {
  useSendEmail,
  useAddOptimisticReply,
  useSettings,
} from "@/hooks/use-emails";
import { canUseAgentGenerate } from "@/lib/agent-generate";
import { expandAliasTokens } from "@/lib/alias-utils";
import { openFilePicker, uploadFile, uploadFiles } from "@/lib/upload";
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
  const t = useT();
  const [showQuoted, setShowQuoted] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(() =>
    Boolean(draft.cc?.trim() || draft.bcc?.trim()),
  );
  const [isGenerating, sendToAgent] = useAgentChatGenerating();
  const sendEmail = useSendEmail();
  const addOptimisticReply = useAddOptimisticReply();
  const { data: settings } = useSettings();
  const { data: aliases = [] } = useAliases();
  const editorRef = useRef<ComposeEditorHandle>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);

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

  useEffect(() => {
    if (draft.cc?.trim() || draft.bcc?.trim()) setShowCcBcc(true);
  }, [draft.cc, draft.bcc]);

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
  const [messageContent, appendedSignature] = useMemo(
    () =>
      draft.mode === "reply"
        ? splitAppendedSignature(editableContent, settings?.signature)
        : [editableContent, ""],
    [draft.mode, editableContent, settings?.signature],
  );
  const quotedRef = useRef(quotedContent);
  quotedRef.current = quotedContent;
  const appendedSignatureRef = useRef(appendedSignature);
  appendedSignatureRef.current = appendedSignature;
  const hasQuote = quotedContent.length > 0;
  const editorContent = appendedSignature
    ? messageContent
    : hasQuote
      ? editableContent
      : draft.body;

  const handleSend = async () => {
    if (sendingRef.current) return;
    if (!draft.to.trim()) {
      toast.error(t("mail.toasts.pleaseAddRecipient"));
      return;
    }
    sendingRef.current = true;

    const draftSnapshot = { ...draft };

    onDiscard(draft.id);

    // Show optimistic reply in the thread immediately
    const undoOptimistic = addOptimisticReply({
      to: expandAliasTokens(draftSnapshot.to, aliases),
      cc: expandAliasTokens(draftSnapshot.cc ?? "", aliases) || undefined,
      subject: draftSnapshot.subject,
      body: draftSnapshot.body,
      replyToId: draftSnapshot.replyToId,
      replyToThreadId: draftSnapshot.replyToThreadId,
      accountEmail: draftSnapshot.accountEmail,
      attachments: draftSnapshot.attachments,
    });

    let cancelled = false;

    const handleUndo = () => {
      if (cancelled) return;
      cancelled = true;
      sendingRef.current = false;
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
          replyToThreadId: draftSnapshot.replyToThreadId,
          accountEmail: draftSnapshot.accountEmail,
          attachments: draftSnapshot.attachments,
        },
        {
          onError: () => {
            toast.error(t("mail.toasts.failedToSendEmail"));
            const { id: _id, ...reopenData } = draftSnapshot;
            onReopen(reopenData);
          },
          onSettled: () => {
            sendingRef.current = false;
          },
        },
      );
    }, 5000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!composerRef.current?.contains(e.target as Node)) return;
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
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
    if (!(await canUseAgentGenerate())) {
      toast.error(t("mail.toasts.aiEngineRequired"));
      window.dispatchEvent(new CustomEvent("agent-panel:open"));
      return;
    }
    await onFlush(draft.id);
    const promptDraft = {
      ...draft,
      body: getCurrentDraftBodyFromEditor({
        draft,
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
      context: `The user is composing an email reply in Agent-Native Mail. Use the draft snapshot below as the source of truth, then update the existing reply draft by calling manage-draft with action "update", id "${draft.id}", and the revised Markdown body. Do not only reply with the revised content; the Mail draft must be updated through the tool. Preserve recipients and subject unless the user explicitly asks to change them.\n\nDrafting rules:\n- Use the configured signature exactly when one is present, and do not duplicate it if it is already in the draft.\n- If no configured signature is present, do not invent or derive a sign-off from the user's name or email address.\n- Use Markdown only. Keep the copy natural, specific, and free of generic AI email filler unless the user asks for a formal template.\n\n${draftContext}`,
      submit: true,
    });
    setGeneratePrompt("");
    setGenerateOpen(false);
  };

  const toggleCcBcc = () => {
    const next = !showCcBcc;
    setShowCcBcc(next);
    if (!next) return;

    const partial: Partial<ComposeState> = {};
    if (draft.cc === undefined) partial.cc = "";
    if (draft.bcc === undefined) partial.bcc = "";
    if (Object.keys(partial).length > 0) onUpdate(draft.id, partial);
  };

  const moveRecipient = (
    value: string,
    from: RecipientField,
    to: RecipientField,
  ) => {
    if (from === to) return;
    const moved = computeRecipientMove(
      draft[from] ?? "",
      draft[to] ?? "",
      value,
    );
    const partial: Partial<ComposeState> = {};
    partial[from] = moved.from;
    partial[to] = moved.to;
    onUpdate(draft.id, partial);
  };

  const recipientFields = (
    <>
      <div className="flex items-center border-b border-border/30 px-4 pb-2">
        <span className="w-8 shrink-0 text-xs font-medium text-muted-foreground">
          To
        </span>
        <RecipientInput
          value={draft.to}
          onChange={(val) => onUpdate(draft.id, { to: val })}
          autoFocus={draft.mode === "forward"}
          field="to"
          onMoveRecipient={moveRecipient}
        />
        <button
          type="button"
          aria-label={showCcBcc ? "Hide Cc and Bcc" : "Show Cc and Bcc"}
          aria-expanded={showCcBcc}
          onClick={toggleCcBcc}
          className="p-1 text-muted-foreground transition-colors hover:text-foreground"
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
          <div className="flex items-center border-b border-border/30 px-4">
            <span className="w-8 shrink-0 text-xs font-medium text-muted-foreground">
              Cc
            </span>
            <RecipientInput
              value={draft.cc ?? ""}
              onChange={(val) => onUpdate(draft.id, { cc: val })}
              field="cc"
              onMoveRecipient={moveRecipient}
            />
          </div>
          <div className="flex items-center border-b border-border/30 px-4">
            <span className="w-8 shrink-0 text-xs font-medium text-muted-foreground">
              Bcc
            </span>
            <RecipientInput
              value={draft.bcc ?? ""}
              onChange={(val) => onUpdate(draft.id, { bcc: val })}
              field="bcc"
              onMoveRecipient={moveRecipient}
            />
          </div>
        </>
      )}
    </>
  );

  const handleAttachFiles = async (files: File[]) => {
    if (files.length === 0) return;
    try {
      const attachments = await uploadFiles(files);
      const existing = draft.attachments ?? [];
      onUpdate(draft.id, { attachments: [...existing, ...attachments] });
    } catch {
      toast.error(t("mail.toasts.failedToAttachFile"));
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
    const existing = draft.attachments ?? [];
    onUpdate(draft.id, {
      attachments: existing.filter((a) => a.id !== attachmentId),
    });
  };

  return (
    <div
      ref={composerRef}
      className="rounded-lg bg-card dark:bg-[var(--mail-message-surface)] overflow-hidden"
      onKeyDown={handleKeyDown}
      onDragOverCapture={handleDragOver}
      onDropCapture={handleDrop}
    >
      {/* Header */}
      {draft.mode === "forward" ? (
        <>
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <span className="text-[13px] font-semibold text-green-400">
              {t("mail.compose.forward")}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onPopOut(draft.id)}
                  className="flex h-9 w-9 sm:h-6 sm:w-6 items-center justify-center rounded text-muted-foreground/40 hover:text-foreground transition-colors"
                >
                  <IconExternalLink className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("mail.compose.popOut")}</TooltipContent>
            </Tooltip>
          </div>
          {recipientFields}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[13px] font-semibold text-green-400">
                {t("mail.compose.reply")}
              </span>
              <span className="text-[13px] text-muted-foreground/70 truncate">
                {t("mail.compose.replyTo", { recipient: recipientDisplay })}
              </span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onPopOut(draft.id)}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/40 hover:text-foreground transition-colors shrink-0"
                >
                  <IconExternalLink className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("mail.compose.popOut")}</TooltipContent>
            </Tooltip>
          </div>
          {recipientFields}
        </>
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
          content={editorContent}
          onChange={(md) => {
            if (appendedSignatureRef.current) {
              onUpdate(draft.id, {
                body: appendSignatureToBody(
                  md + quotedRef.current,
                  appendedSignatureRef.current,
                ),
              });
            } else if (hasQuote) {
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
          draftId={draft.id}
          getCurrentDraftBody={(editor) =>
            getCurrentDraftBodyFromEditor({
              draft,
              editor,
              signature: settings?.signature,
            })
          }
          sendToAgent={sendToAgent}
          onUploadImage={handleUploadImage}
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

      {/* Attachments */}
      {draft.attachments && draft.attachments.length > 0 && (
        <AttachmentStrip
          attachments={draft.attachments}
          onRemove={handleRemoveAttachment}
        />
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
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => onDiscard(draft.id)}
              >
                <IconTrash className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("mail.compose.discardDraft")}</TooltipContent>
          </Tooltip>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={sendEmail.isPending || !draft.to.trim()}
            className="gap-1.5"
          >
            <IconSend className="h-3.5 w-3.5" />
            {t("mail.compose.send")}
          </Button>
        </div>
      </div>
    </div>
  );
});
