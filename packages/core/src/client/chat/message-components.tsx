// Owns: message-timestamp helpers, SelectionAttachedPill, UserMessage,
// AssistantMessage, MessageBranchPicker, CheckpointContext, MessageActionsContext,
// RunningActivityStatus, ThinkingIndicator, and displayableUserMessageText.

import {
  useThread,
  useMessageRuntime,
  useComposer,
  MessagePrimitive,
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
} from "@assistant-ui/react";
import type { Attachment } from "@assistant-ui/react";
import {
  IconX,
  IconCheck,
  IconCopy,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconDots,
  IconGitFork,
  IconId,
  IconQuote,
  IconRefresh,
  IconArrowBackUp,
  IconFile,
  IconFolder,
  IconFileText,
  IconCheckbox,
  IconMail,
  IconUser,
  IconPresentation,
  IconStack2,
  IconMessageChatbot,
  IconPencil,
  IconLoader2,
} from "@tabler/icons-react";
import React, { useState, useEffect, useCallback, useRef, useId } from "react";

import { getActiveRun } from "../active-run-state.js";
import { agentNativePath } from "../api-path.js";
import { writeClipboardText } from "../clipboard.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { isPastedTextAttachmentName } from "../composer/pasted-text.js";
import { PastedTextChip } from "../composer/PastedTextChip.js";
import { ThumbsFeedback } from "../observability/ThumbsFeedback.js";
import type { ContentPart } from "../sse-event-processor.js";
import { cn } from "../utils.js";
import { MarkdownText } from "./markdown-renderer.js";
import {
  ToolCallFallback,
  FilesChangedSummary,
  ChatRunningContext,
} from "./tool-call-display.js";

// ─── Pending selection context key ───────────────────────────────────────────
// Mirrored from AssistantChat to avoid a cross-import on a private constant.
const PENDING_SELECTION_KEY = "pending-selection-context";

// ─── displayableUserMessageText ───────────────────────────────────────────────

export function displayableUserMessageText(text: string): string {
  return text.replace(/<context>[\s\S]*?<\/context>\n?/g, "").trim();
}

// ─── Message timestamp helpers ────────────────────────────────────────────────

interface FormattedMessageTimestamp {
  short: string;
  full: string;
}

function coerceMessageDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatMessageTimestamp(
  value: unknown,
): FormattedMessageTimestamp | null {
  const date = coerceMessageDate(value);
  if (!date) return null;

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

  let short: string;
  if (isSameCalendarDay(date, now)) {
    short = time;
  } else if (isSameCalendarDay(date, yesterday)) {
    short = `Yesterday ${time}`;
  } else if (date.getFullYear() === now.getFullYear()) {
    short = `${new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(date)}, ${time}`;
  } else {
    short = `${new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date)}, ${time}`;
  }

  return {
    short,
    full: new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date),
  };
}

export function MessageTimestamp({
  timestamp,
  className,
}: {
  timestamp: FormattedMessageTimestamp;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-[11px] leading-none text-muted-foreground",
        className,
      )}
      title={timestamp.full}
    >
      {timestamp.short}
    </span>
  );
}

// ─── SelectionAttachedPill ────────────────────────────────────────────────────

