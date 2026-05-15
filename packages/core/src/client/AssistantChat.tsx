import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useThreadRuntime,
  useThread,
  useAui,
  useComposer,
  useComposerRuntime,
  useMessageRuntime,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
} from "@assistant-ui/react";
import type {
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment,
  ToolCallMessagePartProps,
  Attachment,
} from "@assistant-ui/react";
import { CompositeAttachmentAdapter } from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { createAgentChatAdapter } from "./agent-chat-adapter.js";
import type { ReasoningEffort } from "../shared/reasoning-effort.js";
import type {
  ChatThreadScope,
  ChatThreadSnapshot,
} from "./use-chat-threads.js";
import { getActiveRun } from "./active-run-state.js";
import {
  AgentAutoContinueSignal,
  type ContentPart,
  readSSEStreamRaw,
} from "./sse-event-processor.js";
import { captureError, trackEvent } from "./analytics.js";
import { cn } from "./utils.js";
import { TextAttachmentAdapter } from "./composer/attachment-accept.js";
import { AgentTaskCard } from "./AgentTaskCard.js";
import { ConnectBuilderCard } from "./ConnectBuilderCard.js";
import { useBuilderConnectFlow } from "./settings/useBuilderStatus.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu.js";
import { IframeEmbed, parseEmbedBody } from "./IframeEmbed.js";
import { useDevMode } from "./use-dev-mode.js";
import { agentNativePath } from "./api-path.js";
import {
  BUILDER_SPACE_SETTINGS_URL,
  NEW_CHAT_ACTION_HREF,
} from "./error-format.js";
import { ThumbsFeedback } from "./observability/ThumbsFeedback.js";
import {
  TiptapComposer,
  type TiptapComposerHandle,
} from "./composer/TiptapComposer.js";
import type { Reference } from "./composer/types.js";
import { isPastedTextAttachmentName } from "./composer/pasted-text.js";
import { PastedTextChip } from "./composer/PastedTextChip.js";
import {
  IconMessage,
  IconX,
  IconPlayerStop,
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconTerminal,
  IconLoader2,
  IconCircleX,
  IconSquareFilled,
  IconClock,
  IconFile,
  IconFolder,
  IconFileText,
  IconCheckbox,
  IconMail,
  IconUser,
  IconPresentation,
  IconStack2,
  IconMessageChatbot,
  IconLock,
  IconArrowBackUp,
  IconExternalLink,
  IconDots,
  IconGitFork,
  IconId,
  IconQuote,
  IconGauge,
  IconArrowRight,
  IconSettings,
  IconAlertTriangle,
  IconRefresh,
  IconPlayerPlay,
  IconClipboardList,
  IconSearch,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconPlus,
} from "@tabler/icons-react";

class DownscalingImageAttachmentAdapter implements AttachmentAdapter {
  public accept = "image/*";

  public async add(state: { file: File }): Promise<PendingAttachment> {
    return {
      id: state.file.name,
      type: "image",
      name: state.file.name,
      contentType: state.file.type,
      file: state.file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  }

  public async send(
    attachment: PendingAttachment,
  ): Promise<CompleteAttachment> {
    return {
      ...attachment,
      status: { type: "complete" },
      content: [
        {
          type: "image",
          image: await getImageFileDataURL(attachment.file),
        },
      ],
    };
  }

  public async remove() {
    // noop
  }
}

class BinaryDocumentAttachmentAdapter implements AttachmentAdapter {
  public accept = "application/pdf,.pdf";

  public async add(state: { file: File }): Promise<PendingAttachment> {
    return {
      id: state.file.name,
      type: "document",
      name: state.file.name,
      contentType: inferDocumentContentType(state.file),
      file: state.file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  }

  public async send(
    attachment: PendingAttachment,
  ): Promise<CompleteAttachment> {
    return {
      ...attachment,
      status: { type: "complete" },
      content: [
        {
          type: "file",
          filename: attachment.name,
          data: await getFileDataURL(attachment.file),
          mimeType: inferDocumentContentType(attachment.file),
        },
      ],
    };
  }

  public async remove() {
    // noop
  }
}

function inferDocumentContentType(file: File): string {
  if (file.type) return file.type;
  if (file.name.toLowerCase().endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function getFileDataURL(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

// Anthropic / OpenAI vision inputs choke on multi-megabyte images, and
// base64-encoding a raw screenshot eats enough heap to crash the composer
// (PayloadTooLarge / "Maximum call stack" in serializers). Downscale large
// images on the client before we ever serialize them.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 2048;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode pasted image"));
    img.src = url;
  });
}

async function getImageFileDataURL(file: File): Promise<string> {
  if (file.size <= MAX_IMAGE_BYTES) {
    return getFileDataURL(file);
  }
  if (typeof document === "undefined" || typeof Image === "undefined") {
    return getFileDataURL(file);
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const ratio = Math.min(
      MAX_IMAGE_DIMENSION / img.naturalWidth,
      MAX_IMAGE_DIMENSION / img.naturalHeight,
      1,
    );
    const width = Math.max(1, Math.round(img.naturalWidth * ratio));
    const height = Math.max(1, Math.round(img.naturalHeight * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return getFileDataURL(file);
    }
    ctx.drawImage(img, 0, 0, width, height);
    const useJpeg =
      file.type !== "image/png" || file.size > MAX_IMAGE_BYTES * 2;
    return canvas.toDataURL(useJpeg ? "image/jpeg" : "image/png", 0.85);
  } catch {
    return getFileDataURL(file);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

type QueuedAttachment = CompleteAttachment;
type AgentRequestMode = "act" | "plan";

function createUserMessageRunConfig(
  references?: Reference[],
  requestMode?: AgentRequestMode,
) {
  const custom: { references?: Reference[]; requestMode?: AgentRequestMode } =
    {};
  if (references && references.length > 0) {
    custom.references = references;
  }
  if (requestMode) {
    custom.requestMode = requestMode;
  }
  return Object.keys(custom).length > 0 ? { runConfig: { custom } } : {};
}

function escapeQueuedAttachmentAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function isTextLikeFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (file.type === "application/json") return true;
  return /\.(txt|md|markdown|csv|json|yaml|yml)$/i.test(file.name);
}

function textFileAttachmentEnvelope(file: File, text: string): string {
  const contentType = file.type || "text/plain";
  return `<attachment name="${escapeQueuedAttachmentAttribute(file.name)}" contentType="${escapeQueuedAttachmentAttribute(contentType)}">\n${text}\n</attachment>`;
}

function serializeAttachmentContentPart(
  part: Record<string, unknown>,
): QueuedAttachment["content"][number] | null {
  if (part.type === "image" && typeof part.image === "string") {
    return { type: "image", image: part.image };
  }
  if (part.type === "text" && typeof part.text === "string") {
    return { type: "text", text: part.text };
  }
  if (part.type === "file" && typeof part.data === "string") {
    return {
      type: "file",
      data: part.data,
      mimeType:
        typeof part.mimeType === "string"
          ? part.mimeType
          : "application/octet-stream",
      ...(typeof part.filename === "string" ? { filename: part.filename } : {}),
    };
  }
  return null;
}

async function serializeQueuedAttachments(
  attachments?: ReadonlyArray<unknown>,
): Promise<QueuedAttachment[] | undefined> {
  const queued: QueuedAttachment[] = [];
  for (const raw of attachments ?? []) {
    const attachment = raw as Partial<Attachment> & { file?: File };
    const name = attachment.name || attachment.file?.name || "attachment";
    const id = attachment.id || name;
    const type = attachment.type || "file";
    const contentType = attachment.contentType || attachment.file?.type;

    if (Array.isArray(attachment.content) && attachment.content.length > 0) {
      const content = attachment.content
        .map((part) =>
          serializeAttachmentContentPart(part as Record<string, unknown>),
        )
        .filter((part): part is QueuedAttachment["content"][number] => !!part);
      if (content.length > 0) {
        queued.push({
          id,
          type,
          name,
          contentType,
          status: { type: "complete" },
          content,
        });
      }
      continue;
    }

    if (typeof File !== "undefined" && attachment.file instanceof File) {
      const file = attachment.file;
      if (file.type.startsWith("image/")) {
        queued.push({
          id,
          type: "image",
          name,
          contentType: file.type,
          status: { type: "complete" },
          content: [{ type: "image", image: await getImageFileDataURL(file) }],
        });
      } else if (isTextLikeFile(file)) {
        queued.push({
          id,
          type: "file",
          name,
          contentType: file.type || "text/plain",
          status: { type: "complete" },
          content: [
            {
              type: "text",
              text: textFileAttachmentEnvelope(file, await file.text()),
            },
          ],
        });
      } else {
        queued.push({
          id,
          type: "document",
          name,
          contentType: inferDocumentContentType(file),
          status: { type: "complete" },
          content: [
            {
              type: "file",
              filename: file.name,
              data: await getFileDataURL(file),
              mimeType: inferDocumentContentType(file),
            },
          ],
        });
      }
    }
  }

  return queued.length > 0 ? queued : undefined;
}

// ─── Markdown Text ──────────────────────────────────────────────────────────

const markdownStyles = `
.agent-markdown > :first-child { margin-top: 0; }
.agent-markdown > :last-child { margin-bottom: 0; }
.agent-markdown p { margin: 0.5em 0; }
.agent-markdown ul, .agent-markdown ol { margin: 0.5em 0; padding-left: 1.5em; }
.agent-markdown li { margin: 0.2em 0; }
.agent-markdown li > p { margin: 0; }
.agent-markdown h1 { font-size: 1.25em; font-weight: 600; margin: 0.75em 0 0.25em; }
.agent-markdown h2 { font-size: 1.125em; font-weight: 600; margin: 0.75em 0 0.25em; }
.agent-markdown h3 { font-size: 1em; font-weight: 600; margin: 0.75em 0 0.25em; }
.agent-markdown strong { font-weight: 600; }
.agent-markdown em { font-style: italic; }
.agent-markdown code { font-size: 0.875em; padding: 0.15em 0.35em; border-radius: 0.25em; background: hsl(var(--muted, 0 0% 15%)); color: hsl(var(--foreground, 0 0% 90%)); border: 1px solid hsl(var(--border, 0 0% 80%)); }
.agent-markdown pre { margin: 0.5em 0; padding: 0.75em 1em; border-radius: 0.375em; background: hsl(var(--muted, 0 0% 15%)); color: hsl(var(--foreground, 0 0% 90%)); overflow-x: auto; border: 1px solid hsl(var(--border, 0 0% 80%)); }
.agent-markdown pre code { padding: 0; background: transparent; font-size: 0.8125em; color: inherit; border: none; }
.agent-markdown-shiki { margin: 0.5em 0; border-radius: 0.375em; overflow: hidden; font-size: 0.8125em; }
.agent-markdown-shiki pre { margin: 0; padding: 0.75em 1em; overflow-x: auto; background: var(--shiki-light-bg); color: var(--shiki-light); }
.agent-markdown-shiki pre code { background: transparent; padding: 0; font-size: inherit; color: inherit; }
.agent-markdown-shiki pre span { color: var(--shiki-light); background: var(--shiki-light-bg); }
.dark .agent-markdown-shiki pre { background: var(--shiki-dark-bg); color: var(--shiki-dark); }
.dark .agent-markdown-shiki pre span { color: var(--shiki-dark); background: var(--shiki-dark-bg); }
@media (prefers-color-scheme: dark) { :root:not(.light) .agent-markdown-shiki pre { background: var(--shiki-dark-bg); color: var(--shiki-dark); } :root:not(.light) .agent-markdown-shiki pre span { color: var(--shiki-dark); background: var(--shiki-dark-bg); } }
.agent-tool-code .agent-markdown-shiki { margin: 0; border-radius: 0; min-width: max-content; }
.agent-tool-code .agent-markdown-shiki pre { padding: 0.75rem; border: 0; background: transparent; }
.agent-tool-code .agent-markdown-shiki pre span { background: transparent; }
.agent-tool-code pre { margin: 0; min-width: max-content; padding: 0.75rem; background: transparent; color: inherit; }
.agent-tool-code mark { border-radius: 0.1875rem; background: rgba(245, 158, 11, 0.25); color: inherit; }
.agent-markdown hr { border: none; border-top: 1px solid hsl(var(--border, 0 0% 20%)); margin: 0.75em 0; }
.agent-markdown a { text-decoration: underline; text-underline-offset: 2px; }
.agent-markdown a.agent-markdown-cta { text-decoration: none; }
.agent-markdown blockquote { border-left: 2px solid hsl(var(--border, 0 0% 20%)); padding-left: 0.75em; margin: 0.5em 0; opacity: 0.8; }
.agent-markdown table { border-collapse: collapse; margin: 0.5em 0; font-size: 0.875em; }
.agent-markdown th, .agent-markdown td { border: 1px solid hsl(var(--border, 0 0% 20%)); padding: 0.35em 0.65em; text-align: left; }
.agent-markdown th { font-weight: 600; background: hsl(var(--muted, 0 0% 15%)); color: hsl(var(--foreground, 0 0% 90%)); }
`;

/**
 * Pending selection context — written to application_state when the user
 * presses Cmd+I with text selected on the page. The agent's next turn picks
 * it up via the `selectionContextPromise` in production-agent. The pill
 * below tells the user the context is attached and lets them clear it.
 */
const PENDING_SELECTION_KEY = "pending-selection-context";
const ACTIVE_RUN_CLEAR_TIMEOUT_MS = 5_000;
const ACTIVE_RUN_POLL_INTERVAL_MS = 150;

type ActiveRunLookup = {
  active?: boolean;
  runId?: string;
  threadId?: string;
  status?: string;
  heartbeatAt?: number | null;
};

function activeRunLooksStale(runInfo: ActiveRunLookup): boolean {
  const heartbeatAt =
    typeof runInfo.heartbeatAt === "number" ? runInfo.heartbeatAt : null;
  return (
    runInfo.status === "running" &&
    heartbeatAt != null &&
    Date.now() - heartbeatAt > 5000
  );
}

function repoHasAssistantMessage(repo: any): boolean {
  return repo?.messages?.some(
    (m: { message?: { role?: string }; role?: string }) =>
      (m.message?.role ?? m.role) === "assistant",
  );
}

function getRepoMessages(repo: any): any[] {
  return Array.isArray(repo?.messages) ? repo.messages : [];
}

function getRepoMessage(entry: any): any {
  return entry?.message ?? entry;
}

function isAssistantMessageTerminal(message: any): boolean {
  const statusType =
    message?.status && typeof message.status === "object"
      ? message.status.type
      : undefined;
  return statusType === "complete" || statusType === "incomplete";
}

function repoTextLength(repo: any): number {
  let length = 0;
  for (const entry of getRepoMessages(repo)) {
    const message = getRepoMessage(entry);
    const content = message?.content;
    if (typeof content === "string") {
      length += content.length;
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type === "text" && typeof part.text === "string") {
          length += part.text.length;
        }
      }
    }
  }
  return length;
}

function repoTerminalAssistantCount(repo: any): number {
  return getRepoMessages(repo).filter((entry) => {
    const message = getRepoMessage(entry);
    return message?.role === "assistant" && isAssistantMessageTerminal(message);
  }).length;
}

function shouldImportServerThreadData(currentRepo: any, incomingRepo: any) {
  const incomingCount = getRepoMessages(incomingRepo).length;
  if (incomingCount === 0) return false;

  const currentCount = getRepoMessages(currentRepo).length;
  if (currentCount === 0) return true;
  if (incomingCount < currentCount) return false;

  if (incomingCount === currentCount) {
    const currentTerminalAssistants = repoTerminalAssistantCount(currentRepo);
    const incomingTerminalAssistants = repoTerminalAssistantCount(incomingRepo);
    if (incomingTerminalAssistants < currentTerminalAssistants) {
      return false;
    }
    if (
      incomingTerminalAssistants <= currentTerminalAssistants &&
      repoTextLength(incomingRepo) < repoTextLength(currentRepo)
    ) {
      return false;
    }
  }

  return true;
}

function clearPendingSelection() {
  fetch(
    agentNativePath(
      `/_agent-native/application-state/${PENDING_SELECTION_KEY}`,
    ),
    {
      method: "DELETE",
      keepalive: true,
      headers: { "X-Agent-Native-CSRF": "1" },
    },
  ).catch(() => {});
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("agent-panel:selection-cleared"));
  }
}

async function waitForThreadRunToClear(apiUrl: string, threadId?: string) {
  if (!threadId) return;
  const deadline = Date.now() + ACTIVE_RUN_CLEAR_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
      );
      if (res.ok) {
        const info = await res.json();
        const heartbeatAt =
          typeof info?.heartbeatAt === "number" ? info.heartbeatAt : null;
        const stale =
          info?.status === "running" &&
          heartbeatAt != null &&
          Date.now() - heartbeatAt > 5000;
        if (!info?.active || info?.status !== "running" || stale) return;
      }
    } catch {
      // Transient poll failure — try again until the short grace period ends.
    }

    await new Promise((resolve) =>
      window.setTimeout(resolve, ACTIVE_RUN_POLL_INTERVAL_MS),
    );
  }
}

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

function formatMessageTimestamp(
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

function MessageTimestamp({
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

function SelectionAttachedPill() {
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
            clearPendingSelection();
          }}
          className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/60"
        >
          <IconX size={11} />
        </button>
      </div>
    </div>
  );
}

let stylesInjected = false;
function injectMarkdownStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = markdownStyles;
  document.head.appendChild(style);
}

function extractCodeText(child: React.ReactNode): string {
  if (typeof child === "string") return child;
  if (Array.isArray(child)) return child.map(extractCodeText).join("");
  if (React.isValidElement(child)) {
    const props = child.props as { children?: React.ReactNode };
    return extractCodeText(props.children);
  }
  return "";
}

// Lazy-loaded shiki highlighter using the fine-grained API so we only ship
// the languages and themes we actually use (instead of shiki's full ~30 MB
// bundle of every grammar). This is required to keep the Cloudflare Pages
// Functions bundle under the 25 MiB limit.
type ShikiHighlighter = {
  codeToHtml: (
    code: string,
    options: {
      lang: string;
      themes: { light: string; dark: string };
      defaultColor?: false | "light" | "dark";
    },
  ) => string | Promise<string>;
  getLoadedLanguages: () => string[];
};

let highlighterLoader: Promise<ShikiHighlighter> | null = null;
function loadHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterLoader) {
    highlighterLoader = (async () => {
      const [{ createHighlighterCore }, { createOnigurumaEngine }] =
        await Promise.all([
          import("shiki/core"),
          import("shiki/engine/oniguruma"),
        ]);
      return createHighlighterCore({
        themes: [
          import("shiki/themes/github-light-default.mjs"),
          import("shiki/themes/github-dark-default.mjs"),
        ],
        langs: [
          import("shiki/langs/javascript.mjs"),
          import("shiki/langs/typescript.mjs"),
          import("shiki/langs/jsx.mjs"),
          import("shiki/langs/tsx.mjs"),
          import("shiki/langs/json.mjs"),
          import("shiki/langs/css.mjs"),
          import("shiki/langs/html.mjs"),
          import("shiki/langs/markdown.mjs"),
          import("shiki/langs/bash.mjs"),
          import("shiki/langs/shellscript.mjs"),
          import("shiki/langs/python.mjs"),
          import("shiki/langs/yaml.mjs"),
          import("shiki/langs/sql.mjs"),
        ],
        engine: createOnigurumaEngine(import("shiki/wasm")),
      }) as unknown as Promise<ShikiHighlighter>;
    })().catch((error) => {
      // Reset on failure so a future code block can retry instead of
      // silently failing forever on a stale chunk / network blip.
      highlighterLoader = null;
      throw error;
    });
  }
  return highlighterLoader;
}

import { PROVIDER_ENV_VARS } from "../agent/engine/provider-env-vars.js";

const PROVIDER_ENV_VAR_SET = new Set(PROVIDER_ENV_VARS);

// Map a few common aliases to languages we bundled above.
const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  py: "python",
  yml: "yaml",
  md: "markdown",
  bq: "sql",
  bigquery: "sql",
};

function HighlightedCodeBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadHighlighter()
      .then((highlighter) => {
        const requested = (lang || "text").toLowerCase();
        const resolved = LANG_ALIASES[requested] ?? requested;
        const loaded = highlighter.getLoadedLanguages();
        const finalLang = loaded.includes(resolved) ? resolved : "text";
        return highlighter.codeToHtml(code, {
          lang: finalLang,
          themes: {
            light: "github-light-default",
            dark: "github-dark-default",
          },
          defaultColor: false,
        });
      })
      .then((out) => {
        if (!cancelled) setHtml(out);
      })
      .catch(() => {
        // Unknown language or other shiki failure — fall back to plain pre.
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  if (html) {
    return (
      <div
        className="agent-markdown-shiki"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <pre>
      <code className={lang ? `language-${lang}` : undefined}>{code}</code>
    </pre>
  );
}

const CTA_BUTTON_CLASSES =
  "agent-markdown-cta mt-1 inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background no-underline shadow-sm transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background cursor-pointer";

const markdownComponents = {
  a(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
    const {
      href,
      children,
      className,
      rel: _rel,
      target: _target,
      ...rest
    } = props;
    if (href === NEW_CHAT_ACTION_HREF) {
      // In-app action: dispatch a CustomEvent that MultiTabAssistantChat
      // listens for and opens a new chat tab. Not an external navigation.
      return (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("agent-chat:new-chat"));
          }}
          className={cn(CTA_BUTTON_CLASSES, className)}
        >
          <IconPlus size={13} strokeWidth={2} aria-hidden="true" />
          <span>{children}</span>
        </button>
      );
    }
    const isBuilderCta = isBuilderErrorCtaHref(href);
    if (!isBuilderCta) {
      return (
        <a href={href} className={className} {...rest}>
          {children}
        </a>
      );
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={cn(CTA_BUTTON_CLASSES, className)}
        {...rest}
      >
        <span>{children}</span>
        <IconExternalLink size={13} strokeWidth={2} aria-hidden="true" />
      </a>
    );
  },
  pre(props: React.HTMLAttributes<HTMLPreElement>) {
    const { children, ...rest } = props;
    if (React.isValidElement(children)) {
      const childProps = children.props as {
        className?: string;
        children?: React.ReactNode;
      };
      const className = childProps.className || "";
      if (/\blanguage-embed\b/.test(className)) {
        const body = extractCodeText(childProps.children);
        const parsed = parseEmbedBody(body);
        return (
          <IframeEmbed {...(parsed as Parameters<typeof IframeEmbed>[0])} />
        );
      }
      const langMatch = className.match(/\blanguage-([\w+-]+)\b/);
      if (langMatch) {
        const code = extractCodeText(childProps.children).replace(/\n$/, "");
        return <HighlightedCodeBlock code={code} lang={langMatch[1]} />;
      }
    }
    return <pre {...rest}>{children}</pre>;
  },
};

function isBuilderErrorCtaHref(href: string | undefined): boolean {
  if (!href) return false;
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" || url.hostname !== "builder.io") {
      return false;
    }
    return (
      url.href === BUILDER_SPACE_SETTINGS_URL ||
      url.pathname === "/account/billing" ||
      /^\/app\/organizations\/[^/]+\/billing$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

// react-markdown's defaultUrlTransform strips href values whose protocol
// isn't on its safe list (https, mailto, etc.). Our in-app pseudo-href
// `agent-native:new-chat` would be blanked out by that, so let it through
// while delegating every other URL to the default transform for sanitization.
function markdownUrlTransform(value: string): string {
  if (value === NEW_CHAT_ACTION_HREF) return value;
  return defaultUrlTransform(value);
}

function MarkdownText() {
  useEffect(() => {
    injectMarkdownStyles();
  }, []);
  return (
    <MarkdownTextPrimitive
      smooth
      className="agent-markdown break-words"
      remarkPlugins={[remarkGfm]}
      components={markdownComponents}
      urlTransform={markdownUrlTransform}
    />
  );
}

// ─── Composer Attachment Preview ─────────────────────────────────────────────

function getImageAttachmentSrc(attachment: Attachment): string | null {
  if (attachment.type !== "image") return null;

  if ("file" in attachment && attachment.file) {
    return URL.createObjectURL(attachment.file);
  }

  const imagePart = attachment.content?.find((part) => part.type === "image");
  return imagePart && "image" in imagePart ? imagePart.image : null;
}

function ComposerAttachmentPreviewCard({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: (id: string) => void;
}) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  useEffect(() => {
    const nextSrc = getImageAttachmentSrc(attachment);
    setImageSrc(nextSrc);

    return () => {
      if (nextSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(nextSrc);
      }
    };
  }, [attachment]);

  if (isPastedTextAttachmentName(attachment.name)) {
    return <PastedTextChip attachment={attachment} onRemove={onRemove} />;
  }

  const isImage = !!imageSrc;

  return (
    <div
      className={cn(
        "group relative overflow-hidden border border-border/70 bg-muted/50 text-foreground",
        isImage
          ? "h-20 w-20 rounded-xl shadow-[0_12px_30px_-18px_rgba(0,0,0,0.7)]"
          : "inline-flex max-w-[220px] items-center gap-2 rounded-lg px-2.5 py-2 text-xs",
      )}
    >
      {isImage ? (
        <>
          <img
            src={imageSrc}
            alt={attachment.name}
            className="h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-2 py-1.5">
            <div className="truncate text-[10px] font-medium text-white/95">
              {attachment.name}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {attachment.name.split(".").pop() || "file"}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">{attachment.name}</div>
            <div className="text-[11px] text-muted-foreground">
              {attachment.contentType || attachment.type}
            </div>
          </div>
        </>
      )}
      <button
        type="button"
        onClick={() => onRemove(attachment.id)}
        className={cn(
          "absolute flex h-6 w-6 items-center justify-center rounded-full border border-border/60 bg-background/95 text-muted-foreground shadow-sm transition hover:text-foreground",
          isImage
            ? "right-1.5 top-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100"
            : "right-1.5 top-1.5",
        )}
        aria-label={`Remove ${attachment.name}`}
      >
        <IconX className="h-3 w-3" />
      </button>
    </div>
  );
}

function ComposerAttachmentPreviewStrip() {
  const attachments = useComposer((state) => state.attachments);
  const aui = useAui();

  const handleRemove = useCallback(
    (id: string) => {
      void aui.composer().attachment({ id }).remove();
    },
    [aui],
  );

  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-2 pt-2">
      {attachments.map((attachment) => (
        <ComposerAttachmentPreviewCard
          key={attachment.id}
          attachment={attachment}
          onRemove={handleRemove}
        />
      ))}
    </div>
  );
}

// Provides the parent's combined running state to tool-call renderers so they
// can stop spinning when the user clicks stop. `thread.isRunning` alone misses
// the force-stopped case; `part.result === undefined` alone ignores stop.
const ChatRunningContext = React.createContext(false);

// ─── Tool Call Display ──────────────────────────────────────────────────────
// Shared presentational component for rendering a tool call pill + result.
// Used by both the normal message path (ToolCallFallback) and the reconnect
// stream path (ReconnectStreamMessage). All state is passed as props — no
// assistant-ui hooks here.

type ToolDetailSection = "input" | "result";
type ToolDetailPayload = {
  section: ToolDetailSection;
  title: string;
  text: string;
  copyText: string;
  lang: string;
};

function stringifyToolValue(value: unknown, pretty = false): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, pretty ? 2 : 0);
  } catch {
    return String(value ?? "");
  }
}

function toolArgsPreview(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([key, value]) => {
      const singleLine = stringifyToolValue(value).replace(/\s+/g, " ").trim();
      const preview =
        singleLine.length > 96 ? `${singleLine.slice(0, 96)}...` : singleLine;
      return `${key}=${preview}`;
    })
    .join(", ");
}

function looksLikeSql(text: string): boolean {
  return /^\s*(select|with|insert|update|delete|merge|create|alter|drop|explain|declare|begin)\b/i.test(
    text,
  );
}