export function SelectionAttachedPill() {
  const [length, setLength] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(
      agentNativePath(
        `/_agent-native/application-state/${PENDING_SELECTION_KEY}`,
      ),
    )
      .then((r) => (r.ok && r.status !== 204 ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const text =
          (data?.value?.text as string | undefined) ??
          (data?.text as string | undefined);
        if (text) setLength(text.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onAttached(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (typeof detail?.length === "number") setLength(detail.length);
    }
    function onCleared() {
      setLength(null);
    }
    window.addEventListener("agent-panel:selection-attached", onAttached);
    window.addEventListener("agent-panel:selection-cleared", onCleared);
    return () => {
      window.removeEventListener("agent-panel:selection-attached", onAttached);
      window.removeEventListener("agent-panel:selection-cleared", onCleared);
    };
  }, []);

  if (length === null || length === 0) return null;

  return (
    <div className="shrink-0 px-3 pt-1.5 -mb-1">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
        <IconQuote size={11} />
        <span>{length.toLocaleString()} chars of selection attached</span>
        <button
          type="button"
          aria-label="Clear selection context"
          onClick={() => {
            setLength(null);
            // Dispatch clear event; AssistantChat owns the DELETE call.
            window.dispatchEvent(
              new CustomEvent("agent-panel:selection-clear-requested"),
            );
          }}
          className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/60"
        >
          <IconX size={11} />
        </button>
      </div>
    </div>
  );
}

// ─── CheckpointContext / MessageActionsContext ────────────────────────────────

export const CheckpointContext = React.createContext<{
  apiUrl: string;
  devMode: boolean;
  threadId?: string;
} | null>(null);

export const MessageActionsContext = React.createContext<{
  onForkChat?: () => void | boolean | Promise<void | boolean>;
} | null>(null);

// ─── MessageBranchPicker ──────────────────────────────────────────────────────

export function MessageBranchPicker() {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className="flex items-center gap-0.5 text-[11px] text-muted-foreground"
    >
      <BranchPickerPrimitive.Previous asChild>
        <button
          type="button"
          aria-label="Previous branch"
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IconChevronLeft className="h-3.5 w-3.5" />
        </button>
      </BranchPickerPrimitive.Previous>
      <span className="tabular-nums select-none">
        <BranchPickerPrimitive.Number />
        {"/"}
        <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <button
          type="button"
          aria-label="Next branch"
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IconChevronRight className="h-3.5 w-3.5" />
        </button>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
}

// ─── Mention rendering ────────────────────────────────────────────────────────

const mentionIconProps = {
  size: 14,
  className: "shrink-0 text-muted-foreground",
};

function MentionChipIcon({ icon }: { icon?: string }) {
  switch (icon) {
    case "folder":
      return <IconFolder {...mentionIconProps} />;
    case "document":
      return <IconFileText {...mentionIconProps} />;
    case "form":
      return <IconCheckbox {...mentionIconProps} />;
    case "email":
      return <IconMail {...mentionIconProps} />;
    case "user":
      return <IconUser {...mentionIconProps} />;
    case "deck":
      return <IconPresentation {...mentionIconProps} />;
    case "agent":
      return <IconMessageChatbot {...mentionIconProps} />;
    case "file":
      return <IconFile {...mentionIconProps} />;
    default:
      return <IconStack2 {...mentionIconProps} />;
  }
}

// Matches rich mention format: @[label|icon] or plain @word
const richMentionPattern = /@\[([^\]|]+)\|([^\]]+)\]/g;
const plainMentionPattern = /((?:^|(?<=\s))@(\w+))/g;

function UserMessageText({ text }: { text: string }) {
  // Strip injected <context>...</context> blocks before display
  const displayText = displayableUserMessageText(text);

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let hasRichMentions = false;

  // First try rich mentions (@[label|icon])
  richMentionPattern.lastIndex = 0;
  while ((match = richMentionPattern.exec(displayText)) !== null) {
    hasRichMentions = true;
    const matchStart = match.index;
    if (matchStart > lastIndex) {
      parts.push(displayText.slice(lastIndex, matchStart));
    }
    const label = match[1];
    const icon = match[2];
    parts.push(
      <span
        key={matchStart}
        className="inline-flex items-center gap-1 rounded-md border border-input bg-muted/50 px-1.5 py-0.5 text-xs font-medium text-foreground align-middle mx-0.5 max-w-[200px] select-all"
        data-mention-label={label}
      >
        <MentionChipIcon icon={icon} />
        <span className="truncate">{label}</span>
      </span>,
    );
    lastIndex = matchStart + match[0].length;
  }

  if (hasRichMentions) {
    if (lastIndex < displayText.length) {
      parts.push(displayText.slice(lastIndex));
    }
    return <>{parts}</>;
  }

  // Fallback: plain @word mentions (for older messages)
  plainMentionPattern.lastIndex = 0;
  while ((match = plainMentionPattern.exec(displayText)) !== null) {
    const matchStart = match.index;
    if (matchStart > lastIndex) {
      parts.push(displayText.slice(lastIndex, matchStart));
    }
    const mentionName = match[2];
    parts.push(
      <span
        key={matchStart}
        className="inline-flex items-center gap-1 rounded-md border border-input bg-muted/50 px-1.5 py-0.5 text-xs font-medium text-foreground align-middle mx-0.5 select-all"
        data-mention-label={mentionName}
      >
        @{mentionName}
      </span>,
    );
    lastIndex = matchStart + match[0].length;
  }

  if (lastIndex < displayText.length) {
    parts.push(displayText.slice(lastIndex));
  }

  return <>{parts.length > 0 ? parts : displayText}</>;
}