function parseJsonText(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function inferToolTextLanguage(
  text: string,
  key?: string,
  toolName?: string,
): string {
  const keyName = (key ?? "").toLowerCase();
  const tool = (toolName ?? "").toLowerCase();
  if (
    keyName === "sql" ||
    keyName.endsWith("sql") ||
    keyName === "query" ||
    tool.includes("bigquery") ||
    tool.includes("db-query") ||
    looksLikeSql(text)
  ) {
    return "sql";
  }
  return parseJsonText(text) ? "json" : "text";
}

function formatToolTextValue(
  value: unknown,
  key?: string,
  toolName?: string,
): { text: string; lang: string } {
  if (typeof value === "string") {
    const parsed = parseJsonText(value);
    if (parsed) {
      return { text: JSON.stringify(parsed, null, 2), lang: "json" };
    }
    return {
      text: value,
      lang: inferToolTextLanguage(value, key, toolName),
    };
  }
  return { text: stringifyToolValue(value, true), lang: "json" };
}

function toolInputPayload(
  toolName: string,
  args: Record<string, unknown>,
): ToolDetailPayload | null {
  const entries = Object.entries(args);
  if (entries.length === 0) return null;
  if (entries.length === 1) {
    const [key, value] = entries[0]!;
    const formatted = formatToolTextValue(value, key, toolName);
    const normalizedKey = key.toLowerCase();
    const keyLabel =
      normalizedKey === "sql" || normalizedKey.endsWith("sql") ? "SQL" : key;
    return {
      section: "input",
      title: `Input - ${keyLabel}`,
      text: formatted.text,
      copyText:
        typeof value === "string" ? value : stringifyToolValue(value, true),
      lang: formatted.lang,
    };
  }
  return {
    section: "input",
    title: "Input",
    text: JSON.stringify(args, null, 2),
    copyText: JSON.stringify(args, null, 2),
    lang: "json",
  };
}

function toolResultPayload(
  result: string | undefined,
): ToolDetailPayload | null {
  if (result === undefined) return null;
  const formatted = formatToolTextValue(result);
  return {
    section: "result",
    title: "Result",
    text: formatted.text,
    copyText: result,
    lang: formatted.lang,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countTextMatches(text: string, query: string): number {
  const needle = query.trim();
  if (!needle) return 0;
  return Array.from(text.matchAll(new RegExp(escapeRegExp(needle), "gi")))
    .length;
}

function renderHighlightedSearchText(
  text: string,
  query: string,
): React.ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const regex = new RegExp(escapeRegExp(needle), "gi");
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(<mark key={`${match.index}-${match[0]}`}>{match[0]}</mark>);
    lastIndex = match.index + match[0].length;
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function ToolDetailViewer({ payload }: { payload: ToolDetailPayload }) {
  const [expanded, setExpanded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matchCount = useMemo(
    () => countTextMatches(payload.text, search),
    [payload.text, search],
  );

  useEffect(() => {
    return () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    };
  }, []);

  const copyValue = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(payload.copyText);
      setCopied(true);
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard failures should not interrupt chat rendering.
    }
  }, [payload.copyText]);

  return (
    <div className="rounded-md border border-border/50 bg-background/60">
      <div className="flex min-h-9 flex-wrap items-center gap-2 border-b border-border/50 px-2.5 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[11px] font-medium text-foreground/85">
              {payload.title}
            </span>
            {payload.lang !== "text" && (
              <span className="shrink-0 rounded border border-border/60 px-1 py-0.5 font-mono text-[9px] uppercase leading-none text-muted-foreground">
                {payload.lang}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSearchOpen((v) => !v)}
          aria-label={`Search ${payload.title.toLowerCase()}`}
          aria-pressed={searchOpen}
          className={cn(
            "inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
            searchOpen && "bg-accent text-foreground",
          )}
        >
          <IconSearch size={12} />
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Shrink code viewer" : "Expand code viewer"}
          aria-pressed={expanded}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {expanded ? (
            <IconArrowsMinimize size={12} />
          ) : (
            <IconArrowsMaximize size={12} />
          )}
        </button>
        <button
          type="button"
          onClick={copyValue}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 font-sans text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-border/50 px-2.5 py-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find"
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          />
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {search.trim() ? matchCount : ""}
          </span>
        </div>
      )}
      <div
        className={cn(
          "agent-tool-code overflow-auto font-mono text-[11px] leading-relaxed text-foreground",
          expanded ? "max-h-[70vh]" : "max-h-72",
        )}
      >
        {search.trim() ? (
          <pre>
            <code>{renderHighlightedSearchText(payload.text, search)}</code>
          </pre>
        ) : (
          <HighlightedCodeBlock code={payload.text} lang={payload.lang} />
        )}
      </div>
    </div>
  );
}

function activityTrailFromMetadata(message: unknown): ActivityStep[] {
  const meta = (message as { metadata?: unknown })?.metadata as
    | {
        custom?: { activityTrail?: unknown };
        activityTrail?: unknown;
      }
    | undefined;
  const raw = meta?.custom?.activityTrail ?? meta?.activityTrail;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index): ActivityStep | null => {
      if (!item || typeof item !== "object") return null;
      const label = (item as { label?: unknown }).label;
      const tool = (item as { tool?: unknown }).tool;
      if (typeof label !== "string" || !label.trim()) return null;
      return {
        id: `trail-${index}-${label}`,
        label: label.trim(),
        ...(typeof tool === "string" && tool.trim()
          ? { tool: tool.trim() }
          : {}),
      };
    })
    .filter((item): item is ActivityStep => item !== null);
}

function RunActivityTrail({ steps }: { steps: ActivityStep[] }) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  const visibleSteps = steps.slice(-6);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        <IconChevronDown
          size={12}
          className={cn("transition-transform", open && "rotate-180")}
        />
        Steps
      </button>
      {open && (
        <div className="mt-1 rounded-md border border-border/60 bg-muted/25 px-2.5 py-2 text-[11px] text-muted-foreground">
          <div className="space-y-1">
            {visibleSteps.map((step) => (
              <div key={step.id} className="flex min-w-0 items-center gap-2">
                <IconCheck className="h-3 w-3 shrink-0 text-emerald-500" />
                <span className="truncate">{step.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolCallDisplay({
  toolName,
  argsText,
  args,
  result,
  isRunning,
}: {
  toolName: string;
  argsText?: string;
  args: Record<string, unknown>;
  result?: string;
  isRunning: boolean;
}) {
  const streamRef = useRef<HTMLDivElement>(null);
  const isAgentCall = toolName.startsWith("agent:");
  const [expanded, setExpanded] = useState(isAgentCall);
  const agentName = isAgentCall ? toolName.slice(6) : null;
  const isAgentError = isAgentCall && result === "Error calling agent";
  const agentStreamText = isAgentCall ? (argsText ?? "") : "";
  const hasStreamText = agentStreamText.length > 0;
  const hasArgs = !isAgentCall && Object.keys(args).length > 0;

  // NOTE: All hooks must be above any conditional returns
  useEffect(() => {
    if (isAgentCall && isRunning && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [agentStreamText, isAgentCall, isRunning]);

  // Render connect-builder as ConnectBuilderCard once the result is available
  if (toolName === "connect-builder" && result) {
    try {
      const parsed = JSON.parse(result);
      if (parsed?.kind === "connect-builder-card") {
        return (
          <ConnectBuilderCard
            configured={!!parsed.configured}
            builderEnabled={parsed.builderEnabled !== false}
            // Ignore saved cliAuthUrl values from older tool results. They
            // contain signed callback state and can expire while a chat sits
            // open; the card's hook fetches a fresh signed URL on mount/click.
            connectUrl={parsed.connectUrl || ""}
            orgName={parsed.orgName ?? null}
            prompt={typeof parsed.prompt === "string" ? parsed.prompt : ""}
          />
        );
      }
    } catch {
      // fall through to default pill rendering
    }
  }

  // Render agent-teams spawn as AgentTaskCard once the result is available
  if (
    toolName === "agent-teams" &&
    (args as Record<string, string>)?.action === "spawn" &&
    result
  ) {
    try {
      const parsed = JSON.parse(result);
      if (parsed.taskId && parsed.threadId) {
        return (
          <AgentTaskCard
            taskId={parsed.taskId}
            threadId={parsed.threadId}
            description={
              parsed.description ||
              (args as Record<string, string>)?.task ||
              "Sub-agent task"
            }
            onOpen={(tid) => {
              window.dispatchEvent(
                new CustomEvent("agent-task-open", {
                  detail: {
                    threadId: tid,
                    description:
                      parsed.description ||
                      (args as Record<string, string>)?.task ||
                      "",
                    name: parsed.name || "",
                  },
                }),
              );
            }}
          />
        );
      }
    } catch {
      // Fall through to default pill rendering
    }
  }

  const argsStr = isAgentCall ? "" : toolArgsPreview(args);
  const inputPayload = hasArgs ? toolInputPayload(toolName, args) : null;
  const resultPayload = toolResultPayload(result);

  const displayName = isAgentCall
    ? isRunning
      ? `Asking ${agentName}...`
      : isAgentError
        ? `Error asking ${agentName}`
        : `Asked ${agentName}`
    : toolName;

  const canExpand = isAgentCall
    ? hasStreamText
    : hasArgs || result !== undefined;
  const isExpanded = isAgentCall ? hasStreamText && expanded : expanded;

  return (
    <div className="my-1 overflow-hidden">
      <button
        onClick={() => canExpand && setExpanded(!isExpanded)}
        aria-expanded={canExpand ? isExpanded : undefined}
        className={cn(
          "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-mono w-full text-left overflow-hidden",
          isRunning
            ? "bg-muted text-muted-foreground"
            : "bg-muted text-muted-foreground hover:bg-accent",
        )}
      >
        <span className="shrink-0">
          {isRunning ? (
            <IconLoader2 className="h-3 w-3 animate-spin" />
          ) : isAgentError ? (
            <IconCircleX className="h-3 w-3 text-destructive" />
          ) : result !== undefined ? (
            <IconCheck className="h-3 w-3 text-emerald-500" />
          ) : (
            <IconSquareFilled className="h-3 w-3 text-muted-foreground" />
          )}
        </span>
        <span className="truncate min-w-0">
          <span className="font-medium">{displayName}</span>
          {argsStr && <span className="opacity-60 ml-1">({argsStr})</span>}
        </span>
        {canExpand && (
          <IconChevronDown
            className={cn(
              "ml-auto h-3 w-3 shrink-0 opacity-40",
              isExpanded && "rotate-180",
            )}
          />
        )}
      </button>
      {isExpanded && isAgentCall && hasStreamText && (
        <div
          ref={streamRef}
          className="mt-1 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground break-words max-h-48 overflow-y-auto agent-markdown prose prose-sm prose-invert max-w-none"
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
            urlTransform={markdownUrlTransform}
          >
            {agentStreamText}
          </ReactMarkdown>
        </div>
      )}
      {isExpanded && !isAgentCall && (hasArgs || result !== undefined) && (
        <div className="mt-1 space-y-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          {inputPayload && <ToolDetailViewer payload={inputPayload} />}
          {resultPayload && <ToolDetailViewer payload={resultPayload} />}
        </div>
      )}
    </div>
  );
}

function ToolCallFallback({
  toolName,
  args,
  argsText,
  result,
}: ToolCallMessagePartProps) {
  const chatRunning = React.useContext(ChatRunningContext);
  const isRunning = result === undefined && chatRunning;
  return (
    <ToolCallDisplay
      toolName={toolName}
      args={args as Record<string, unknown>}
      argsText={argsText}
      result={
        typeof result === "string"
          ? result
          : result !== undefined
            ? JSON.stringify(result)
            : undefined
      }
      isRunning={isRunning}
    />
  );
}

// ─── Reconnect Stream Message ───────────────────────────────────────────────
// Renders the agent's in-progress response during reconnection (outside
// assistant-ui's runtime). Uses the same visual styling as normal messages.

function ReconnectStreamMessage({ content }: { content: ContentPart[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const chatRunning = React.useContext(ChatRunningContext);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [content]);

  return (
    <div className="flex justify-start">
      <div className="max-w-[95%] text-sm leading-relaxed text-foreground space-y-1">
        {content.map((part, i) => {
          if (part.type === "text") {
            return (
              <div
                key={`reconnect-text-${i}`}
                className="agent-markdown break-words"
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                  urlTransform={markdownUrlTransform}
                >
                  {part.text}
                </ReactMarkdown>
              </div>
            );
          }
          if (part.type === "tool-call") {
            return (
              <ToolCallDisplay
                key={`reconnect-tool-${i}`}
                toolName={part.toolName}
                argsText={part.argsText}
                args={part.args}
                result={part.result}
                isRunning={part.result === undefined && chatRunning}
              />
            );
          }
          return null;
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ─── Message Components ─────────────────────────────────────────────────────

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

export function displayableUserMessageText(text: string): string {
  return text.replace(/<context>[\s\S]*?<\/context>\n?/g, "").trim();
}

export function isAssistantUiStaleIndexError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /^tapClientLookup: Index \d+ out of bounds \(length: \d+\)$/.test(
    message,
  );
}

type AssistantUiStaleIndexErrorBoundaryProps = {
  resetKey: string;
  componentName?: string;
  children: React.ReactNode;
};

type AssistantUiStaleIndexErrorBoundaryState = {
  error: Error | null;
  retryToken: number;
};

export class AssistantUiStaleIndexErrorBoundary extends React.Component<
  AssistantUiStaleIndexErrorBoundaryProps,
  AssistantUiStaleIndexErrorBoundaryState
> {
  state: AssistantUiStaleIndexErrorBoundaryState = {
    error: null,
    retryToken: 0,
  };

  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(
    error: unknown,
  ): Partial<AssistantUiStaleIndexErrorBoundaryState> {
    return {
      error: error instanceof Error ? error : new Error(String(error ?? "")),
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    if (!isAssistantUiStaleIndexError(error)) return;

    captureError(error, {
      tags: {
        component: this.props.componentName ?? "AssistantChat",
        recoverable: "assistant-ui-stale-message-index",
      },
      extra: {
        resetKey: this.props.resetKey,
        componentStack: info.componentStack,
      },
    });

    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.setState((state) => {
        if (!state.error || !isAssistantUiStaleIndexError(state.error)) {
          return null;
        }
        return { error: null, retryToken: state.retryToken + 1 };
      });
    }, 0);
  }

  componentDidUpdate(prevProps: AssistantUiStaleIndexErrorBoundaryProps) {
    if (
      this.state.error &&
      isAssistantUiStaleIndexError(this.state.error) &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState((state) => ({
        error: null,
        retryToken: state.retryToken + 1,
      }));
    }
  }

  componentWillUnmount() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
  }

  render() {
    if (this.state.error) {
      if (!isAssistantUiStaleIndexError(this.state.error)) {
        throw this.state.error;
      }
      return null;
    }

    return (
      <React.Fragment key={`${this.props.resetKey}:${this.state.retryToken}`}>
        {this.props.children}
      </React.Fragment>
    );
  }
}

export function AssistantMessageListErrorBoundary({
  resetKey,
  children,
}: {
  resetKey: string;
  children: React.ReactNode;
}) {
  return (
    <AssistantUiStaleIndexErrorBoundary
      resetKey={resetKey}
      componentName="AssistantMessageList"
    >
      {children}
    </AssistantUiStaleIndexErrorBoundary>
  );
}

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

        const imagePart = att.content?.find(
          (p): p is { type: "image"; image: string } =>
            p.type === "image" && "image" in p && !!p.image,
        );
        if (imagePart) {
          return (
            <div
              key={att.id}
              className="h-16 w-16 overflow-hidden rounded-lg border border-border/70 bg-muted/50"
              title={att.name}
            >
              <img
                src={imagePart.image}
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

function UserMessage() {
  const [expanded, setExpanded] = useState(false);
  const [isExpandable, setIsExpandable] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const messageRuntime = useMessageRuntime();
  const message = messageRuntime.getState();
  const timestamp = formatMessageTimestamp(message.createdAt);
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
        {timestamp && (
          <div className="mt-1 flex justify-end">
            <MessageTimestamp
              timestamp={timestamp}
              className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
            />
          </div>
        )}
      </div>
    </div>
  );
}

const CheckpointContext = React.createContext<{
  apiUrl: string;
  devMode: boolean;
  threadId?: string;
} | null>(null);

const MessageActionsContext = React.createContext<{
  onForkChat?: () => void;
} | null>(null);

function MessageActionsMenu({
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
    navigator.clipboard.writeText(text);
    setCopied("message");
    setTimeout(() => {
      setCopied(null);
      setOpen(false);
    }, 1000);
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
    navigator.clipboard.writeText(runId);
    setCopied("id");
    setTimeout(() => {
      setCopied(null);
      setOpen(false);
    }, 1000);
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

function AssistantMessage() {
  const [restoreState, setRestoreState] = useState<
    "idle" | "confirming" | "restoring"
  >("idle");
  const messageRuntime = useMessageRuntime();
  const thread = useThread();
  const chatRunning = React.useContext(ChatRunningContext);
  const msg = messageRuntime.getState();
  const timestamp = formatMessageTimestamp(msg.createdAt);
  const activityTrail = activityTrailFromMetadata(msg);
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
      const checkpoints: any[] = res.ok ? await res.json() : [];
      const checkpoint = checkpoints.find((cp: any) => cp.runId === runId);
      if (!checkpoint) {
        setRestoreState("idle");
        return;
      }
      const restoreRes = await fetch(`${cpCtx.apiUrl}/checkpoints/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkpointId: checkpoint.id }),
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
      </div>
      {isComplete && activityTrail.length > 0 && (
        <RunActivityTrail steps={activityTrail} />
      )}
      {isComplete && (
        <div className="mt-1 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <MessageActionsMenu
              showRevert={showRestore && restoreState === "idle"}
              onRevert={handleRestore}
            />
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

// ─── Thinking Indicator ─────────────────────────────────────────────────────

interface ActivityStep {
  id: string;
  label: string;
  tool?: string;
}

function ActivitySteps({ steps }: { steps: ActivityStep[] }) {
  if (steps.length === 0) return null;
  const visibleSteps = steps.slice(-4);
  return (
    <div
      className="max-w-[85%] rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground"
      aria-live="polite"
    >
      <div className="space-y-1">
        {visibleSteps.map((step, index) => {
          const isCurrent = index === visibleSteps.length - 1;
          return (
            <div key={step.id} className="flex min-w-0 items-center gap-2">
              {isCurrent ? (
                <IconLoader2 className="h-3 w-3 shrink-0 animate-spin" />
              ) : (
                <IconCheck className="h-3 w-3 shrink-0 text-emerald-500" />
              )}
              <span className="truncate">{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThinkingIndicator({ label = "Thinking" }: { label?: string } = {}) {
  const [dots, setDots] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d + 1) % 4);
    }, 400);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="flex items-center text-muted-foreground">
      <span className="text-xs">
        {label}
        {".".repeat(dots)}
      </span>
    </div>
  );
}

// ─── Builder.io Connect CTA (shared by setup + usage-limit cards) ───────────
//
// Renders a single row with left-aligned copy and a right-aligned action.
// Click opens the Builder CLI-auth popup via the shared
// `useBuilderConnectFlow` hook (which owns the synchronous window.open,
// the 2s status poll, and the focus-refresh). On success the hook broadcasts
// a config-change event and this card clears its local `missingApiKey` gate
// so the user can start chatting without a full-page reload.
//
// Desktop note: when this component runs inside the Electron shell, the
// window.open call is intercepted by the main process's webview popup handler,
// which opens the flow in an Electron BrowserWindow that shares the webview's
// session. See packages/desktop-app/src/main/index.ts.

function BuilderConnectCta({
  variant = "primary",
  onConnected,
}: {
  variant?: "primary" | "compact";
  onConnected?: () => void;
}) {
  const { configured, orgName, connecting, error, start } =
    useBuilderConnectFlow({
      trackingSource: "assistant_chat_builder_cta",
      onConnected,
    });

  const containerClass =
    variant === "compact"
      ? "rounded-md border border-border px-3 py-2.5"
      : "flex items-center gap-3 rounded-md border border-border px-3 py-3";

  if (configured) {
    return (
      <div className={containerClass}>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-foreground">Builder.io</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {orgName ? `Connected — ${orgName}` : "Connected"}
          </p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 shrink-0 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
          <IconCheck size={10} />
          Connected
        </span>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-foreground">
          Connect Builder.io
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 max-w-[220px]">
          Free credits for LLM, hosting, and more — no API key needed
        </p>
        {error && <p className="mt-1 text-[10px] text-destructive">{error}</p>}
      </div>
      <button
        type="button"
        onClick={start}
        disabled={connecting}
        className="ml-auto inline-flex items-center gap-1 shrink-0 rounded-md bg-foreground px-3 py-1.5 text-[11px] font-medium no-underline text-background hover:opacity-90 disabled:opacity-60 disabled:cursor-wait"
        aria-busy={connecting}
      >
        {connecting ? (
          <>
            <IconLoader2 size={10} className="animate-spin" />
            Waiting…
          </>
        ) : (
          <>
            Connect
            <IconExternalLink size={10} />
          </>
        )}
      </button>
    </div>
  );
}

// ─── Builder Setup Card ─────────────────────────────────────────────────────

function BuilderSetupCard({
  onConnected,
  bouncePulse,
}: {
  onConnected?: () => void;
  bouncePulse?: number;
}) {
  const openSettings = useCallback(() => {
    try {
      window.location.hash = "llm";
    } catch {}
    window.dispatchEvent(new CustomEvent("agent-panel:open-settings"));
  }, []);

  const cardRef = useRef<HTMLDivElement>(null);
  // Replay the bounce keyframe each time bouncePulse increments. Toggling the
  // class off-then-on (with a forced reflow) restarts the animation even when
  // the value changes back-to-back.
  useEffect(() => {
    if (!bouncePulse) return;
    const el = cardRef.current;
    if (!el) return;
    el.classList.remove("animate-bounce-once");
    void el.offsetWidth;
    el.classList.add("animate-bounce-once");
  }, [bouncePulse]);

  return (
    <div
      ref={cardRef}
      className="mx-4 my-6 rounded-lg border border-border bg-card p-5"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
          <IconMessage className="h-4.5 w-4.5 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Turn on the AI assistant
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            One click to connect Builder for free hosted access — no API keys
            needed.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <BuilderConnectCta onConnected={onConnected} />
        <div className="text-center">
          <button
            type="button"
            onClick={openSettings}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Or add your own API key
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Loop Limit Continue Card ───────────────────────────────────────────────

type LoopLimitInfo = { maxIterations?: number };
type RunErrorInfo = {
  message: string;
  details?: string;
  errorCode?: string;
  runId?: string;
  recoverable?: boolean;
};

interface AgentLoopSettingsResponse {
  maxIterations: number;
  defaultMaxIterations: number;
  minMaxIterations: number;
  maxMaxIterations: number;
  scope: "org" | "user" | "default";
  source: "org" | "user" | "env" | "default";
  canUpdate: boolean;
  orgName?: string | null;
  role?: string | null;
}

function getLoopLimitMetadata(message: unknown): LoopLimitInfo | null {
  const meta = (message as { metadata?: unknown })?.metadata as
    | {
        custom?: { loopLimit?: LoopLimitInfo };
        loopLimit?: LoopLimitInfo;
      }
    | undefined;
  const loopLimit = meta?.custom?.loopLimit ?? meta?.loopLimit;
  if (!loopLimit || typeof loopLimit !== "object") return null;
  return {
    ...(typeof loopLimit.maxIterations === "number"
      ? { maxIterations: loopLimit.maxIterations }
      : {}),
  };
}

function getRunErrorMetadata(message: unknown): RunErrorInfo | null {
  const meta = (message as { metadata?: unknown })?.metadata as
    | {
        custom?: { runError?: RunErrorInfo; runId?: unknown };
        runError?: RunErrorInfo;
        runId?: unknown;
      }
    | undefined;
  const runError = meta?.custom?.runError ?? meta?.runError;
  if (!runError || typeof runError !== "object") return null;
  const messageText =
    typeof runError.message === "string" ? runError.message : "";
  if (!messageText) return null;
  const runId =
    typeof runError.runId === "string"
      ? runError.runId
      : typeof meta?.custom?.runId === "string"
        ? meta.custom.runId
        : typeof meta?.runId === "string"
          ? meta.runId
          : undefined;
  return {
    message: messageText,
    ...(typeof runError.details === "string"
      ? { details: runError.details }
      : {}),
    ...(typeof runError.errorCode === "string"
      ? { errorCode: runError.errorCode }
      : {}),
    ...(runId ? { runId } : {}),
    ...(runError.recoverable ? { recoverable: true } : {}),
  };
}

function getRequestModeMetadata(message: unknown): AgentRequestMode | null {
  const meta = (message as { metadata?: unknown })?.metadata as
    | {
        custom?: { requestMode?: unknown };
        requestMode?: unknown;
      }
    | undefined;
  const requestMode = meta?.custom?.requestMode ?? meta?.requestMode;
  return requestMode === "act" || requestMode === "plan" ? requestMode : null;
}

function isBuilderReconnectRunError(info: RunErrorInfo): boolean {
  const code = (info.errorCode ?? "").toLowerCase();
  const message = info.message.toLowerCase();
  const isAuthCode =
    code === "authentication_error" ||
    code === "unauthorized" ||
    code === "http_401" ||
    code === "http_403";
  return (
    code === "builder_auth_error" ||
    message.includes("builder authentication failed") ||
    (isAuthCode && message.includes("invalid token"))
  );
}

function isProviderQueryRunError(info: RunErrorInfo): boolean {
  const text = [info.errorCode, info.message, info.details]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return (
    text.includes("bigquery") ||
    text.includes("sql") ||
    text.includes("query") ||
    text.includes("schema") ||
    text.includes("syntax") ||
    text.includes("unknown column") ||
    text.includes("unknown table") ||
    text.includes("type mismatch")
  );
}

function isConnectionRecoveryRunError(info: RunErrorInfo): boolean {
  const code = (info.errorCode ?? "").toLowerCase();
  const message = info.message.toLowerCase();
  return (
    code === "connection_error" ||
    message.includes("connection kept failing") ||
    message.includes("automatic recovery attempts")
  );
}

function getMessageText(message: unknown): string {
  const msg = (message as { message?: unknown })?.message ?? message;
  const content = (msg as { content?: unknown })?.content;
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p?.type === "text" && typeof p.text === "string")
      .map((p: any) => p.text)
      .join("\n")
      .trim();
  }
  return typeof content === "string" ? content.trim() : "";
}

function RunErrorRecoveryCard({
  info,
  onContinue,
  onRetry,
  onFork,
  onDismiss,
}: {
  info: RunErrorInfo;
  onContinue: () => void;
  onRetry: () => void;
  onFork?: () => void;
  onDismiss: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const builderReconnect = useBuilderConnectFlow({
    trackingSource: "assistant_chat_reconnect_error",
  });
  const canRecover = info.recoverable === true;
  const shouldShowBuilderReconnect = isBuilderReconnectRunError(info);
  const builderReconnectResolved =
    shouldShowBuilderReconnect &&
    builderReconnect.hasFetchedStatus &&
    builderReconnect.configured;
  const isQueryError = isProviderQueryRunError(info);
  const isConnectionRecoveryError = isConnectionRecoveryRunError(info);
  const copyLabel =
    info.runId || info.errorCode || info.details ? "Copy debug" : "Copy";
  const copyDetails = useCallback(() => {
    const text = [
      info.message,
      info.errorCode ? `Code: ${info.errorCode}` : "",
      info.runId ? `Run: ${info.runId}` : "",
      info.details ? `Details:\n${info.details}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [info]);
  const startNewChat = useCallback(() => {
    window.dispatchEvent(new CustomEvent("agent-chat:new-chat"));
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    if (builderReconnectResolved) {
      onDismiss();
    }
  }, [builderReconnectResolved, onDismiss]);

  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3 text-sm">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300">
          <IconAlertTriangle size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground">
            {canRecover
              ? "The agent stopped before finishing"
              : "The agent hit an error"}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {info.message}
          </p>
          {shouldShowBuilderReconnect && !builderReconnectResolved && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              The current Builder.io or model-provider credential was rejected.
              Reconnect Builder.io, then retry this message.
            </p>
          )}
          {isConnectionRecoveryError && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              If retry lands on the same error, start a new chat session and
              continue from what already changed.
            </p>
          )}
          {(info.runId || info.errorCode || info.details) && (
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              <IconChevronDown
                size={12}
                className={cn(
                  "transition-transform",
                  detailsOpen && "rotate-180",
                )}
              />
              Details
            </button>
          )}
          {detailsOpen && (
            <div className="mt-2 rounded-md border border-border/60 bg-background/70 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {info.runId && <div>run: {info.runId}</div>}
              {info.errorCode && <div>code: {info.errorCode}</div>}
              {info.details && (
                <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono">
                  {info.details}
                </pre>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background/80 hover:text-foreground"
        >
          <IconX size={14} />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {shouldShowBuilderReconnect && !builderReconnectResolved && (
          <button
            type="button"
            onClick={builderReconnect.start}
            disabled={builderReconnect.connecting}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
          >
            {builderReconnect.connecting ? (
              <IconLoader2 size={13} className="animate-spin" />
            ) : (
              <IconExternalLink size={13} />
            )}
            {builderReconnect.connecting
              ? "Connecting Builder.io"
              : "Reconnect Builder.io"}
          </button>
        )}
        {canRecover && (
          <>
            <button
              type="button"
              onClick={onContinue}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background hover:opacity-90"
            >
              <IconPlayerPlay size={13} />
              Continue
            </button>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent"
            >
              <IconRefresh size={13} />
              {isQueryError ? "Diagnose and retry" : "Retry"}
            </button>
          </>
        )}
        {canRecover && isConnectionRecoveryError && (
          <button
            type="button"
            onClick={startNewChat}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent"
          >
            <IconPlus size={13} />
            New chat
          </button>
        )}
        {canRecover && onFork && !isConnectionRecoveryError && (
          <button
            type="button"
            onClick={onFork}
            title="Fork this conversation into a separate chat thread."
            aria-label="Fork this conversation into a separate chat thread"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent"
          >
            <IconGitFork size={13} />
            Fork chat
          </button>
        )}
        <button
          type="button"
          onClick={copyDetails}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-background/80 hover:text-foreground"
        >
          {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
          {copied ? "Copied" : copyLabel}
        </button>
      </div>
      {shouldShowBuilderReconnect && builderReconnect.error && (
        <p className="mt-2 text-xs leading-relaxed text-red-500">
          {builderReconnect.error}
        </p>
      )}
    </div>
  );
}

function LoopLimitContinueCard({
  info,
  onContinue,
}: {
  info: LoopLimitInfo;
  onContinue: () => void;
}) {
  const [settings, setSettings] = useState<AgentLoopSettingsResponse | null>(
    null,
  );
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    fetch(agentNativePath("/_agent-native/agent-loop-settings"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data: AgentLoopSettingsResponse | null) => {
        if (cancelled || !data) return;
        setSettings(data);
        setValue(String(data.maxIterations));
      })
      .catch(() => {
        if (!cancelled) setValue(String(info.maxIterations ?? ""));
      });
    return () => {
      cancelled = true;
    };
  }, [info.maxIterations]);

  useEffect(() => load(), [load]);

  const currentLimit = settings?.maxIterations ?? info.maxIterations;
  const numericValue = Number(value);
  const hasPendingChange =
    !!settings &&
    settings.canUpdate &&
    Number.isInteger(numericValue) &&
    numericValue !== settings.maxIterations;
  const scopeLabel =
    settings?.scope === "org"
      ? settings.orgName
        ? `${settings.orgName} org`
        : "org"
      : "your account";

  const saveLimit = useCallback(async (): Promise<boolean> => {
    if (!settings?.canUpdate) return false;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/agent-loop-settings"),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ maxIterations: numericValue }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      setSettings(body as AgentLoopSettingsResponse);
      setValue(String((body as AgentLoopSettingsResponse).maxIterations));
      setSaved(true);
      window.dispatchEvent(
        new CustomEvent("agent-loop-settings:changed", { detail: body }),
      );
      setTimeout(() => setSaved(false), 2000);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  }, [numericValue, settings?.canUpdate]);

  const handleContinue = useCallback(async () => {
    if (hasPendingChange) {
      const ok = await saveLimit();
      if (!ok) return;
    }
    onContinue();
  }, [hasPendingChange, onContinue, saveLimit]);

  const openSettings = useCallback(() => {
    try {
      window.location.hash = "agent-limits";
    } catch {}
    window.dispatchEvent(new CustomEvent("agent-panel:open-settings"));
  }, []);

  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-3 shadow-sm">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <IconGauge size={14} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Step limit reached
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            The agent used{" "}
            {currentLimit
              ? `${currentLimit.toLocaleString()} steps`
              : "all available steps"}
            . Keep going in a fresh turn, or raise the {scopeLabel} limit first.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-[116px] flex-1 space-y-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Max steps
          </span>
          <input
            type="number"
            min={settings?.minMaxIterations ?? 1}
            max={settings?.maxMaxIterations ?? 1000}
            value={value}
            disabled={!settings?.canUpdate || saving}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
        </label>
        <button
          type="button"
          onClick={saveLimit}
          disabled={!hasPendingChange || saving}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
        >
          {saving ? (
            <IconLoader2 size={12} className="animate-spin" />
          ) : saved ? (
            <IconCheck size={12} />
          ) : (
            "Save"
          )}
        </button>
        <button
          type="button"
          onClick={openSettings}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <IconSettings size={12} />
          Settings
        </button>
        <button
          type="button"
          onClick={handleContinue}
          disabled={saving}
          className="ml-auto inline-flex h-8 items-center gap-1 rounded-md bg-foreground px-3 text-xs font-medium text-background hover:opacity-90 disabled:opacity-60"
        >
          {hasPendingChange ? "Save and keep going" : "Keep going"}
          <IconArrowRight size={12} />
        </button>
      </div>

      {settings && !settings.canUpdate && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Only organization owners and admins can change this limit.
        </p>
      )}
      {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function PlanModeCallout({
  canImplementPlan,
  onImplementPlan,
  onSwitchToAct,
}: {
  canImplementPlan: boolean;
  onImplementPlan: () => void;
  onSwitchToAct: () => void;
}) {
  return (
    <div className="shrink-0 px-3 pt-2">
      <div className="rounded-lg border border-blue-500/25 bg-blue-500/[0.06] px-3 py-2.5 shadow-sm">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-300">
            <IconClipboardList size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              {canImplementPlan ? "Plan ready" : "Plan mode is on"}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {canImplementPlan
                ? "Switch to Act and run the proposed plan."
                : "The next turn will stay read-only until you switch to Act."}
            </p>
          </div>
          {canImplementPlan ? (
            <button
              type="button"
              onClick={onImplementPlan}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background hover:opacity-90"
            >
              <IconPlayerPlay size={13} />
              Implement Plan
            </button>
          ) : (
            <button
              type="button"
              onClick={onSwitchToAct}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent"
            >
              Act
              <IconArrowRight size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export interface AssistantChatHandle {
  /** Programmatically send a message into this chat */
  sendMessage(text: string): void;
  /** Queue a message to send after the current run finishes */
  queueMessage(text: string): void;
  /** Whether the chat is currently running */
  isRunning(): boolean;
  /** Focus the composer input */
  focusComposer(): void;
  /** Export the currently visible client-side thread for operations like fork. */
  exportThreadSnapshot(): ChatThreadSnapshot | null;
}

export interface AssistantChatProps {
  /** API endpoint URL. Default: "/_agent-native/agent-chat" */
  apiUrl?: string;
  /** Stable tab identifier passed to the adapter for event correlation */
  tabId?: string;
  /** Stable browser tab id used for tab-scoped app-state context. */
  browserTabId?: string;
  /** Thread ID for SQL-backed persistence. When set, messages are loaded from and saved to the server. */
  threadId?: string;
  /** Resource scope to include with chat requests for server-side context. */
  contextScope?: ChatThreadScope | null;
  /** Placeholder text for empty state */
  emptyStateText?: string;
  /** Suggestion prompts shown when no messages */
  suggestions?: string[];
  /** Optional content rendered in the empty state, above the suggestion buttons.
   *  Used by MultiTabAssistantChat to surface "previous chats for this design"
   *  when the current thread is empty but the scope has other threads. */
  emptyStateAddon?: React.ReactNode;
  /** Whether to show the header bar. Default: true */
  showHeader?: boolean;
  /** CSS class for the outer container */
  className?: string;
  /** Callback when user clicks "Use CLI" button */
  onSwitchToCli?: () => void;
  /** Callback when message count changes */
  onMessageCountChange?: (count: number) => void;
  /** Callback to save thread data to the server (provided by useChatThreads) */
  onSaveThread?: (
    threadId: string,
    data: {
      threadData: string;
      title: string;
      preview: string;
      messageCount: number;
    },
  ) => void;
  /** Callback to generate a title from the first user message */
  onGenerateTitle?: (threadId: string, message: string) => void;
  /** Optional content rendered just above the composer input */
  composerSlot?: React.ReactNode;
  /** Disable the composer for capability-gated surfaces while still showing history. */
  composerDisabled?: boolean;
  /** Placeholder to show while the composer is disabled by the host surface. */
  composerDisabledPlaceholder?: string;
  /** When true, skip the restore skeleton (used for freshly created threads with no messages) */
  isNewThread?: boolean;
  /** Called when a slash command (e.g. /clear, /help) is executed */
  onSlashCommand?: (command: string) => void;
  /** Current execution mode (build/plan) */
  execMode?: "build" | "plan";
  /** Callback to change execution mode */
  onExecModeChange?: (mode: "build" | "plan") => void;
  /** Disable Plan mode while leaving Act mode available. */
  planModeDisabled?: boolean;
  /** Explanation shown next to the disabled Plan option. */
  planModeDisabledReason?: string;
  /** Selected model override for this conversation (undefined = use server default) */
  selectedModel?: string;
  /** Default model from server config (shown in picker when no override is set) */
  defaultModel?: string;
  /** Selected engine override for this conversation */
  selectedEngine?: string;
  /** Selected reasoning effort override for this conversation */
  selectedEffort?: ReasoningEffort;
  /** Available engine/model list for the model picker */
  availableModels?: Array<{
    engine: string;
    label: string;
    models: string[];
    configured: boolean;
  }>;
  /** Callback when user picks a model from the picker */
  onModelChange?: (model: string, engine: string) => void;
  /** Callback when user picks a reasoning effort from the picker */
  onEffortChange?: (effort: ReasoningEffort) => void;
  /** Callback when user clicks "Fork Chat" in the message actions menu */
  onForkChat?: () => void;
}

export const CHAT_STORAGE_PREFIX = "agent-chat:";

/** Remove persisted chat for a given tabId (or "default"). */
export function clearChatStorage(tabId?: string) {
  try {
    sessionStorage.removeItem(`${CHAT_STORAGE_PREFIX}${tabId || "default"}`);
  } catch {}
}

/**
 * Ensure all messages in a thread repository have required fields.
 * assistant-ui accesses `message.metadata.submittedFeedback` and
 * `lastMessage.status.type` without null-checking, so server-constructed
 * messages missing these fields crash.
 */
function ensureMessageMetadata(repo: any): any {
  if (!repo?.messages || !Array.isArray(repo.messages)) return repo;
  for (const entry of repo.messages) {
    // Handle both wrapped ({ message: { ... } }) and flat ({ role, ... }) formats
    const msg = entry?.message ?? entry;
    if (!msg) continue;
    if (!msg.metadata) {
      msg.metadata = {};
    }
    if (msg.role === "assistant") {
      const statusType =
        msg.status && typeof msg.status === "object"
          ? (msg.status as { type?: unknown }).type
          : undefined;
      const isTerminal =
        statusType === "complete" || statusType === "incomplete";
      if (!isTerminal) {
        const runError =
          msg.metadata?.custom?.runError ?? msg.metadata?.runError;
        msg.status = runError
          ? { type: "incomplete", reason: "error" }
          : { type: "complete", reason: "stop" };
      }
    }
  }
  return repo;
}

// Re-export for backwards compatibility
import {
  extractThreadMeta,
  normalizeThreadRepository,
} from "../agent/thread-data-builder.js";
export { extractThreadMeta };

const AssistantChatInner = forwardRef<
  AssistantChatHandle,
  AssistantChatProps & { apiUrl: string }
>(function AssistantChatInner(
  {
    emptyStateText,
    suggestions,
    emptyStateAddon,
    showHeader = true,
    onSwitchToCli,
    className,
    apiUrl,
    tabId,
    threadId,
    onMessageCountChange,
    onSaveThread,
    onGenerateTitle,
    composerSlot,
    composerDisabled = false,
    composerDisabledPlaceholder,
    isNewThread,
    onSlashCommand,
    execMode,
    onExecModeChange,
    planModeDisabled,
    planModeDisabledReason,
    selectedModel,
    defaultModel,
    selectedEngine,
    selectedEffort,
    availableModels,
    onModelChange,
    onEffortChange,
    onForkChat,
  },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const thread = useThread();
  const threadRuntime = useThreadRuntime();
  const composerRuntime = useComposerRuntime();
  const isRuntimeRunning = thread.isRunning;
  const messages = thread.messages;
  const messageListResetKey = useMemo(
    () => messages.map((message) => message.id).join("|"),
    [messages],
  );

  // Chat-wide drag-and-drop: users expect to drop a file anywhere on the agent
  // sidebar (thread, header, composer) and have it attach — same as ChatGPT,
  // Claude.ai, Linear, Slack, etc. Tiptap's own `handleDrop` only fires inside
  // the contenteditable; drops on the message thread or the composer
  // attachment strip otherwise navigate to the file (browser default), which
  // is why "upload does nothing" — the chat refreshes to the dropped image.
  const [dropActive, setDropActive] = useState(false);
  const dropDepthRef = useRef(0);
  const handleChatDragEnter = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
    e.preventDefault();
    dropDepthRef.current += 1;
    setDropActive(true);
  }, []);
  const handleChatDragOver = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }, []);
  const handleChatDragLeave = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
    dropDepthRef.current = Math.max(0, dropDepthRef.current - 1);
    if (dropDepthRef.current === 0) setDropActive(false);
  }, []);
  const handleChatDrop = useCallback(
    (e: React.DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      dropDepthRef.current = 0;
      setDropActive(false);
      // Mirror TiptapComposer's paste/drop name-uniqueness so consecutive
      // screenshots (all named `image.png`) don't collide on the
      // SimpleImageAttachmentAdapter id.
      const attachments = files.map((file) => {
        if (!file.type.startsWith("image/")) return file;
        const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`;
        return new File([file], uniqueName, { type: file.type });
      });
      void Promise.all(
        attachments.map((file) => composerRuntime.addAttachment(file)),
      ).catch((error) => {
        console.error("Error adding dropped chat attachment:", error);
      });
    },
    [composerRuntime],
  );

  // Patch the underlying assistant-ui MessageRepository so addOrUpdateMessage
  // can't throw "Parent message not found" mid-run. assistant-ui calls
  // `repository.clear()` from `runtime.import()` and from `resetHead(null)`,
  // and on a few async paths (history-adapter load, branch reset, repeat
  // imports) the repo can be cleared between the `append` that added the
  // user message and the `performRoundtrip` call that tries to record the
  // assistant placeholder against that user message's id. The internal-bug
  // throw turns into an unhandled rejection that Sentry captures from the
  // images.agent-native.com prompt composer (AGENT-NATIVE-BROWSER-18). Fix
  // it by relinking to the current head whenever the requested parent has
  // gone missing instead of throwing.
  useEffect(() => {
    const repo = (threadRuntime as any)?.__internal_threadBinding?.getState?.()
      ?.repository as
      | { addOrUpdateMessage?: (parentId: any, message: any) => void }
      | undefined;
    if (!repo || typeof repo.addOrUpdateMessage !== "function") return;
    const patched = repo as any;
    if (patched.__agentNativePatched) return;
    patched.__agentNativePatched = true;
    const original = repo.addOrUpdateMessage.bind(repo);
    repo.addOrUpdateMessage = function (parentId: any, message: any) {
      try {
        return original(parentId, message);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (parentId && msg.includes("Parent message not found")) {
          const fallbackParent = (this as any).head?.current?.id ?? null;
          if (fallbackParent && fallbackParent !== parentId) {
            return original(fallbackParent, message);
          }
          return original(null, message);
        }
        throw err;
      }
    };
  }, [threadRuntime]);
  const [missingApiKey, setMissingApiKey] = useState(false);
  const isComposerDisabled = missingApiKey || composerDisabled;
  // Increments each time the user clicks the (disabled) composer while no LLM
  // is connected — `BuilderSetupCard` watches this to replay a one-shot bounce.
  const [missingKeyBouncePulse, setMissingKeyBouncePulse] = useState(0);
  const [authError, setAuthError] = useState<{
    sessionExpired?: boolean;
  } | null>(null);
  const [authSessionAvailable, setAuthSessionAvailable] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<
    Array<{
      id: string;
      text: string;
      images?: string[];
      attachments?: QueuedAttachment[];
      references?: Reference[];
      requestMode?: AgentRequestMode;
    }>
  >([]);
  // Tracks the JSON of the last queue we successfully persisted so the
  // debounced save effect can skip no-op writes (e.g. restore-from-server
  // on mount, or queue state that hasn't actually changed).
  const lastPersistedQueueRef = useRef<string>("[]");
  const [showContinue, setShowContinue] = useState(false);
  const [loopLimitInfo, setLoopLimitInfo] = useState<LoopLimitInfo | null>(
    null,
  );
  const [runErrorInfo, setRunErrorInfo] = useState<RunErrorInfo | null>(null);
  const [dismissedRunErrorKey, setDismissedRunErrorKey] = useState<
    string | null
  >(null);
  const userStoppedRunRef = useRef<{
    at: number;
    runId?: string;
  } | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectContent, setReconnectContent] = useState<ContentPart[]>([]);
  const [activityLabel, setActivityLabel] = useState<string | null>(null);
  const activityStepIdCounter = useRef(0);
  // When stop is clicked during reconnect, keep content visible (don't wipe it)
  const [reconnectFrozen, setReconnectFrozen] = useState(false);
  const reconnectRunIdRef = useRef<string | null>(null);
  const reconnectAbortRef = useRef<AbortController | null>(null);
  // Nuclear stop: user clicked stop. Clears the stop button/indicator AND
  // lets new submissions go through immediately — prevents the "stuck
  // queueing forever" state where isReconnecting or isRuntimeRunning gets
  // wedged (e.g. after a tab refresh + stop during reconnect).
  const [forceStopped, setForceStopped] = useState(false);
  // Real running state — drives submission/queue gating. Treat reconnecting
  // to an active run the same as running, UNLESS the user has explicitly
  // clicked stop (forceStopped).
  const isRunning = !forceStopped && (isRuntimeRunning || isReconnecting);
  // UI-only running state — drives the stop button and thinking indicator.
  const showRunningInUI = isRunning;
  const wasRunningRef = useRef(false);
  const lastBroadcastRunningRef = useRef(isRunning);
  const tiptapRef = useRef<TiptapComposerHandle>(null);
  const [activitySteps, setActivitySteps] = useState<ActivityStep[]>([]);

  useEffect(() => {
    if (lastBroadcastRunningRef.current === isRunning) return;
    lastBroadcastRunningRef.current = isRunning;
    window.dispatchEvent(
      new CustomEvent("agentNative.chatRunning", {
        detail: { isRunning, tabId: tabId || threadId },
      }),
    );
  }, [isRunning, tabId, threadId]);

  // ─── Chat persistence ──────────────────────────────────────────────
  const hasRestoredRef = useRef(false);
  const [isRestoring, setIsRestoring] = useState(!!threadId && !isNewThread);
  const onSaveThreadRef = useRef(onSaveThread);
  onSaveThreadRef.current = onSaveThread;
  const onGenerateTitleRef = useRef(onGenerateTitle);
  onGenerateTitleRef.current = onGenerateTitle;
  const titleGeneratedRef = useRef(false);

  const importThreadData = useCallback(
    (threadData: unknown, options?: { markTitleGenerated?: boolean }): any => {
      const repo = normalizeThreadRepository(
        typeof threadData === "string" ? JSON.parse(threadData) : threadData,
      );
      if (repo?.messages?.length > 0) {
        let shouldImport = true;
        try {
          shouldImport = shouldImportServerThreadData(
            normalizeThreadRepository(threadRuntime.export()),
            repo,
          );
        } catch {
          shouldImport = true;
        }
        if (shouldImport) {
          if (options?.markTitleGenerated) {
            titleGeneratedRef.current = true;
          }
          threadRuntime.import(ensureMessageMetadata(repo));
        }
      }
      if (Array.isArray(repo?.queuedMessages)) {
        setQueuedMessages(repo.queuedMessages);
        lastPersistedQueueRef.current = JSON.stringify(repo.queuedMessages);
      }
      return repo;
    },
    [threadRuntime],
  );

  const refreshThreadFromServer = useCallback(async (): Promise<any | null> => {
    if (!threadId) return null;
    try {
      const refreshRes = await fetch(
        `${apiUrl}/threads/${encodeURIComponent(threadId)}`,
      );
      if (!refreshRes.ok) return null;
      const refreshData = await refreshRes.json();
      if (!refreshData.threadData) return null;
      return importThreadData(refreshData.threadData);
    } catch {
      return null;
    }
  }, [apiUrl, importThreadData, threadId]);

  const wasRecentlyStoppedRun = useCallback((runId?: string): boolean => {
    const stopped = userStoppedRunRef.current;
    return Boolean(
      stopped &&
      Date.now() - stopped.at < 10_000 &&
      (!stopped.runId || !runId || stopped.runId === runId),
    );
  }, []);

  const startReconnectToRun = useCallback(
    (runInfo: ActiveRunLookup): boolean => {
      if (!threadId || !runInfo.runId || runInfo.status !== "running") {
        return false;
      }
      const runId = String(runInfo.runId);
      if (wasRecentlyStoppedRun(runId)) return false;
      if (reconnectRunIdRef.current === runId) return true;

      reconnectRunIdRef.current = runId;
      setIsReconnecting(true);
      setReconnectFrozen(false);
      setReconnectContent([]);
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: tabId || threadId },
        }),
      );

      const abortCtrl = new AbortController();
      reconnectAbortRef.current = abortCtrl;

      const watchdog = setInterval(async () => {
        try {
          const res = await fetch(
            `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
          );
          if (!res.ok) {
            abortCtrl.abort();
            clearInterval(watchdog);
            return;
          }
          const info = (await res.json()) as ActiveRunLookup;
          if (info.status !== "running" || activeRunLooksStale(info)) {
            abortCtrl.abort();
            clearInterval(watchdog);
          }
        } catch {
          // Network blip — keep polling.
        }
      }, 1000);

      let reconnectTimedOut = false;
      const maxReconnectTimer = setTimeout(() => {
        reconnectTimedOut = true;
        abortCtrl.abort();
        clearInterval(watchdog);
      }, 20_000);

      const streamReconnect = async () => {
        let noProgressDuringReconnect = false;
        let latestContent: ContentPart[] = [];
        try {
          const sseRes = await fetch(
            `${apiUrl}/runs/${encodeURIComponent(runId)}/events?after=0`,
            { signal: abortCtrl.signal },
          );
          if (sseRes.ok && sseRes.body) {
            const content: ContentPart[] = [];
            latestContent = content;
            const toolCallCounter = { value: 0 };

            let rafPending = false;
            let latestSnapshot: ContentPart[] = [];
            const scheduleUpdate = (snapshot: ContentPart[]) => {
              latestSnapshot = snapshot;
              if (rafPending) return;
              rafPending = true;
              requestAnimationFrame(() => {
                rafPending = false;
                setReconnectContent(latestSnapshot);
              });
            };

            await readSSEStreamRaw(
              sseRes.body,
              content,
              toolCallCounter,
              tabId,
              scheduleUpdate,
            );
            setReconnectContent([...content]);
          }
        } catch (err) {
          if (
            err instanceof AgentAutoContinueSignal &&
            err.reason === "no_progress"
          ) {
            noProgressDuringReconnect = true;
          } else if (
            reconnectTimedOut &&
            err instanceof Error &&
            err.name === "AbortError"
          ) {
            noProgressDuringReconnect = true;
          }
        } finally {
          clearInterval(watchdog);
          clearTimeout(maxReconnectTimer);
        }

        if (noProgressDuringReconnect && reconnectRunIdRef.current === runId) {
          captureError(new Error("agent-chat:reconnect_no_progress"), {
            tags: {
              context: "agent-native-chat",
              errorCode: "reconnect_no_progress",
              reconnectTimedOut: String(reconnectTimedOut),
            },
            extra: {
              runId,
              threadId: threadId ?? null,
              tabId: tabId ?? null,
              contentLength: latestContent.length,
            },
          });
          try {
            await fetch(`${apiUrl}/runs/${encodeURIComponent(runId)}/abort`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reason: "no_progress" }),
            });
          } catch {
            // Best effort — the important part is unwinding the UI.
          }
          setReconnectContent([...latestContent]);
          setReconnectFrozen(latestContent.length > 0);
          setRunErrorInfo({
            message:
              "The previous agent run stopped producing visible progress while reconnecting, so it was stopped before it could keep looping.",
            errorCode: "reconnect_no_progress",
            recoverable: true,
            runId,
          });
          setDismissedRunErrorKey(null);
          reconnectAbortRef.current = null;
          setIsReconnecting(false);
          reconnectRunIdRef.current = null;
          window.dispatchEvent(
            new CustomEvent("agentNative.chatRunning", {
              detail: { isRunning: false, tabId: tabId || threadId },
            }),
          );
          return;
        }

        setReconnectFrozen(true);
        let loaded = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          await new Promise((r) => setTimeout(r, 500));
          if (reconnectRunIdRef.current !== runId) break;
          const repo = await refreshThreadFromServer();
          if (repoHasAssistantMessage(repo)) {
            setReconnectContent([]);
            setReconnectFrozen(false);
            loaded = true;
            break;
          }
        }

        if (reconnectRunIdRef.current === runId) {
          reconnectAbortRef.current = null;
          setIsReconnecting(false);
          reconnectRunIdRef.current = null;
          window.dispatchEvent(
            new CustomEvent("agentNative.chatRunning", {
              detail: { isRunning: false, tabId: tabId || threadId },
            }),
          );
        }
        if (!loaded) {
          await refreshThreadFromServer();
        }
      };

      void streamReconnect();
      return true;
    },
    [apiUrl, refreshThreadFromServer, tabId, threadId, wasRecentlyStoppedRun],
  );

  const reconnectActiveRunForThread =
    useCallback(async (): Promise<boolean> => {
      if (!threadId) return false;
      try {
        const runRes = await fetch(
          `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
        );
        if (!runRes.ok) return false;
        const runInfo = (await runRes.json()) as ActiveRunLookup;
        if (
          !runInfo.active ||
          runInfo.status !== "running" ||
          activeRunLooksStale(runInfo)
        ) {
          await refreshThreadFromServer();
          return false;
        }
        return startReconnectToRun(runInfo);
      } catch {
        return false;
      }
    }, [apiUrl, refreshThreadFromServer, startReconnectToRun, threadId]);

  // Restore messages from server on mount (when threadId is set). The
  // server is the single source of truth — we don't hydrate from localStorage
  // first, so what the user sees in the chat panel always matches what the
  // history list (and the agent) sees on disk.
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    if (threadId) {
      (async () => {
        try {
          const res = await fetch(
            `${apiUrl}/threads/${encodeURIComponent(threadId)}`,
          );
          if (!res.ok) return;
          const data = await res.json();
          if (data.threadData) {
            importThreadData(data.threadData, { markTitleGenerated: true });
          }
          // Also skip title generation if thread already has a title
          if (data.title) {
            titleGeneratedRef.current = true;
          }

          // Check if there's an active run for this thread (e.g. after hot
          // reload), and reconnect to it if it is still running.
          await reconnectActiveRunForThread();
        } catch {
          // Start fresh
        } finally {
          setIsRestoring(false);
        }
      })();
    } else {
      // Legacy: restore from sessionStorage
      const storageKey = `${CHAT_STORAGE_PREFIX}${tabId || "default"}`;
      try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved) {
          const repo = JSON.parse(saved);
          if (repo?.messages?.length > 0) {
            threadRuntime.import(ensureMessageMetadata(repo));
          }
        }
      } catch {}
      setIsRestoring(false);
    }
  }, [
    threadId,
    tabId,
    apiUrl,
    threadRuntime,
    importThreadData,
    reconnectActiveRunForThread,
  ]);

  // If assistant-ui stops the local runtime while the background server run is
  // still alive, immediately switch into the same reconnect path used after a
  // reload. Otherwise the composer unlocks, the next send hits a 409, and the
  // user sees "still working" even though the UI stopped updating.
  const prevRuntimeRunningForReconnectRef = useRef(isRuntimeRunning);
  useEffect(() => {
    const wasRuntimeRunning = prevRuntimeRunningForReconnectRef.current;
    prevRuntimeRunningForReconnectRef.current = isRuntimeRunning;
    if (
      !wasRuntimeRunning ||
      isRuntimeRunning ||
      !threadId ||
      forceStopped ||
      isReconnecting ||
      wasRecentlyStoppedRun()
    ) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        void reconnectActiveRunForThread();
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    forceStopped,
    isReconnecting,
    isRuntimeRunning,
    reconnectActiveRunForThread,
    threadId,
    wasRecentlyStoppedRun,
  ]);

  // Generate a title when the first user message is sent
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    if (titleGeneratedRef.current) return;
    if (messages.length === 0) return;

    const firstUserMsg = messages.find((m) => m.role === "user");
    if (!firstUserMsg) return;

    // Extract text from the first user message
    const text =
      "content" in firstUserMsg
        ? Array.isArray(firstUserMsg.content)
          ? firstUserMsg.content
              .filter((p: any) => p.type === "text")
              .map((p: any) => p.text)
              .join(" ")
          : typeof firstUserMsg.content === "string"
            ? firstUserMsg.content
            : ""
        : "";

    if (!text.trim()) return;
    titleGeneratedRef.current = true;
    if (threadId) {
      onGenerateTitleRef.current?.(threadId, text.trim());
    }
  }, [messages, threadId]);

  // Periodically save thread data while the agent is running so refreshes
  // don't lose messages. Saves every 5 seconds while running.
  const savedTitleRef = useRef("");
  const lastSaveTimeRef = useRef(0);
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    if (!isRunning) return;
    if (messages.length === 0) return;
    if (!threadId || !onSaveThreadRef.current) return;

    const now = Date.now();
    const timeSinceLastSave = now - lastSaveTimeRef.current;
    if (timeSinceLastSave < 5000) return;

    const repo = threadRuntime.export();
    const { title, preview } = extractThreadMeta(repo);

    lastSaveTimeRef.current = now;
    savedTitleRef.current = title;
    onSaveThreadRef.current(threadId, {
      threadData: JSON.stringify(repo),
      title,
      preview,
      messageCount: messages.length,
    });
  }, [messages, isRunning, threadId, threadRuntime]);

  // Persist full thread data after each completed response
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    if (isRunning) return;
    if (messages.length === 0) return;

    const repo = threadRuntime.export();

    if (threadId && onSaveThreadRef.current) {
      // Save to server via the hook callback
      const { title, preview } = extractThreadMeta(repo);
      savedTitleRef.current = title;
      onSaveThreadRef.current(threadId, {
        threadData: JSON.stringify(repo),
        title,
        preview,
        messageCount: messages.length,
      });
    } else {
      // Legacy: save to sessionStorage
      const storageKey = `${CHAT_STORAGE_PREFIX}${tabId || "default"}`;
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(repo));
      } catch {}
    }
  }, [messages, isRunning, threadId, tabId, threadRuntime]);

  useEffect(() => {
    onMessageCountChange?.(messages.length);
  }, [messages.length, onMessageCountChange]);

  // Persist queued messages to the server so they survive reloads. Debounced
  // to 300ms so typing-and-queuing-rapidly doesn't hammer the endpoint.
  // Stores them in thread_data.queuedMessages via POST /threads/:id/queued.
  useEffect(() => {
    if (!threadId) return;
    if (!hasRestoredRef.current) return;
    const serialized = JSON.stringify(queuedMessages);
    if (serialized === lastPersistedQueueRef.current) return;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const res = await fetch(
            `${apiUrl}/threads/${encodeURIComponent(threadId)}/queued`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ queuedMessages }),
            },
          );
          if (res.ok) {
            lastPersistedQueueRef.current = serialized;
          }
        } catch {
          // Best-effort — next queue change will retry.
        }
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [queuedMessages, threadId, apiUrl]);

  // Listen for missing API key events from the adapter
  useEffect(() => {
    const handler = () => setMissingApiKey(true);
    window.addEventListener("agent-chat:missing-api-key", handler);
    return () =>
      window.removeEventListener("agent-chat:missing-api-key", handler);
  }, []);

  const handleBuilderConnected = useCallback(() => {
    setMissingApiKey(false);
  }, []);

  // Check on mount and whenever SettingsPanel dispatches
  // `agent-engine:configured-changed` so the gate flips live without reload.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const [envKeys, builderStatus, engineStatus] = await Promise.all([
        fetch(agentNativePath("/_agent-native/env-status"))
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(agentNativePath("/_agent-native/builder/status"))
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(agentNativePath("/_agent-native/agent-engine/status"))
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      if (cancelled) return;
      // All three status endpoints failed — avoid flashing the gate on a
      // transient network error.
      if (envKeys == null && builderStatus == null && engineStatus == null) {
        return;
      }
      const keys = (envKeys ?? []) as Array<{
        key: string;
        configured: boolean;
      }>;
      const llmKeys = keys.filter((k) => PROVIDER_ENV_VAR_SET.has(k.key));
      const anyConfigured =
        llmKeys.some((k) => k.configured) ||
        builderStatus?.configured === true ||
        engineStatus?.configured === true;
      setMissingApiKey(!anyConfigured);
    };
    check();
    window.addEventListener("agent-engine:configured-changed", check);
    return () => {
      cancelled = true;
      window.removeEventListener("agent-engine:configured-changed", check);
    };
  }, []);

  // Listen for auth error events from the adapter
  const checkAuthSession = useCallback(async () => {
    try {
      const res = await fetch(agentNativePath("/_agent-native/auth/session"), {
        cache: "no-store",
      });
      if (!res.ok) return false;
      const data = await res.json().catch(() => null);
      const hasSession = !!data && !data.error;
      setAuthSessionAvailable(hasSession);
      if (hasSession) {
        setAuthError(null);
      }
      return hasSession;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | {
            reason?: string;
            tabId?: string;
            threadId?: string;
          }
        | undefined;
      const eventTabId =
        typeof detail?.tabId === "string" ? detail.tabId : null;
      const eventThreadId =
        typeof detail?.threadId === "string" ? detail.threadId : null;
      if (
        (eventTabId || eventThreadId) &&
        eventTabId !== tabId &&
        eventThreadId !== threadId
      ) {
        return;
      }
      setAuthSessionAvailable(false);
      setAuthError({ sessionExpired: detail?.reason === "session-expired" });
      void checkAuthSession();
    };
    window.addEventListener("agent-chat:auth-error", handler);
    return () => window.removeEventListener("agent-chat:auth-error", handler);
  }, [checkAuthSession, tabId, threadId]);

  useEffect(() => {
    if (!authError) return;
    // Auto-recovery (`checkAuthSession`) runs immediately + at 250ms. If the
    // card is still showing 3 seconds later, recovery failed and the user
    // is about to hit "Refresh chat" — that's the "Reload UI required"
    // symptom we want signal on.
    const stuckCapture = window.setTimeout(() => {
      captureError(new Error("agent-chat:auth_error_card_stuck"), {
        tags: {
          context: "agent-native-chat",
          errorCode: "auth_error_card",
          sessionAvailable: String(authSessionAvailable),
          sessionExpired: String(!!authError.sessionExpired),
        },
        extra: {
          threadId: threadId ?? null,
          tabId: tabId ?? null,
        },
      });
    }, 3000);
    const handler = () => void checkAuthSession();
    const timer = window.setTimeout(handler, 250);
    window.addEventListener("focus", handler);
    window.addEventListener("agent-engine:configured-changed", handler);
    return () => {
      window.clearTimeout(stuckCapture);
      window.clearTimeout(timer);
      window.removeEventListener("focus", handler);
      window.removeEventListener("agent-engine:configured-changed", handler);
    };
  }, [authError, authSessionAvailable, checkAuthSession, tabId, threadId]);

  // Listen for loop-limit events from the adapter
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!tabId || detail?.tabId === tabId) {
        setLoopLimitInfo({
          ...(typeof detail?.maxIterations === "number"
            ? { maxIterations: detail.maxIterations }
            : {}),
        });
        setShowContinue(true);
      }
    };
    window.addEventListener("agent-chat:loop-limit", handler);
    return () => window.removeEventListener("agent-chat:loop-limit", handler);
  }, [tabId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as RunErrorInfo & {
        tabId?: string;
      };
      if (tabId && detail?.tabId && detail.tabId !== tabId) return;
      if (!detail?.message) return;
      const stopped = userStoppedRunRef.current;
      if (
        stopped &&
        Date.now() - stopped.at < 10_000 &&
        (!stopped.runId || !detail.runId || stopped.runId === detail.runId)
      ) {
        return;
      }
      setRunErrorInfo({
        message: detail.message,
        ...(detail.details ? { details: detail.details } : {}),
        ...(detail.errorCode ? { errorCode: detail.errorCode } : {}),
        ...(detail.runId ? { runId: detail.runId } : {}),
        ...(detail.recoverable ? { recoverable: detail.recoverable } : {}),
      });
      setDismissedRunErrorKey(null);
    };
    window.addEventListener("agent-chat:run-error", handler);
    return () => window.removeEventListener("agent-chat:run-error", handler);
  }, [tabId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        label?: string;
        tool?: string;
        tabId?: string;
      };
      if (tabId && detail?.tabId && detail.tabId !== tabId) return;
      if (typeof detail?.label === "string" && detail.label.trim()) {
        const label = detail.label.trim();
        const tool = detail.tool?.trim() || undefined;
        setActivityLabel(label);
        setActivitySteps((prev) => {
          const last = prev[prev.length - 1];
          if (last?.label === label && last.tool === tool) return prev;
          return [
            ...prev,
            {
              id: `${Date.now()}-${++activityStepIdCounter.current}`,
              label,
              ...(tool ? { tool } : {}),
            },
          ].slice(-6);
        });
      }
    };
    window.addEventListener("agent-chat:activity", handler);
    return () => window.removeEventListener("agent-chat:activity", handler);
  }, [tabId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tabId?: string };
      if (tabId && detail?.tabId && detail.tabId !== tabId) return;
      setActivityLabel(null);
      setActivitySteps([]);
    };
    window.addEventListener("agent-chat:activity-clear", handler);
    return () =>
      window.removeEventListener("agent-chat:activity-clear", handler);
  }, [tabId]);

  useEffect(() => {
    if (!showRunningInUI) {
      setActivityLabel(null);
      setActivitySteps([]);
    }
  }, [showRunningInUI]);

  // Auto-dequeue: when agent finishes running, send the next queued message
  useEffect(() => {
    if (wasRunningRef.current && !isRunning && queuedMessages.length > 0) {
      const [next, ...rest] = queuedMessages;
      setQueuedMessages(rest);
      // Small delay to let the runtime settle after completion
      setTimeout(() => {
        void (async () => {
          // In serverless/cross-isolate deployments the client can receive the
          // terminal SSE event a beat before SQL has marked the previous run
          // complete. Starting the queued turn during that window can reconnect
          // to the old run and replay the old answer under the new prompt.
          await waitForThreadRunToClear(apiUrl, threadId);
          const content: Array<
            { type: "text"; text: string } | { type: "image"; image: string }
          > = [{ type: "text", text: next.text }];
          if (next.images) {
            for (const img of next.images) {
              content.push({ type: "image", image: img });
            }
          }
          threadRuntime.append({
            role: "user",
            content,
            ...(next.attachments && next.attachments.length > 0
              ? { attachments: next.attachments }
              : {}),
            ...createUserMessageRunConfig(next.references, next.requestMode),
          } as Parameters<typeof threadRuntime.append>[0]);
        })();
      }, 100);
    }
    wasRunningRef.current = isRunning;
  }, [apiUrl, isRunning, queuedMessages, threadId, threadRuntime]);

  // Clear frozen reconnect content + forceStopped only on the false→true
  // transition of isRuntimeRunning (i.e. a NEW run is actually starting).
  // Reacting to "isRuntimeRunning is currently true" would clear the
  // nuclear-stop flag immediately after the user clicks stop, since
  // cancellation is async and isRuntimeRunning is still true at that moment.
  const prevIsRuntimeRunningRef = useRef(isRuntimeRunning);
  useEffect(() => {
    const wasRunning = prevIsRuntimeRunningRef.current;
    prevIsRuntimeRunningRef.current = isRuntimeRunning;
    if (isRuntimeRunning && !wasRunning) {
      if (reconnectFrozen) {
        setReconnectFrozen(false);
        setReconnectContent([]);
      }
      if (forceStopped) {
        setForceStopped(false);
      }
    }
  }, [isRuntimeRunning, reconnectFrozen, forceStopped]);

  // Same transition guard for isReconnecting: only clear forceStopped on
  // the false→true edge (a new reconnect starting on page load).
  const prevIsReconnectingRef = useRef(isReconnecting);
  useEffect(() => {
    const wasReconnecting = prevIsReconnectingRef.current;
    prevIsReconnectingRef.current = isReconnecting;
    if (isReconnecting && !wasReconnecting && forceStopped) {
      setForceStopped(false);
    }
  }, [isReconnecting, forceStopped]);

  const addToQueue = useCallback(
    async (
      text: string,
      images?: string[],
      references?: Reference[],
      attachments?: ReadonlyArray<unknown>,
      requestMode?: AgentRequestMode,
    ) => {
      setShowContinue(false);
      setLoopLimitInfo(null);
      setRunErrorInfo(null);
      setDismissedRunErrorKey(null);
      setActivityLabel(null);
      setActivitySteps([]);
      userStoppedRunRef.current = null;
      // Selection context attached via Cmd+I is one-shot — clear it as soon
      // as the user actually sends a message so it can't be re-used.
      clearPendingSelection();
      // Sending a message is an explicit user action — always anchor to the
      // bottom so the new message and any reply land in view, even if the
      // user had scrolled up to read history. The sticky-bottom override
      // exists to stop streaming from yanking the viewport, not to swallow
      // direct sends.
      isNearBottomRef.current = true;
      setShowScrollToBottom(false);
      const queuedAttachments = await serializeQueuedAttachments(attachments);
      // Snapshot the exec mode at enqueue time when the caller didn't
      // pass an explicit override. Without this, a plan-mode message that
      // sits in the queue runs as 'act' if the user flips the global toggle
      // before the queue flushes — turning a read-only message into a write.
      const effectiveRequestMode: AgentRequestMode | undefined =
        requestMode ??
        (execMode === "plan"
          ? "plan"
          : execMode === "build"
            ? "act"
            : undefined);
      if (isRunning) {
        setQueuedMessages((prev) => [
          ...prev,
          {
            id:
              typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID()
                : `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            text,
            images,
            attachments: queuedAttachments,
            references,
            requestMode: effectiveRequestMode,
          },
        ]);
      } else {
        const content: Array<
          { type: "text"; text: string } | { type: "image"; image: string }
        > = [{ type: "text", text }];
        if (images) {
          for (const img of images) {
            content.push({ type: "image", image: img });
          }
        }
        threadRuntime.append({
          role: "user",
          content,
          ...(queuedAttachments && queuedAttachments.length > 0
            ? { attachments: queuedAttachments }
            : {}),
          ...createUserMessageRunConfig(references, effectiveRequestMode),
        } as Parameters<typeof threadRuntime.append>[0]);
      }
    },
    [execMode, isRunning, threadRuntime],
  );

  // Expose imperative handle
  useImperativeHandle(
    ref,
    () => ({
      sendMessage(text: string) {
        addToQueue(text);
      },
      queueMessage(text: string) {
        addToQueue(text);
      },
      isRunning() {
        return thread.isRunning;
      },
      focusComposer() {
        tiptapRef.current?.focus();
      },
      exportThreadSnapshot() {
        if (messages.length === 0) return null;
        const repo = threadRuntime.export();
        const { title, preview } = extractThreadMeta(repo);
        return {
          threadData: JSON.stringify(repo),
          title,
          preview,
          messageCount: messages.length,
        };
      },
    }),
    [addToQueue, messages.length, thread.isRunning, threadRuntime],
  );

  // Track whether user has scrolled away from bottom
  const isNearBottomRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const threshold = 40;
      const nearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      isNearBottomRef.current = nearBottom;
      setShowScrollToBottom(!nearBottom && messages.length > 0);
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [messages.length]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      isNearBottomRef.current = true;
      setShowScrollToBottom(false);
    }
  }, []);

  const scrollToBottomAfterPaint = useCallback(() => {
    scrollToBottom();
    requestAnimationFrame(() => {
      scrollToBottom();
      requestAnimationFrame(scrollToBottom);
    });
    setTimeout(scrollToBottom, 80);
  }, [scrollToBottom]);

  const scrollToBottomWhileLayoutSettles = useCallback(() => {
    scrollToBottomAfterPaint();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;

    let stopped = false;
    const observer = new ResizeObserver(() => {
      if (!stopped) scrollToBottom();
    });
    observer.observe(el);
    const timeout = window.setTimeout(() => {
      stopped = true;
      observer.disconnect();
      scrollToBottom();
    }, 1600);

    return () => {
      stopped = true;
      window.clearTimeout(timeout);
      observer.disconnect();
    };
  }, [scrollToBottom, scrollToBottomAfterPaint]);

  // Scroll to bottom when a restored thread finishes loading
  const wasRestoringRef = useRef(isRestoring);
  useEffect(() => {
    const wasRestoring = wasRestoringRef.current;
    wasRestoringRef.current = isRestoring;
    if (wasRestoring && !isRestoring) {
      return scrollToBottomWhileLayoutSettles();
    }
  }, [isRestoring, scrollToBottomWhileLayoutSettles]);

  // Auto-scroll on new messages or queued messages (only if near bottom)
  useEffect(() => {
    const el = scrollRef.current;
    if (el && isNearBottomRef.current) {
      scrollToBottomAfterPaint();
    }
  }, [messages, queuedMessages, scrollToBottomAfterPaint]);

  useEffect(() => {
    if (!isRunning && isNearBottomRef.current) {
      scrollToBottomAfterPaint();
    }
  }, [isRunning, scrollToBottomAfterPaint]);

  // Continuous auto-scroll while streaming (only if near bottom)
  useEffect(() => {
    if (!isRunning) return;
    const el = scrollRef.current;
    if (!el) return;
    const interval = setInterval(() => {
      if (isNearBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    }, 100);
    return () => clearInterval(interval);
  }, [isRunning]);

  const { isDevMode: cpDevMode } = useDevMode(apiUrl);
  const checkpointCtx = useMemo(
    () => ({ apiUrl, devMode: cpDevMode, threadId }),
    [apiUrl, cpDevMode, threadId],
  );
  const messageActionsCtx = useMemo(() => ({ onForkChat }), [onForkChat]);
  const lastMessageLoopLimit = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return null;
    return getLoopLimitMetadata(last);
  }, [messages]);
  const lastMessageRunError = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return null;
    return getRunErrorMetadata(last);
  }, [messages]);
  const lastUserText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") return getMessageText(messages[i]);
    }
    return "";
  }, [messages]);
  const latestMessage = messages[messages.length - 1];
  const latestMessageRole = latestMessage?.role;
  const latestAssistantWasPlan =
    latestMessageRole === "assistant" &&
    getRequestModeMetadata(latestMessage) === "plan";
  const showPlanModeCallout =
    execMode === "plan" &&
    !planModeDisabled &&
    !isComposerDisabled &&
    !showRunningInUI;
  const canImplementPlan = showPlanModeCallout && latestAssistantWasPlan;
  const handleImplementPlan = useCallback(() => {
    onExecModeChange?.("build");
    void addToQueue(
      "Implement the plan.",
      undefined,
      undefined,
      undefined,
      "act",
    );
  }, [addToQueue, onExecModeChange]);
  const handleSwitchToAct = useCallback(() => {
    onExecModeChange?.("build");
  }, [onExecModeChange]);
  const visibleLoopLimit = showContinue
    ? (loopLimitInfo ?? lastMessageLoopLimit ?? {})
    : lastMessageLoopLimit;
  const visibleRunError = runErrorInfo ?? lastMessageRunError;
  const visibleRunErrorKey = visibleRunError
    ? `${visibleRunError.runId ?? ""}:${visibleRunError.errorCode ?? ""}:${visibleRunError.message}`
    : null;
  const shouldShowRunError =
    !!visibleRunError &&
    !showRunningInUI &&
    visibleRunErrorKey !== dismissedRunErrorKey &&
    !(
      userStoppedRunRef.current &&
      Date.now() - userStoppedRunRef.current.at < 10_000 &&
      (!userStoppedRunRef.current.runId ||
        !visibleRunError.runId ||
        userStoppedRunRef.current.runId === visibleRunError.runId)
    );

  return (
    <CheckpointContext.Provider value={checkpointCtx}>
      <MessageActionsContext.Provider value={messageActionsCtx}>
        <ChatRunningContext.Provider value={isRunning}>
          <div
            className={cn(
              "relative flex flex-1 flex-col h-full min-h-0 text-foreground",
              className,
            )}
            onDragEnter={handleChatDragEnter}
            onDragOver={handleChatDragOver}
            onDragLeave={handleChatDragLeave}
            onDrop={handleChatDrop}
          >
            {dropActive && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-md border-2 border-dashed border-primary/70 bg-primary/5 backdrop-blur-[1px]"
              >
                <span className="rounded-md bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm">
                  Drop to attach
                </span>
              </div>
            )}
            {showHeader && (
              <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
                <span className="text-[13px] font-medium text-muted-foreground">
                  Agent
                </span>
                <div className="flex items-center gap-1">
                  {onSwitchToCli && (
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={onSwitchToCli}
                            aria-label="Switch to CLI"
                            className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent"
                          >
                            <IconTerminal className="h-3.5 w-3.5" />
                            CLI
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Switch to CLI</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </div>
            )}

            {/* Messages area */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto overflow-x-hidden min-h-0"
            >
              {authError ? (
                <div className="flex flex-col items-center justify-center h-full px-4 gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
                    <IconLock className="h-5 w-5 text-destructive" />
                  </div>
                  <div className="text-center max-w-[280px]">
                    <p className="text-sm font-medium text-foreground mb-1">
                      {authSessionAvailable
                        ? "Chat session needs refresh"
                        : authError.sessionExpired
                          ? "Session expired"
                          : "Authentication required"}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {authSessionAvailable
                        ? "You're signed in, but this chat connection needs to reconnect."
                        : authError.sessionExpired
                          ? "Your session may have expired. Log out and log back in to reconnect."
                          : "You need to log in to use the agent."}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {!authError.sessionExpired && !authSessionAvailable && (
                      <button
                        onClick={() => {
                          const ret =
                            window.location.pathname + window.location.search;
                          window.location.href =
                            agentNativePath("/_agent-native/sign-in") +
                            `?return=${encodeURIComponent(ret)}`;
                        }}
                        className="text-xs text-background bg-foreground hover:opacity-90 px-3 py-1.5 rounded-md"
                      >
                        Log in
                      </button>
                    )}
                    {authError.sessionExpired && !authSessionAvailable && (
                      <button
                        onClick={async () => {
                          try {
                            await fetch(
                              agentNativePath("/_agent-native/auth/logout"),
                              {
                                method: "POST",
                              },
                            );
                          } catch {}
                          window.location.reload();
                        }}
                        className="text-xs text-destructive hover:text-destructive/80 px-3 py-1.5 rounded-md border border-destructive/30 hover:bg-destructive/10"
                      >
                        Log out
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setAuthError(null);
                        window.location.reload();
                      }}
                      className={
                        authSessionAvailable
                          ? "text-xs text-background bg-foreground hover:opacity-90 px-3 py-1.5 rounded-md"
                          : "text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md border border-border hover:bg-accent"
                      }
                    >
                      Refresh chat
                    </button>
                  </div>
                </div>
              ) : missingApiKey && messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full px-2">
                  <BuilderSetupCard
                    onConnected={handleBuilderConnected}
                    bouncePulse={missingKeyBouncePulse}
                  />
                </div>
              ) : isRestoring ? (
                <div className="flex flex-col gap-3 p-4">
                  <div className="flex justify-end">
                    <div className="h-8 w-32 rounded-lg bg-muted animate-pulse" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="h-4 w-48 rounded bg-muted animate-pulse" />
                    <div className="h-4 w-64 rounded bg-muted animate-pulse" />
                    <div className="h-4 w-40 rounded bg-muted animate-pulse" />
                  </div>
                </div>
              ) : messages.length === 0 && !isReconnecting ? (
                <div className="flex flex-col items-center justify-center gap-4 py-16 px-4 h-full">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                    <IconMessage className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground text-center max-w-[240px]">
                    {emptyStateText ?? "How can I help you?"}
                  </p>
                  {emptyStateAddon}
                  {suggestions && suggestions.length > 0 && (
                    <div className="flex flex-col gap-1.5 w-full max-w-[280px]">
                      {suggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          onClick={() => {
                            threadRuntime.append({
                              role: "user",
                              content: [{ type: "text", text: suggestion }],
                            });
                          }}
                          className="w-full rounded-lg border border-border px-3 py-2 text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="agent-thread-content flex flex-col gap-4 px-4 py-4">
                  <AssistantMessageListErrorBoundary
                    resetKey={messageListResetKey}
                  >
                    <ThreadPrimitive.Messages
                      components={{
                        UserMessage,
                        AssistantMessage,
                      }}
                    />
                  </AssistantMessageListErrorBoundary>
                  {missingApiKey && (
                    <BuilderSetupCard
                      onConnected={handleBuilderConnected}
                      bouncePulse={missingKeyBouncePulse}
                    />
                  )}
                  {visibleLoopLimit && !showRunningInUI && (
                    <LoopLimitContinueCard
                      info={visibleLoopLimit}
                      onContinue={() => {
                        setShowContinue(false);
                        setLoopLimitInfo(null);
                        addToQueue("Continue from where you left off.");
                      }}
                    />
                  )}
                  {shouldShowRunError && visibleRunError && (
                    <RunErrorRecoveryCard
                      info={visibleRunError}
                      onContinue={() => {
                        setRunErrorInfo(null);
                        addToQueue(
                          "Continue from where you stopped. Use the partial work above, verify what succeeded, and finish the original request. Do not rerun the exact same failed tool input unless the failure was transient or the user explicitly asked for an exact rerun. Prefer dedicated app actions over raw database edits when they exist.",
                        );
                      }}
                      onRetry={() => {
                        setRunErrorInfo(null);
                        addToQueue(
                          lastUserText
                            ? `Retry the previous request from a clean approach. Do not rerun the exact same failed tool input unless the failure was transient or the user explicitly asked for an exact rerun. If a provider query failed because of schema, syntax, or type mismatch, diagnose the error and adjust the query first.\n\nOriginal request:\n\n${lastUserText}`
                            : "Retry the previous request from a clean approach. Do not rerun the exact same failed tool input unless the failure was transient or the user explicitly asked for an exact rerun. If a provider query failed because of schema, syntax, or type mismatch, diagnose the error and adjust the query first.",
                        );
                      }}
                      onFork={onForkChat}
                      onDismiss={() => {
                        if (visibleRunErrorKey) {
                          setDismissedRunErrorKey(visibleRunErrorKey);
                        }
                        setRunErrorInfo(null);
                      }}
                    />
                  )}
                  {(isReconnecting || reconnectFrozen) &&
                    reconnectContent.length > 0 && (
                      <ReconnectStreamMessage content={reconnectContent} />
                    )}
                  {/* Always show the thinking indicator while the agent is working,
                including during reconnect. The indicator sits BELOW any
                already-streamed reconnect content so the user sees both
                "what it did so far" and "it's still working". Swap the label
                to "Reconnecting" during reconnect so the user knows the
                system is actively recovering, not just stuck. */}
                  {showRunningInUI && (
                    <>
                      <ActivitySteps steps={activitySteps} />
                      <ThinkingIndicator
                        label={
                          isReconnecting
                            ? "Reconnecting"
                            : (activityLabel ?? "Thinking")
                        }
                      />
                    </>
                  )}
                  {queuedMessages.map((msg) => {
                    const displayText = msg.text
                      .replace(/<context>[\s\S]*?<\/context>\n?/g, "")
                      .trim();
                    return (
                      <div key={msg.id} className="flex justify-end group">
                        <div className="relative max-w-[85%] rounded-lg bg-accent/50 text-foreground/60 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words">
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">
                            <IconClock className="h-3 w-3" />
                            Queued
                          </div>
                          {displayText}
                          {msg.images && msg.images.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              {msg.images.map((img, j) => (
                                <img
                                  key={j}
                                  src={img}
                                  alt=""
                                  className="h-12 w-12 rounded object-cover border border-border/50"
                                />
                              ))}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setQueuedMessages((prev) =>
                                prev.filter((m) => m.id !== msg.id),
                              )
                            }
                            aria-label="Remove from queue"
                            className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground hover:bg-accent shadow-sm"
                          >
                            <IconX className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Scroll to bottom button */}
            {showScrollToBottom && (
              <div className="shrink-0 flex justify-center -mb-1">
                <button
                  type="button"
                  onClick={scrollToBottom}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background shadow-sm hover:bg-accent"
                  aria-label="Scroll to bottom"
                >
                  <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            )}

            {composerSlot}
            {showPlanModeCallout && (
              <PlanModeCallout
                canImplementPlan={canImplementPlan}
                onImplementPlan={handleImplementPlan}
                onSwitchToAct={handleSwitchToAct}
              />
            )}
            <SelectionAttachedPill />
            {/* Input area */}
            <div
              className={cn(
                "agent-composer-area shrink-0 px-3 py-2",
                missingApiKey && "cursor-pointer",
                isComposerDisabled && "opacity-70",
              )}
              onClick={
                missingApiKey
                  ? () => setMissingKeyBouncePulse((p) => p + 1)
                  : undefined
              }
            >
              <ComposerPrimitive.Root className="flex flex-col rounded-lg border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
                <ComposerAttachmentPreviewStrip />
                <TiptapComposer
                  focusRef={tiptapRef}
                  disabled={isComposerDisabled}
                  placeholder={
                    missingApiKey
                      ? "Connect an AI engine above to start chatting…"
                      : composerDisabled
                        ? (composerDisabledPlaceholder ??
                          "Open Desktop to use this chat.")
                        : isRunning
                          ? queuedMessages.length > 0
                            ? `${queuedMessages.length} queued — type another...`
                            : "Queue a message..."
                          : undefined
                  }
                  onSubmit={
                    isRunning
                      ? (text, references, attachments) =>
                          void addToQueue(
                            text,
                            undefined,
                            references.length > 0 ? references : undefined,
                            attachments,
                          )
                      : undefined
                  }
                  onSlashCommand={onSlashCommand}
                  execMode={execMode}
                  onExecModeChange={onExecModeChange}
                  planModeDisabled={planModeDisabled}
                  planModeDisabledReason={planModeDisabledReason}
                  selectedModel={selectedModel ?? defaultModel}
                  selectedEffort={selectedEffort}
                  availableModels={availableModels}
                  onModelChange={onModelChange}
                  onEffortChange={onEffortChange}
                  draftScope={threadId || tabId}
                  interceptBuildRequestsForBuilder
                  extraActionButton={
                    showRunningInUI ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => {
                              // Nuclear stop: flip forceStopped so isRunning is false
                              // immediately. This unblocks submission even if the
                              // runtime or reconnect state is stuck.
                              setForceStopped(true);
                              const activeRun = getActiveRun();
                              const runIdToAbort =
                                reconnectRunIdRef.current ?? activeRun?.runId;
                              userStoppedRunRef.current = {
                                at: Date.now(),
                                ...(runIdToAbort
                                  ? { runId: runIdToAbort }
                                  : {}),
                              };
                              setRunErrorInfo(null);
                              setDismissedRunErrorKey(null);
                              if (runIdToAbort) {
                                fetch(
                                  `${apiUrl}/runs/${encodeURIComponent(runIdToAbort)}/abort`,
                                  { method: "POST" },
                                ).catch(() => {});
                              }

                              if (isReconnecting) {
                                reconnectAbortRef.current?.abort();
                                reconnectAbortRef.current = null;
                                reconnectRunIdRef.current = null;
                                setIsReconnecting(false);
                                setReconnectFrozen(reconnectContent.length > 0);
                              }

                              threadRuntime.cancelRun();

                              window.dispatchEvent(
                                new CustomEvent("agentNative.chatRunning", {
                                  detail: {
                                    isRunning: false,
                                    tabId: tabId || threadId,
                                  },
                                }),
                              );
                            }}
                            className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md bg-muted text-foreground hover:bg-muted/80"
                          >
                            <IconPlayerStop className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Stop generating</TooltipContent>
                      </Tooltip>
                    ) : undefined
                  }
                />
              </ComposerPrimitive.Root>
            </div>
          </div>
        </ChatRunningContext.Provider>
      </MessageActionsContext.Provider>
    </CheckpointContext.Provider>
  );
});

export const AssistantChat = forwardRef<
  AssistantChatHandle,
  AssistantChatProps
>(function AssistantChat(
  {
    apiUrl = agentNativePath("/_agent-native/agent-chat"),
    tabId,
    browserTabId,
    threadId,
    contextScope,
    ...props
  },
  ref,
) {
  const modelRef = useRef<string | undefined>(props.selectedModel);
  modelRef.current = props.selectedModel;
  const engineRef = useRef<string | undefined>(props.selectedEngine);
  engineRef.current = props.selectedEngine;
  const effortRef = useRef<ReasoningEffort | undefined>(props.selectedEffort);
  effortRef.current = props.selectedEffort;
  const execModeRef = useRef<"build" | "plan" | undefined>(props.execMode);
  execModeRef.current = props.execMode;
  const scopeRef = useRef<ChatThreadScope | null | undefined>(contextScope);
  scopeRef.current = contextScope;

  const adapter = useMemo(
    () =>
      createAgentChatAdapter({
        apiUrl,
        tabId,
        threadId,
        modelRef,
        engineRef,
        effortRef,
        execModeRef,
        browserTabId,
        scopeRef,
      }),
    [apiUrl, tabId, threadId, browserTabId],
  );
  const attachmentAdapter = useMemo(
    () =>
      new CompositeAttachmentAdapter([
        new DownscalingImageAttachmentAdapter(),
        new BinaryDocumentAttachmentAdapter(),
        new TextAttachmentAdapter(),
      ]),
    [],
  );
  const runtime = useLocalRuntime(adapter, {
    adapters: { attachments: attachmentAdapter },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex flex-1 flex-col h-full min-h-0 overflow-x-hidden">
        <AssistantUiStaleIndexErrorBoundary
          resetKey={`${tabId ?? ""}:${threadId ?? ""}`}
          componentName="AssistantChat"
        >
          <AssistantChatInner
            ref={ref}
            {...props}
            apiUrl={apiUrl}
            tabId={tabId}
            threadId={threadId}
          />
        </AssistantUiStaleIndexErrorBoundary>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
});