// ─── UserMessageAttachments ───────────────────────────────────────────────────

function UserMessageAttachments() {
  const messageRuntime = useMessageRuntime();
  const msg = messageRuntime.getState();
  // assistant-ui stores user attachments on msg.attachments (separate from content).
  // Each attachment has: { id, type, name, contentType?, content: MessagePart[] }.
  // Image adapters put a {type:"image", image:"data:..."} part in content; text
  // adapters put a {type:"text", text:"<attachment>..."} part. Fall back to a
  // file chip when there's no inline image.
  const attachments = (msg as { attachments?: readonly Attachment[] })
    .attachments;
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap justify-end gap-1.5 mb-1.5">
      {attachments.map((att) => {
        if (isPastedTextAttachmentName(att.name)) {
          return <PastedTextChip key={att.id} attachment={att} compact />;
        }

        // Prefer the hosted upload URL when available (set by the server after
        // preUploadAttachments). This avoids re-shipping base64 in each poll
        // and lets the browser cache the image via a stable URL.
        const uploadUrl = (
          att as unknown as { metadata?: { uploadUrl?: string } }
        ).metadata?.uploadUrl;
        const imagePart = att.content?.find(
          (p): p is { type: "image"; image: string } =>
            p.type === "image" &&
            "image" in p &&
            !!(p as { image?: string }).image,
        );
        const imageSrc = uploadUrl || imagePart?.image || null;
        if (imageSrc) {
          return (
            <div
              key={att.id}
              className="h-16 w-16 overflow-hidden rounded-lg border border-border/70 bg-muted/50"
              title={att.name}
            >
              <img
                src={imageSrc}
                alt={att.name}
                className="h-full w-full object-cover"
              />
            </div>
          );
        }
        return (
          <div
            key={att.id}
            className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground"
            title={att.name}
          >
            <IconFile className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate max-w-[120px]">{att.name || "file"}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── UserMessageEditComposer ──────────────────────────────────────────────────

function UserMessageEditComposer() {
  return (
    <ComposerPrimitive.Root className="flex flex-col gap-2 rounded-lg border border-border bg-background px-3 py-2 shadow-sm">
      <ComposerPrimitive.Input
        className="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
        rows={1}
        submitMode="enter"
      />
      <div className="flex justify-end gap-2">
        <ComposerPrimitive.Cancel asChild>
          <button
            type="button"
            className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send asChild>
          <button
            type="submit"
            className="cursor-pointer rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            Save
          </button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}

// ─── MessageActionsMenu ────────────────────────────────────────────────────────

export function MessageActionsMenu({
  showRevert,
  onRevert,
}: {
  showRevert?: boolean;
  onRevert?: () => void;
} = {}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const messageRuntime = useMessageRuntime();
  const actionsCtx = React.useContext(MessageActionsContext);
  const timestamp = formatMessageTimestamp(messageRuntime.getState().createdAt);

  const handleCopyMessage = useCallback(() => {
    const m = messageRuntime.getState();
    const text = m.content
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("\n");
    void writeClipboardText(text).then((ok) => {
      if (!ok) return;
      setCopied("message");
      setTimeout(() => {
        setCopied(null);
        setOpen(false);
      }, 1000);
    });
  }, [messageRuntime]);

  const handleCopyRequestId = useCallback(() => {
    const m = messageRuntime.getState();
    const meta = m.metadata as
      | {
          custom?: { runId?: unknown };
          runId?: unknown;
        }
      | undefined;
    // Live yields put the trace ID at metadata.custom.runId; server-persisted
    // messages put it at metadata.runId. If neither is present (e.g. the run
    // is still in flight and this is the first message), fall back to the
    // active-run state so a hung / mid-stream chat still surfaces a usable
    // trace ID. Last resort is the assistant-ui local message id.
    const runId =
      (typeof meta?.custom?.runId === "string" && meta.custom.runId) ||
      (typeof meta?.runId === "string" && meta.runId) ||
      (typeof window !== "undefined" ? getActiveRun()?.runId : null) ||
      m.id ||
      "";
    void writeClipboardText(runId).then((ok) => {
      if (!ok) return;
      setCopied("id");
      setTimeout(() => {
        setCopied(null);
        setOpen(false);
      }, 1000);
    });
  }, [messageRuntime]);

  const handleForkChat = useCallback(() => {
    setOpen(false);
    actionsCtx?.onForkChat?.();
  }, [actionsCtx]);

  const handleRevert = useCallback(() => {
    setOpen(false);
    onRevert?.();
  }, [onRevert]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Message actions"
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors duration-150 hover:bg-accent hover:text-foreground",
            open && "bg-accent text-foreground",
          )}
        >
          <IconDots className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-48 rounded-lg border-border p-1.5 shadow-xl"
      >
        {actionsCtx?.onForkChat && (
          <DropdownMenuItem onSelect={handleForkChat}>
            <IconGitFork className="h-3.5 w-3.5" />
            Fork Chat
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            handleCopyMessage();
          }}
        >
          {copied === "message" ? (
            <IconCheck className="h-3.5 w-3.5" />
          ) : (
            <IconCopy className="h-3.5 w-3.5" />
          )}
          {copied === "message" ? "Copied!" : "Copy Message"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            handleCopyRequestId();
          }}
        >
          {copied === "id" ? (
            <IconCheck className="h-3.5 w-3.5" />
          ) : (
            <IconId className="h-3.5 w-3.5" />
          )}
          {copied === "id" ? "Copied!" : "Copy Request ID"}
        </DropdownMenuItem>
        {showRevert && (
          <DropdownMenuItem onSelect={handleRevert}>
            <IconArrowBackUp className="h-3.5 w-3.5" />
            Revert to here
          </DropdownMenuItem>
        )}
        {timestamp && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="px-2 py-1 text-[11px] font-normal text-muted-foreground">
              Sent {timestamp.short}
            </DropdownMenuLabel>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── UserMessage ──────────────────────────────────────────────────────────────

export function UserMessage() {
  const [expanded, setExpanded] = useState(false);
  const [isExpandable, setIsExpandable] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const messageRuntime = useMessageRuntime();
  const message = messageRuntime.getState();
  const timestamp = formatMessageTimestamp(message.createdAt);
  const isEditing = useComposer((state) => state.isEditing);
  const chatRunning = React.useContext(ChatRunningContext);
  const hasDisplayableText =
    message.content
      ?.filter((part): part is { type: "text"; text: string } => {
        return part.type === "text" && typeof part.text === "string";
      })
      .some((part) => displayableUserMessageText(part.text).length > 0) ??
    false;

  useEffect(() => {
    const el = contentRef.current;
    if (!el || !hasDisplayableText) return;

    const measure = () => {
      setIsExpandable(el.scrollHeight > 200);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasDisplayableText]);

  // When in edit mode, show the inline edit composer instead of the message bubble.
  if (isEditing) {
    return (
      <div className="flex justify-end">
        <div className="w-full max-w-[85%]">
          <UserMessageEditComposer />
        </div>
      </div>
    );
  }

  return (
    <div
      className="group flex justify-end"
      style={{ contentVisibility: "auto" }}
    >
      <div className="max-w-[85%]">
        <UserMessageAttachments />
        {hasDisplayableText && (
          <div
            className="relative rounded-lg bg-accent px-3 py-2 text-sm leading-relaxed text-foreground"
            onCopy={(e) => {
              const selection = window.getSelection();
              if (!selection || selection.rangeCount === 0) return;
              const fragment = selection.getRangeAt(0).cloneContents();
              const mentions = fragment.querySelectorAll(
                "[data-mention-label]",
              );
              if (mentions.length === 0) return;
              e.preventDefault();
              mentions.forEach((el) => {
                el.textContent = `@${el.getAttribute("data-mention-label")}`;
              });
              const div = document.createElement("div");
              div.appendChild(fragment);
              e.clipboardData.setData("text/plain", div.textContent || "");
            }}
          >
            <div
              ref={contentRef}
              className={cn(
                "whitespace-pre-wrap break-words",
                !expanded && isExpandable && "max-h-[200px] overflow-hidden",
              )}
            >
              <MessagePrimitive.Parts
                components={{
                  Text: UserMessageText,
                }}
              />
            </div>
            {!expanded && isExpandable && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 rounded-b-lg bg-gradient-to-t from-accent via-accent/90 to-transparent" />
            )}
            {/* Edit hover affordance — appears on hover when not running */}
            {!chatRunning && hasDisplayableText && (
              <TooltipProvider delayDuration={400}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ActionBarPrimitive.Edit asChild>
                      <button
                        type="button"
                        aria-label="Edit message"
                        className="absolute -left-8 top-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/0 transition-colors duration-150 group-hover:text-muted-foreground/70 group-hover:hover:bg-accent group-hover:hover:text-foreground"
                      >
                        <IconPencil className="h-3.5 w-3.5" />
                      </button>
                    </ActionBarPrimitive.Edit>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="text-xs">
                    Edit message
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        )}
        {hasDisplayableText && isExpandable && (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            <IconChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                expanded && "rotate-180",
              )}
            />
            {expanded ? "Collapse" : "Expand"}
          </button>
        )}
        <div className="mt-1 flex items-center justify-end gap-1">
          <MessageBranchPicker />
          {timestamp && (
            <MessageTimestamp
              timestamp={timestamp}
              className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── AssistantMessage ─────────────────────────────────────────────────────────

export function AssistantMessage() {
  const [restoreState, setRestoreState] = useState<
    "idle" | "confirming" | "restoring"
  >("idle");
  const messageRuntime = useMessageRuntime();
  const thread = useThread();
  const chatRunning = React.useContext(ChatRunningContext);
  const msg = messageRuntime.getState();
  const timestamp = formatMessageTimestamp(msg.createdAt);
  const isLast =
    thread.messages.length > 0 &&
    thread.messages[thread.messages.length - 1].id === msg.id;
  const isComplete = !isLast || !chatRunning;
  const cpCtx = React.useContext(CheckpointContext);

  const handleRestore = useCallback(async () => {
    if (restoreState === "idle") {
      setRestoreState("confirming");
      return;
    }
    if (restoreState !== "confirming" || !cpCtx) return;
    setRestoreState("restoring");
    try {
      const m = messageRuntime.getState();
      const meta = m.metadata as
        | { custom?: { runId?: unknown }; runId?: unknown }
        | undefined;
      const runId =
        (typeof meta?.custom?.runId === "string" && meta.custom.runId) ||
        (typeof meta?.runId === "string" && meta.runId) ||
        null;
      if (!runId) {
        setRestoreState("idle");
        return;
      }
      const tid = cpCtx.threadId || "";
      const res = await fetch(
        `${cpCtx.apiUrl}/checkpoints?threadId=${encodeURIComponent(tid)}`,
      );
      const checkpoints: unknown[] = res.ok ? await res.json() : [];
      const checkpoint = checkpoints.find(
        (cp) => (cp as { runId?: string }).runId === runId,
      );
      if (!checkpoint) {
        setRestoreState("idle");
        return;
      }
      const restoreRes = await fetch(`${cpCtx.apiUrl}/checkpoints/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkpointId: (checkpoint as { id?: string }).id,
        }),
      });
      if (restoreRes.ok) {
        window.location.reload();
      } else {
        setRestoreState("idle");
      }
    } catch {
      setRestoreState("idle");
    }
  }, [restoreState, cpCtx, messageRuntime]);

  const cancelRestore = useCallback(() => {
    setRestoreState("idle");
  }, []);

  const showRestore = cpCtx?.devMode && isComplete && !isLast;

  // Collect parts for the files-changed summary (code-agent turns only).
  const msgContent = msg.content as ContentPart[] | undefined;
  const hasCodeAgentTools =
    Array.isArray(msgContent) &&
    msgContent.some(
      (p) =>
        p.type === "tool-call" &&
        p.structuredMeta &&
        (p.structuredMeta.toolKind === "edit" ||
          p.structuredMeta.toolKind === "write"),
    );

  return (
    <div
      className="group relative"
      style={{ contentVisibility: isComplete ? "auto" : "visible" }}
    >
      <div className="max-w-[95%] text-sm leading-relaxed text-foreground">
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            tools: {
              Fallback: ToolCallFallback,
            },
          }}
        />
        {isComplete && hasCodeAgentTools && msgContent && (
          <FilesChangedSummary parts={msgContent} />
        )}
      </div>
      {isComplete && (
        <div className="mt-1 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-1">
            <MessageActionsMenu
              showRevert={showRestore && restoreState === "idle"}
              onRevert={handleRestore}
            />
            {/* Regenerate button — only on the last assistant message, auto-disabled while running */}
            {isLast && (
              <TooltipProvider delayDuration={400}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ActionBarPrimitive.Reload asChild>
                      <button
                        type="button"
                        aria-label="Regenerate response"
                        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-colors duration-150 hover:bg-accent hover:text-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <IconRefresh className="h-3.5 w-3.5" />
                      </button>
                    </ActionBarPrimitive.Reload>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    Regenerate response
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <MessageBranchPicker />
            {timestamp && (
              <MessageTimestamp
                timestamp={timestamp}
                className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
              />
            )}
          </div>
          {showRestore && restoreState === "confirming" ? (
            <div className="flex items-center gap-1 text-xs">
              <button
                onClick={handleRestore}
                className="rounded-md bg-destructive px-1.5 py-0.5 text-destructive-foreground hover:bg-destructive/90"
              >
                Restore to here?
              </button>
              <button
                onClick={cancelRestore}
                className="rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          ) : showRestore && restoreState === "restoring" ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <IconLoader2 className="h-3 w-3 animate-spin" />
              Restoring...
            </span>
          ) : (
            <ThumbsFeedback
              threadId={cpCtx?.threadId ?? ""}
              runId={(() => {
                const meta = messageRuntime.getState().metadata as
                  | { custom?: { runId?: unknown }; runId?: unknown }
                  | undefined;
                return (
                  (typeof meta?.custom?.runId === "string" &&
                    meta.custom.runId) ||
                  (typeof meta?.runId === "string" && meta.runId) ||
                  ""
                );
              })()}
              messageSeq={thread.messages.findIndex((m) => m.id === msg.id)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── RunningActivityStatus / ThinkingIndicator ────────────────────────────────

export function RunningActivityStatus({ label }: { label: string }) {
  return (
    <div className="agent-running-activity">
      <ThinkingIndicator label={label} />
    </div>
  );
}

export function ThinkingIndicator({
  label = "Thinking",
}: { label?: string } = {}) {
  const reactId = useId().replace(/:/g, "");
  const maskId = `agent-thinking-mask-${reactId}`;
  const gradientId = `agent-thinking-gradient-${reactId}`;
  const textX = 27;
  const textWidth = Math.max(44, Math.min(96, label.length * 6.35));
  const ellipsisX = textX + textWidth - 0.8;
  const viewBoxWidth = ellipsisX + 13;
  const shimmerWidth = viewBoxWidth * 0.68;
  return (
    <div
      className="agent-thinking-indicator"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <svg
        className="agent-thinking-indicator__glyph"
        viewBox={`0 0 ${viewBoxWidth} 18`}
        style={
          {
            "--agent-thinking-width": `${viewBoxWidth / 16}rem`,
          } as React.CSSProperties
        }
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
            <stop
              className="agent-thinking-indicator__sheen-edge"
              offset="0%"
            />
            <stop
              className="agent-thinking-indicator__sheen-mid"
              offset="50%"
            />
            <stop
              className="agent-thinking-indicator__sheen-edge"
              offset="100%"
            />
          </linearGradient>
          <mask id={maskId} maskUnits="userSpaceOnUse">
            <g fill="white">
              <g
                className="agent-thinking-indicator__logo"
                transform="translate(0 2.7) scale(0.9)"
              >
                <path d="M5.1 14H0L3.1 8.4 7.8 0 12.5 8.4H8.2L5.1 14Z" />
                <path d="M19.5 0H24L16.6 14H12.1L19.5 0Z" />
              </g>
              <text
                x={textX}
                y="13"
                fontFamily='Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
                fontSize="13"
                fontWeight="500"
                letterSpacing="0"
              >
                {label}
              </text>
              <g
                fontFamily='Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
                fontSize="13"
                fontWeight="500"
              >
                <text
                  className="agent-thinking-indicator__ellipsis-dot agent-thinking-indicator__ellipsis-dot--1"
                  x={ellipsisX}
                  y="13"
                >
                  .
                </text>
                <text
                  className="agent-thinking-indicator__ellipsis-dot agent-thinking-indicator__ellipsis-dot--2"
                  x={ellipsisX + 3.7}
                  y="13"
                >
                  .
                </text>
                <text
                  className="agent-thinking-indicator__ellipsis-dot agent-thinking-indicator__ellipsis-dot--3"
                  x={ellipsisX + 7.4}
                  y="13"
                >
                  .
                </text>
              </g>
            </g>
          </mask>
        </defs>
        <g mask={`url(#${maskId})`}>
          <rect
            className="agent-thinking-indicator__base"
            width={viewBoxWidth}
            height="18"
          />
          <rect
            className="agent-thinking-indicator__shimmer"
            width={shimmerWidth}
            height="18"
            fill={`url(#${gradientId})`}
          />
        </g>
      </svg>
    </div>
  );
}
