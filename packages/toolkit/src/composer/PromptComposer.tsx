import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useAui,
  useComposer,
  useLocalRuntime,
} from "@assistant-ui/react";
import type {
  Attachment,
  AttachmentAdapter,
  ChatModelAdapter,
  CompleteAttachment,
  PendingAttachment,
} from "@assistant-ui/react";
import {
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
} from "@assistant-ui/react";
import { IconAlertTriangle, IconX } from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
  type ReactNode,
} from "react";

import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog.js";
import { TooltipProvider } from "../ui/tooltip.js";
import { cn } from "../utils.js";
import { AgentComposerFrame } from "./AgentComposerFrame.js";
import { IMAGE_ATTACHMENT_ACCEPT } from "./attachment-accept.js";
import {
  CHAT_DOCUMENT_ATTACHMENT_ACCEPT,
  PROMPT_DOCUMENT_ATTACHMENT_ACCEPT,
  TextAttachmentAdapter,
} from "./attachment-accept.js";
import { ComposerNotice } from "./composer-notice.js";
import type { ComposerContextMenuItem } from "./ComposerContextMenu.js";
import type { ComposerTerminalModeControl } from "./ComposerPlusMenu.js";
import type { ComposerContextSnapshot } from "./context-items.js";
import { isPastedTextAttachmentName } from "./pasted-text.js";
import { PastedTextChip } from "./PastedTextChip.js";
import {
  escapePromptAttachmentAttribute,
  getUnshrinkableImageError,
  probeAgentPromptAttachment,
  type AgentPromptAttachmentReadError,
} from "./prompt-attachments.js";
import {
  type ComposerTranslate,
  type EngineModelGroup,
  type ComposerAgentEngineState,
  type AgentChatContextItem,
  type ReasoningEffort,
  fallbackTranslate,
  useComposerRuntimeAdapters,
} from "./runtime-adapters.js";
import {
  DEFAULT_VOICE_DICTATION_ENABLED,
  isLocalRuntimeEngine,
  TiptapComposer,
  type ComposerAgentOption,
  type ComposerTextReference,
  type ComposerTextSelection,
  type ComposerImageModelMenu,
  type ComposerSubmitIntent,
  type ComposerDraftSnapshot,
  type TiptapComposerHandle,
  type TiptapComposerProps,
  type TiptapComposerSubmitOptions,
  sameComposerDraft,
} from "./TiptapComposer.js";
import type {
  AgentComposerLayoutVariant,
  MentionItem,
  Reference,
  SkillResult,
  SlashCommand,
} from "./types.js";

const MAX_INLINE_TEXT_FILE_CHARS = 60_000;

/**
 * Files the user attached via the "+" button in PromptComposer. The host owns
 * what to do with them — typically POST to a per-app upload endpoint and pass
 * the resulting URLs/paths into the prompt that gets sent to the agent.
 */
export type PromptComposerFile = File;

export interface PromptComposerSubmitOptions {
  intent?: ComposerSubmitIntent;
  steer?: boolean;
  /** Clear the submitted draft once the host owns the message and its failure recovery. */
  onLocalSubmit?: () => void;
  model?: string;
  engine?: string;
  effort?: ReasoningEffort;
  attachments?: ReadonlyArray<unknown>;
  contextItems?: ComposerContextSnapshot;
  /** Mode instructions; hosts append these after preparing provider-owned context. */
  composerModeContext?: string;
  /** Id `onSubmitStart` returned, so the sent message can be matched to its placeholder. */
  submissionId?: string;
  /** Set when `/plan` asked for this one message to be a read-only plan turn. */
  requestMode?: "plan";
}

export interface PromptComposerProps {
  contextItems?: readonly AgentChatContextItem[];
  onRemoveContextItem?: (key: string) => void;
  onInspectContextItem?: (key: string) => void;
  onRetryContextItem?: (key: string) => void;
  /** When provided, + opens this shared Add menu; a typed @ also suggests its context sources. */
  contextMenuItems?: readonly ComposerContextMenuItem[];
  /** Called when the user submits the composer. */
  onSubmit: (
    text: string,
    files: PromptComposerFile[],
    references: Reference[],
    options: PromptComposerSubmitOptions,
  ) => void | Promise<void>;
  /** Run the host's empty-composer action when Enter is pressed. */
  onEmptySubmit?: () => void | Promise<void>;
  /** Return false to stop a submit before it reaches the host runtime. */
  onBeforeSubmit?: (
    draft?: ComposerDraftSnapshot,
  ) => boolean | Promise<boolean>;
  onSubmissionPendingChange?: (pending: boolean) => void;
  /**
   * Called synchronously when a submit takes its draft, before any preflight
   * awaits. Return a handle to show an optimistic message until it settles.
   */
  onSubmitStart?: TiptapComposerProps["onSubmitStart"];
  /** Scope where a failed submission should be recovered after the host forks. */
  getSubmitFailureDraftScope?: () => string | null;
  /** Handle file paste/drop errors in the host chat surface. */
  onAttachmentError?: (message: string) => void;
  /** Delegate app-scaffolding prompts to the enclosing Builder chat. */
  interceptBuildRequestsForBuilder?: boolean;
  placeholder?: string;
  /** Placeholder once the thread has messages; see TiptapComposer. */
  replyPlaceholder?: string;
  /** The thread already has messages, so the composer reads as a reply. */
  conversationStarted?: boolean;
  /** Accessible name forwarded to the rich text editor. */
  ariaLabel?: string;
  disabled?: boolean;
  isReferenceTarget?: boolean;
  /** Block all submission paths while allowing draft, file, and context staging. */
  submissionDisabled?: boolean;
  /** Require the Agent-Native readiness check for this agent chat composer. */
  requireAgentEngine?: boolean;
  /** Hide the local setup card when the host shows the same card beside the composer. */
  showMissingApiKeySetup?: boolean;
  /**
   * The host shows a provider setup card beside this composer, so the model
   * control hides instead of repeating its connect choices. Defaults to
   * whether this composer shows its own setup card.
   */
  setupCardVisible?: boolean;
  /**
   * Reports whether the loaded model list offers only connect paths, so a
   * host that owns the setup card can show it before readiness answers.
   */
  onModelConnectionRequiredChange?: (required: boolean) => void;
  /** Disable only the send control while the submission is being accepted. */
  sendButtonDisabled?: boolean;
  /** Prevent submission while preserving editor focus and draft entry. */
  submitting?: boolean;
  /** Present the primary action as queueing instead of immediate send. */
  willQueue?: boolean;
  /** See `TiptapComposerProps.queuesBehindSubmission`. */
  queuesBehindSubmission?: boolean;
  /** Called when a host-gated composer is clicked while it is disabled. */
  onDisabledClick?: () => void;
  /** Override the generic document attachment cap for a multipart host. */
  maxDocumentAttachmentBytes?: number;
  /** Label used in the visible document attachment limit error. */
  documentAttachmentLimitLabel?: string;
  autoFocus?: boolean;
  className?: string;
  style?: CSSProperties;
  rootClassName?: string;
  rootStyle?: CSSProperties;
  /** Forwarded to TiptapComposer for draft persistence. */
  draftScope?: string;
  /** Keep the submitted prompt in the editor. Default: false. */
  preserveDraftOnSubmit?: boolean;
  /** Clear the submitted text before the host request finishes. */
  clearOnSubmitImmediately?: boolean;
  /** Show the model selector (default: true). */
  showModelSelector?: boolean;
  /** Controlled open state for hosts that resize around the model picker. */
  modelSelectorOpen?: boolean;
  /** Show the legacy provider-level Auto model option (default: true). */
  showAutoModelOption?: boolean;
  /** Show the voice dictation button. Defaults to DEFAULT_VOICE_DICTATION_ENABLED. */
  voiceEnabled?: boolean;
  /** Let an empty draft turn Send into the voice-chat button (default: true). Dictation is unaffected. */
  voiceChatEnabled?: boolean;
  /** Starts voice chat from the empty Send slot in place of the provider's default start. */
  onVoiceChatStart?: () => void;
  /** Show file upload controls and pass submitted files to onSubmit (default: true). */
  attachmentsEnabled?: boolean;
  /** Opens host-owned storage setup when the user chooses an upload action. */
  onAttachmentRequest?: () => void;
  /** Hide the Add context tooltip while the host storage popover is open. */
  contextButtonTooltipDisabled?: boolean;
  /** Host-owned file acceptance and staging; the shared composer still owns picker and chips. */
  attachmentAdapter?: AttachmentAdapter;
  /** Let hosts extract ordinary uploaded text without also inlining it. */
  inlineTextAttachments?: boolean;
  /**
   * Controls the shared "+" affordance. Defaults to upload-only for standalone
   * prompt forms; chat surfaces can opt into the full sidebar menu.
   */
  plusMenuMode?: "full" | "upload-only" | "terminal" | "hidden";
  /** Controls the terminal-specific plus menu when `plusMenuMode` is terminal. */
  terminalModeControl?: ComposerTerminalModeControl;
  /**
   * Include extension creation in the full "+" menu. Defaults to false.
   */
  extensionTools?: boolean;
  /** Programmatically seed the composer with plain text. */
  initialText?: string;
  /** Stable key used to re-apply `initialText` when the host picks a preset. */
  initialTextKey?: string | number;
  /** Chips placed into `initialText`, as the composer handle's `setText` takes them. */
  initialReferences?: readonly ComposerTextReference[];
  /** Optional host-owned control rendered directly after the "+" button. */
  modeControl?: ReactNode;
  /**
   * Offer `/plan`, which sends only the next message as a read-only plan turn
   * through `requestMode` in the submit options. Opt in only when `onSubmit`
   * honors `requestMode`.
   */
  planCommand?: boolean;
  /** Explicit host-owned toolbar slot rendered directly after the "+" button. */
  toolbarSlot?: ReactNode;
  /** Context usage control rendered just before the model chip. */
  contextUsageSlot?: ReactNode;
  /** Host-owned row rendered inside the frame, above the editor. */
  headerSlot?: ReactNode;
  /**
   * Show the surrounding ComposerNoticeScope's notices above this input. Only
   * the chat's main composer sets it.
   */
  noticeOutlet?: boolean;
  /** Custom attachment button to render instead of the default "+" affordance. */
  attachButton?: ReactNode;
  /** Custom action button to render instead of the default send button. */
  actionButton?: ReactNode;
  /** Extra button rendered alongside the default send button. */
  extraActionButton?: ReactNode;
  /** Optional stop control shown while the host runtime is active. */
  stopButton?: ReactNode;
  /** Shared sizing/layout variant for host surfaces. Default keeps sidebar behavior. */
  layoutVariant?: AgentComposerLayoutVariant;
  /** Additional slash commands surfaced in the shared / menu. */
  slashCommands?: SlashCommand[];
  /** Additional slash skills surfaced in the shared / menu. */
  slashSkills?: SkillResult[];
  /** Include built-in sidebar slash commands when onSlashCommand is provided. */
  includeDefaultSlashCommands?: boolean;
  /** Include app-discovered skills from the default agent endpoint. Default true. */
  includeDefaultSlashSkills?: boolean;
  /** Called when a slash command from the shared / menu is executed. */
  onSlashCommand?: (command: string) => void;
  /** External model list for hosts that already resolve models outside the app. */
  availableModels?: EngineModelGroup[];
  /** Whether the external model list is still being resolved. */
  modelListLoading?: boolean;
  selectedModel?: string;
  selectedEngine?: string;
  selectedEffort?: ReasoningEffort;
  onModelChange?: (model: string, engine: string) => void;
  onEffortChange?: (effort: ReasoningEffort) => void;
  /** Local or hosted agent runtimes shown above the model list. */
  availableAgents?: ComposerAgentOption[];
  /** Selected agent runtime identifier. */
  selectedAgent?: string;
  /** Show only the selected agent in the model control. */
  agentOnly?: boolean;
  /** Callback when the user picks an agent runtime. */
  onAgentChange?: (agent: string) => void;
  /** Called when the shared model picker opens or closes. */
  onModelSelectorOpenChange?: (open: boolean) => void;
  /** Enable server-backed model/provider status checks. Defaults on, except for a selected local runtime. */
  modelStatusChecksEnabled?: boolean;
  /** Called whenever the plain editor text changes. */
  onTextChange?: (text: string) => void;
  mentionItems?: MentionItem[];
  /** Why some of `mentionItems` could not load, shown in the @ popover. */
  mentionItemsError?: string;
  onRetryMentionItems?: () => void;
  mentionPopoverDensity?: "default" | "stacked";
  includeDefaultMentionSearch?: boolean;
  onReferencesChange?: (references: Reference[]) => void;
  onEscape?: () => void;
  /** ArrowUp in an empty composer; return true when the last message was recalled. */
  onRecallLastMessage?: () => boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onSelectionChange?: (selection: ComposerTextSelection) => void;
  /** Called whenever attached files change, before the composer is submitted. */
  onAttachmentsChange?: (files: PromptComposerFile[]) => void;
  /** Called whenever the composer resolves a model, engine, or effort choice. */
  onModelSelectionChange?: (
    selection: Pick<PromptComposerSubmitOptions, "model" | "engine" | "effort">,
  ) => void;
  /**
   * Handle the existing-account choice in the Builder chooser in the model
   * picker. "Create and activate" always uses the shared one-click flow.
   */
  onConnectProvider?: () => void;
  /** Called when a local runtime needs its native sign-in/setup flow. */
  onConnectLocalRuntime?: (engine: string) => void;
  imageModelMenu?: ComposerImageModelMenu;
  /** Imperative handle for focusing the composer. */
  composerRef?: Ref<TiptapComposerHandle>;
}

// Minimal pass-through adapter. PromptComposer always submits through
// onSubmitOverride, so the runtime never actually calls this — but
// `useLocalRuntime` needs *something* shaped like a ChatModelAdapter.
const NOOP_ADAPTER: ChatModelAdapter = {
  async *run() {
    yield* [];
  },
};

/**
 * Local binary document adapter so reference PDFs, decks, and docs can be
 * attached without dragging the whole assistant chat module into bundles that
 * just want a prompt popover.
 */
class BinaryDocumentAttachmentAdapter implements AttachmentAdapter {
  public accept = PROMPT_DOCUMENT_ATTACHMENT_ACCEPT;

  public async add(state: { file: File }): Promise<PendingAttachment> {
    return {
      id: crypto.randomUUID(),
      type: "document",
      name: state.file.name,
      contentType: state.file.type || "application/octet-stream",
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
      content: [],
    };
  }

  public async remove() {
    /* noop */
  }
}

class RasterImageAttachmentAdapter extends SimpleImageAttachmentAdapter {
  public override accept = IMAGE_ATTACHMENT_ACCEPT;
  private readonly translate: ComposerTranslate;

  constructor(translate: ComposerTranslate) {
    super();
    this.translate = translate;
  }

  public override async add(state: { file: File }): Promise<PendingAttachment> {
    const limitError = await getUnshrinkableImageError(
      state.file,
      this.translate,
    );
    if (limitError) throw new Error(limitError);
    return { ...(await super.add(state)), id: crypto.randomUUID() };
  }
}

// SVGs never match the raster adapter, so agent chat stages them as reference
// documents rather than images a model would try to read as pixels.
class ChatDocumentAttachmentAdapter extends BinaryDocumentAttachmentAdapter {
  public override accept = CHAT_DOCUMENT_ATTACHMENT_ACCEPT;
}

export function createChatAttachmentAdapter(
  translate: ComposerTranslate = fallbackTranslate,
): AttachmentAdapter {
  return new CompositeAttachmentAdapter([
    new RasterImageAttachmentAdapter(translate),
    new ChatDocumentAttachmentAdapter(),
    new TextAttachmentAdapter(),
  ]);
}

function isInlineableTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (
    file.type === "application/json" ||
    file.type === "application/x-yaml" ||
    file.type === "message/rfc822"
  ) {
    return true;
  }
  return /\.(txt|md|markdown|csv|json|yaml|yml|html?|css|xml|eml)$/i.test(
    file.name,
  );
}

function formatInlineTextFile(name: string, text: string): string {
  const truncated = text.length > MAX_INLINE_TEXT_FILE_CHARS;
  const body = truncated ? text.slice(0, MAX_INLINE_TEXT_FILE_CHARS) : text;
  return [
    `<uploaded-text-file name="${escapePromptAttachmentAttribute(name)}">`,
    body,
    truncated
      ? `[Truncated after ${MAX_INLINE_TEXT_FILE_CHARS} characters.]`
      : "",
    "</uploaded-text-file>",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Only a confirmed missing provider disables the composer. */
export function shouldGateComposerForEngine(
  state: ComposerAgentEngineState,
): boolean {
  return state === "missing";
}

/** Show setup treatment only when a confirmed-missing engine has setup UI. */
export function shouldGateComposerForMissingEngine(input: {
  state: string;
  hasSetupComponent: boolean;
}): boolean {
  return input.state === "missing" && input.hasSetupComponent;
}

export function shouldCheckModelStatus(input: {
  enabled?: boolean;
  selectedEngine?: string;
}): boolean {
  return input.enabled ?? !isLocalRuntimeEngine(input.selectedEngine);
}

export function resolveComposerModelStatusChecksEnabled(input: {
  enabled?: boolean;
  selectedEngine?: string;
  defaultEngine?: string;
}): boolean {
  return shouldCheckModelStatus({
    enabled: input.enabled,
    selectedEngine: input.selectedEngine ?? input.defaultEngine,
  });
}

export async function buildPromptComposerSubmission(options: {
  text: string;
  attachments?: ReadonlyArray<unknown>;
  inlineTextAttachments?: boolean;
}): Promise<{ text: string; files: File[] }> {
  const files: File[] = [];
  const pastedTextBlocks: string[] = [];
  const rawText = options.text;

  for (const att of options.attachments ?? []) {
    const a = att as Attachment;
    if ("file" in a && a.file instanceof File) {
      const file = a.file;
      if (isPastedTextAttachmentName(file.name)) {
        try {
          pastedTextBlocks.push(await file.text());
        } catch {
          files.push(file);
        }
      } else {
        if (
          options.inlineTextAttachments !== false &&
          isInlineableTextFile(file)
        ) {
          try {
            pastedTextBlocks.push(
              formatInlineTextFile(file.name, await file.text()),
            );
          } catch {
            // Keep the upload path fallback below.
          }
        }
        // Note: images are NOT inlined into the prompt text even when small.
        // Inlining a base64 data-URL into a text string consumes an enormous
        // number of tokens (≈ 700 K per MB) and most hosts handle images via
        // proper attachment channels. The `files` array below carries the image
        // for the host to process through a dedicated attachment pipeline.
        files.push(file);
      }
    }
  }

  return {
    text: pastedTextBlocks.length
      ? [rawText.trim(), ...pastedTextBlocks].filter(Boolean).join("\n\n")
      : rawText,
    files,
  };
}

function getAttachmentImageFile(attachment: Attachment): File | null {
  if (attachment.type !== "image") return null;
  return "file" in attachment && attachment.file ? attachment.file : null;
}

function getAttachmentContentImageSrc(attachment: Attachment): string | null {
  if (attachment.type !== "image") return null;
  const imagePart = attachment.content?.find((part) => part.type === "image");
  return imagePart && "image" in imagePart ? imagePart.image : null;
}

/**
 * The object URL is created and revoked by the same effect run. Creating it
 * during render and revoking it in a cleanup breaks under StrictMode, which
 * runs the cleanup once and leaves the image pointing at a revoked URL.
 */
function useAttachmentImageSrc(attachment: Attachment): string | null {
  const file = getAttachmentImageFile(attachment);
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setBlobSrc(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setBlobSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return file ? blobSrc : getAttachmentContentImageSrc(attachment);
}

function ImagePreviewLightbox({
  src,
  alt,
  children,
}: {
  src: string | null;
  alt: string;
  children: ReactNode;
}) {
  const t = useComposerRuntimeAdapters().translate!;
  return (
    <Dialog>
      {/* The trigger is what the dialog hands focus back to on close. */}
      <DialogTrigger asChild disabled={!src}>
        {children}
      </DialogTrigger>
      <DialogContent
        hideClose
        aria-describedby={undefined}
        className="min-h-24 w-auto min-w-24 max-w-[calc(100vw-3rem)] place-items-center gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">
          {t("agentChat.composer.imagePreview", {
            defaultValue: "Image preview",
          })}
        </DialogTitle>
        {src ? (
          <img
            src={src}
            alt={alt}
            className="max-h-[calc(100vh-6rem)] max-w-full object-contain"
          />
        ) : null}
        <DialogClose asChild>
          <Button
            type="button"
            variant="secondary"
            size="icon-xs"
            aria-label={t("agentChat.composer.closePreview", {
              defaultValue: "Close preview",
            })}
            className="absolute end-2 top-2 [&_svg]:size-4"
          >
            <IconX aria-hidden="true" />
          </Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

function useAttachmentReadError(
  attachment: Attachment,
): AgentPromptAttachmentReadError | null {
  const file = "file" in attachment ? attachment.file : undefined;
  const [readError, setReadError] =
    useState<AgentPromptAttachmentReadError | null>(null);
  useEffect(() => {
    setReadError(null);
    if (!file) return;
    let active = true;
    void probeAgentPromptAttachment(file).then((error) => {
      if (active) setReadError(error);
    });
    return () => {
      active = false;
    };
  }, [file]);
  return readError;
}

/** @internal exported for unit tests only */
export function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: (id: string) => void;
}) {
  const src = useAttachmentImageSrc(attachment);
  const isImage =
    getAttachmentImageFile(attachment) !== null ||
    getAttachmentContentImageSrc(attachment) !== null;
  const readError = useAttachmentReadError(attachment);
  const t = useComposerRuntimeAdapters().translate!;

  if (readError) {
    const message =
      readError === "too-large"
        ? t("agentChat.composer.attachmentTooLarge", {
            defaultValue: "File is over 8 MB",
          })
        : readError === "not-utf8"
          ? t("agentChat.composer.attachmentNotUtf8", {
              defaultValue: "File isn't UTF-8 text",
            })
          : t("agentChat.composer.attachmentReadFailed", {
              defaultValue: "Couldn't read this file",
            });
    return (
      <div
        role="status"
        title={message}
        className="agent-composer-attachment-chip group relative inline-flex max-w-[240px] items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs"
      >
        <IconAlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{attachment.name}</span>
          <span className="truncate text-muted-foreground">{message}</span>
        </span>
        <button
          type="button"
          onClick={() => onRemove(attachment.id)}
          aria-label={t("agentChat.composer.removeAttachment", {
            name: attachment.name,
            defaultValue: `Remove ${attachment.name}`,
          })}
          className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
        >
          <IconX className="h-3 w-3" />
        </button>
      </div>
    );
  }

  if (isPastedTextAttachmentName(attachment.name)) {
    return <PastedTextChip attachment={attachment} onRemove={onRemove} />;
  }

  if (isImage) {
    return (
      <div className="relative inline-flex">
        <ImagePreviewLightbox src={src} alt={attachment.name}>
          <button
            type="button"
            aria-label={t("agentChat.composer.previewAttachment", {
              name: attachment.name,
              defaultValue: `Preview ${attachment.name}`,
            })}
            className="agent-composer-attachment-image group flex h-16 min-w-16 max-w-28 cursor-zoom-in items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-muted/50"
          >
            {src ? (
              <img
                src={src}
                alt={attachment.name}
                className="max-h-full max-w-full object-contain p-1"
              />
            ) : null}
          </button>
        </ImagePreviewLightbox>
        <button
          type="button"
          onClick={() => onRemove(attachment.id)}
          aria-label={t("agentChat.composer.removeAttachment", {
            name: attachment.name,
            defaultValue: `Remove ${attachment.name}`,
          })}
          data-agent-composer-slot="attachment-remove"
          className="absolute end-1 top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-border/60 bg-background/90 text-muted-foreground hover:text-foreground after:absolute after:-inset-0.5 after:content-['']"
        >
          <IconX className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="agent-composer-attachment-chip group relative inline-flex max-w-[200px] items-center gap-2 rounded-md border border-border/70 bg-muted/50 px-2 py-1.5 text-xs">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-background agent-kit-micro-copy font-semibold uppercase text-muted-foreground">
        {attachment.name.split(".").pop() ||
          t("agentChat.composer.file", { defaultValue: "file" })}
      </div>
      <span className="min-w-0 truncate font-medium">{attachment.name}</span>
      <button
        type="button"
        onClick={() => onRemove(attachment.id)}
        aria-label={t("agentChat.composer.removeAttachment", {
          name: attachment.name,
          defaultValue: `Remove ${attachment.name}`,
        })}
        data-agent-composer-slot="attachment-remove"
        className="relative flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground after:absolute after:-inset-0.5 after:content-['']"
      >
        <IconX className="h-3 w-3" />
      </button>
    </div>
  );
}

const NO_HIDDEN_ATTACHMENTS: readonly string[] = [];

function PromptAttachmentStrip({
  hiddenIds = NO_HIDDEN_ATTACHMENTS,
}: {
  hiddenIds?: readonly string[];
}) {
  const allAttachments = useComposer((state) => state.attachments);
  const attachments = hiddenIds.length
    ? allAttachments.filter((attachment) => !hiddenIds.includes(attachment.id))
    : allAttachments;
  const aui = useAui();

  const handleRemove = useCallback(
    (id: string) => {
      void aui.composer().attachment({ id }).remove();
    },
    [aui],
  );

  if (attachments.length === 0) return null;
  return (
    <div className="agent-composer-attachment-strip max-h-24 overflow-y-auto overscroll-contain flex flex-wrap gap-2 px-[var(--agentkit-composer-inset,0.75rem)] pt-2">
      {attachments.map((attachment) => (
        <AttachmentChip
          key={attachment.id}
          attachment={attachment}
          onRemove={handleRemove}
        />
      ))}
    </div>
  );
}

function PromptComposerInner({
  onSubmit,
  onEmptySubmit,
  contextItems,
  onRemoveContextItem,
  onInspectContextItem,
  onRetryContextItem,
  contextMenuItems,
  placeholder,
  replyPlaceholder,
  conversationStarted,
  ariaLabel,
  disabled,
  isReferenceTarget,
  submissionDisabled,
  showMissingApiKeySetup = true,
  setupCardVisible: hostSetupCardVisible,
  onModelConnectionRequiredChange,
  sendButtonDisabled,
  submitting,
  willQueue = false,
  queuesBehindSubmission,
  onDisabledClick,
  maxDocumentAttachmentBytes,
  documentAttachmentLimitLabel,
  autoFocus,
  className,
  style,
  rootClassName,
  rootStyle,
  draftScope,
  preserveDraftOnSubmit = false,
  clearOnSubmitImmediately,
  showModelSelector = true,
  modelSelectorOpen,
  showAutoModelOption = true,
  voiceEnabled = DEFAULT_VOICE_DICTATION_ENABLED,
  voiceChatEnabled = true,
  onVoiceChatStart,
  attachmentsEnabled = true,
  onAttachmentRequest,
  contextButtonTooltipDisabled = false,
  inlineTextAttachments = true,
  plusMenuMode,
  terminalModeControl,
  extensionTools = false,
  initialText,
  initialTextKey,
  initialReferences,
  modeControl,
  requireAgentEngine = false,
  planCommand,
  toolbarSlot,
  contextUsageSlot,
  headerSlot,
  noticeOutlet,
  attachButton,
  actionButton,
  extraActionButton,
  stopButton,
  layoutVariant,
  slashCommands,
  slashSkills,
  includeDefaultSlashCommands,
  includeDefaultSlashSkills,
  onSlashCommand,
  availableModels,
  modelListLoading,
  selectedModel,
  selectedEngine,
  selectedEffort,
  onModelChange,
  onEffortChange,
  availableAgents,
  selectedAgent,
  agentOnly = false,
  onAgentChange,
  onModelSelectorOpenChange,
  modelStatusChecksEnabled,
  onTextChange,
  mentionItems,
  mentionItemsError,
  onRetryMentionItems,
  mentionPopoverDensity,
  includeDefaultMentionSearch,
  onReferencesChange,
  onEscape,
  onRecallLastMessage,
  onFocus,
  onBlur,
  onSelectionChange,
  onAttachmentsChange,
  onModelSelectionChange,
  onConnectProvider,
  onConnectLocalRuntime,
  imageModelMenu,
  composerRef,
  onBeforeSubmit,
  onSubmissionPendingChange,
  onSubmitStart,
  getSubmitFailureDraftScope,
  onAttachmentError,
  interceptBuildRequestsForBuilder,
}: PromptComposerProps) {
  const adapters = useComposerRuntimeAdapters();
  const t = adapters.translate!;
  const modelsAdapter = adapters.models!;
  const BuilderSetupCard = modelsAdapter.BuilderSetupCard;
  const localRef = useRef<TiptapComposerHandle>(null);
  // Keep our own copy of the handle so autofocus and held submits work when
  // the caller passes a callback ref instead of a ref object.
  const handleRef = useCallback(
    (handle: TiptapComposerHandle | null) => {
      localRef.current = handle;
      if (typeof composerRef !== "function") {
        if (composerRef) composerRef.current = handle;
        return;
      }
      const cleanup = composerRef(handle);
      // React runs a returned cleanup instead of calling the ref with null,
      // so pass the caller's cleanup through.
      if (typeof cleanup !== "function") return;
      return () => {
        localRef.current = null;
        cleanup();
      };
    },
    [composerRef],
  );
  const attachments = useComposer((state) => state.attachments);
  const attachmentFiles = useMemo(
    () =>
      attachments.flatMap((attachment) =>
        attachment.file && !isPastedTextAttachmentName(attachment.name)
          ? [attachment.file]
          : [],
      ),
    [attachments],
  );
  const onAttachmentsChangeRef = useRef(onAttachmentsChange);
  useEffect(() => {
    onAttachmentsChangeRef.current = onAttachmentsChange;
  }, [onAttachmentsChange]);
  useEffect(() => {
    onAttachmentsChangeRef.current?.(attachmentFiles);
  }, [attachmentFiles]);
  const requestedModelStatusChecksEnabled = shouldCheckModelStatus({
    enabled: modelStatusChecksEnabled,
    selectedEngine,
  });
  const models = modelsAdapter.useChatModels!({
    enabled: showModelSelector && requestedModelStatusChecksEnabled,
  });
  const composerModel = showModelSelector
    ? (selectedModel ?? models.selectedModel)
    : undefined;
  const composerEngine = showModelSelector
    ? (selectedEngine ?? models.selectedEngine)
    : undefined;
  const resolvedModelStatusChecksEnabled =
    resolveComposerModelStatusChecksEnabled({
      enabled: modelStatusChecksEnabled,
      selectedEngine,
      defaultEngine: models.selectedEngine,
    });
  const composerEffort = showModelSelector
    ? (selectedEffort ?? models.selectedEffort)
    : undefined;
  const onModelSelectionChangeRef = useRef(onModelSelectionChange);
  useEffect(() => {
    onModelSelectionChangeRef.current = onModelSelectionChange;
  }, [onModelSelectionChange]);
  useEffect(() => {
    onModelSelectionChangeRef.current?.({
      model: composerModel,
      engine: composerEngine,
      effort: composerEffort,
    });
  }, [composerEffort, composerEngine, composerModel]);
  const composerModelGroups = showModelSelector
    ? (availableModels ?? models.availableModels)
    : undefined;
  const composerModelListLoading =
    showModelSelector &&
    (modelListLoading ??
      (availableModels ? availableModels.length === 0 : models.isLoading));
  const handleModelChange = showModelSelector
    ? (onModelChange ?? models.onModelChange)
    : undefined;
  const handleEffortChange = showModelSelector
    ? (onEffortChange ?? models.onEffortChange)
    : undefined;
  const readinessEngine = selectedEngine ?? models.selectedEngine;
  const engineStatusChecksEnabled =
    requireAgentEngine && !isLocalRuntimeEngine(readinessEngine);
  const agentEngineConfigured = modelsAdapter.useAgentEngineConfigured!(
    engineStatusChecksEnabled,
  );
  const engineState = engineStatusChecksEnabled
    ? agentEngineConfigured.state
    : "configured";
  const [modelListNeedsConnection, setModelListNeedsConnection] =
    useState(false);
  const handleModelConnectionRequiredChange = useCallback(
    (required: boolean) => {
      setModelListNeedsConnection(required);
      onModelConnectionRequiredChange?.(required);
    },
    [onModelConnectionRequiredChange],
  );
  // The model list knows nothing is connected well before the readiness
  // check answers; an answer of "configured" still wins.
  const missingApiKey =
    engineStatusChecksEnabled &&
    (engineState === "missing" ||
      (engineState !== "configured" && modelListNeedsConnection));
  const [setupBouncePulse, setSetupBouncePulse] = useState(0);
  const [providerCheckPending, setProviderCheckPending] = useState(false);
  const heldProviderDraftRef = useRef<ComposerDraftSnapshot | null>(null);
  const [heldProviderDraftRevision, setHeldProviderDraftRevision] = useState(0);
  const handleBuilderConnected = useCallback(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("agent-engine:configured-changed"));
    }
  }, []);
  const engineSubmissionBlocked = shouldGateComposerForEngine(engineState);
  const ownSetupCardVisible = Boolean(
    missingApiKey && showMissingApiKeySetup && BuilderSetupCard,
  );
  const setupCardVisible = hostSetupCardVisible ?? ownSetupCardVisible;
  // With nothing connected the prompt is closed to typing and a click on it
  // points at the setup card; without a card on screen it stays open, since a
  // closed prompt with nothing to explain it is a dead end.
  const composerDisabled = Boolean(
    disabled || (missingApiKey && setupCardVisible),
  );
  const handleDisabledComposerClick = useCallback(() => {
    if (missingApiKey) setSetupBouncePulse((pulse) => pulse + 1);
    onDisabledClick?.();
  }, [missingApiKey, onDisabledClick]);
  const validateEngineBeforeSubmit = useCallback(async () => {
    if (!engineStatusChecksEnabled) return "configured" as const;
    try {
      const fetchConfiguredState =
        modelsAdapter.fetchAgentEngineConfiguredState;
      if (!fetchConfiguredState) return "unavailable" as const;
      return await fetchConfiguredState(true, {
        fresh: false,
        timeoutMs: 10_000,
      });
    } catch {
      return "unavailable" as const;
    }
  }, [
    engineStatusChecksEnabled,
    modelsAdapter.fetchAgentEngineConfiguredState,
  ]);
  const beforeSubmit = useCallback(
    async (
      draft?: Parameters<NonNullable<PromptComposerProps["onBeforeSubmit"]>>[0],
    ) => {
      setProviderCheckPending(true);
      try {
        const state = await validateEngineBeforeSubmit();
        if (state !== "configured") {
          if (state === "missing") {
            if (draft) {
              heldProviderDraftRef.current = draft;
              setHeldProviderDraftRevision((revision) => revision + 1);
            }
            setSetupBouncePulse((pulse) => pulse + 1);
            onDisabledClick?.();
          }
          return false;
        }
        heldProviderDraftRef.current = null;
        return onBeforeSubmit ? await onBeforeSubmit(draft) : true;
      } finally {
        setProviderCheckPending(false);
      }
    },
    [onBeforeSubmit, onDisabledClick, validateEngineBeforeSubmit],
  );
  useEffect(() => {
    const held = heldProviderDraftRef.current;
    if (engineState !== "configured" || !held) return;
    heldProviderDraftRef.current = null;
    const target = localRef.current;
    const current = target?.getDraftSnapshot?.();
    if (current && sameComposerDraft(held, current)) {
      void target?.submit?.();
    }
  }, [engineState, heldProviderDraftRevision]);
  const useInlineMissingKeySetup = layoutVariant === "compact";
  const [optimisticAttachmentIds, setOptimisticAttachmentIds] = useState<
    readonly string[]
  >(NO_HIDDEN_ATTACHMENTS);
  const [engineNoticeDismissed, setEngineNoticeDismissed] = useState(false);
  useEffect(() => {
    if (engineState !== "unavailable") setEngineNoticeDismissed(false);
  }, [engineState]);
  const retryEngineStatus = useCallback(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("agent-engine:configured-changed"));
    }
  }, []);
  useEffect(() => {
    if (!autoFocus || composerDisabled) return;
    const id = window.setTimeout(() => localRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [autoFocus, composerDisabled]);

  const handleSubmit = useCallback(
    async (
      text: string,
      references: Reference[],
      attachments?: ReadonlyArray<unknown>,
      submitOptions?: TiptapComposerSubmitOptions,
    ) => {
      // PromptComposer hosts (NewWorkspaceAppFlow, create-extension, create-deck,
      // …) submit a single string prompt — they don't run the assistant-ui
      // attachment send pipeline. TiptapComposer auto-converts large pastes
      // into a "Pasted text" chip, which would otherwise disappear into an
      // unprocessed File. Inline the chip body back into the prompt text so
      // newlines and full content survive the round-trip.
      const { text: finalText, files } = await buildPromptComposerSubmission({
        text,
        attachments,
        inlineTextAttachments,
      });
      await onSubmit(finalText, files, references, {
        intent: submitOptions?.intent ?? "immediate",
        ...(submitOptions?.steer ? { steer: true } : {}),
        onLocalSubmit: submitOptions?.onLocalSubmit,
        ...(submitOptions?.submissionId
          ? { submissionId: submitOptions.submissionId }
          : {}),
        model: composerModel,
        engine: composerEngine,
        effort: composerEffort,
        attachments,
        ...(submitOptions?.composerModeContext === undefined
          ? {}
          : { composerModeContext: submitOptions.composerModeContext }),
        ...(submitOptions?.contextItems === undefined
          ? {}
          : { contextItems: submitOptions.contextItems }),
        ...(submitOptions?.requestMode
          ? { requestMode: submitOptions.requestMode }
          : {}),
      });
    },
    [
      composerEffort,
      composerEngine,
      composerModel,
      onSubmit,
      inlineTextAttachments,
    ],
  );

  return (
    <>
      {ownSetupCardVisible && BuilderSetupCard ? (
        <BuilderSetupCard
          onConnected={handleBuilderConnected}
          bouncePulse={setupBouncePulse}
          attached
          fullWidth
          layout={useInlineMissingKeySetup ? "sidebar" : "default"}
        />
      ) : null}
      <AgentComposerFrame
        className={cn(
          "text-start",
          (composerDisabled ||
            (engineStatusChecksEnabled && engineState === "missing") ||
            (missingApiKey && setupCardVisible)) &&
            "agent-composer-area--attached-above",
          className,
        )}
        rootClassName={rootClassName}
        style={style}
        rootStyle={rootStyle}
        layoutVariant={layoutVariant}
        noticeOutlet={noticeOutlet}
        onClick={composerDisabled ? handleDisabledComposerClick : undefined}
      >
        {engineState === "unavailable" && !engineNoticeDismissed ? (
          <ComposerNotice
            noticeId="provider-status-unavailable"
            actions={
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={retryEngineStatus}
              >
                {t("agentChat.common.retry")}
              </Button>
            }
            onDismiss={() => setEngineNoticeDismissed(true)}
            dismissLabel={t("agentChat.common.dismiss")}
          >
            {t("agentChat.setup.providerStatusUnavailable")}
          </ComposerNotice>
        ) : null}
        <PromptAttachmentStrip hiddenIds={optimisticAttachmentIds} />
        <TiptapComposer
          contextItems={contextItems}
          contextMenuItems={contextMenuItems}
          onRemoveContextItem={onRemoveContextItem}
          onInspectContextItem={onInspectContextItem}
          onRetryContextItem={onRetryContextItem}
          attachmentsEnabled={attachmentsEnabled}
          onAttachmentRequest={onAttachmentRequest}
          contextButtonTooltipDisabled={contextButtonTooltipDisabled}
          ariaLabel={ariaLabel}
          focusRef={handleRef}
          disabled={composerDisabled}
          isReferenceTarget={isReferenceTarget}
          contextControlsDisabled={engineSubmissionBlocked}
          submissionDisabled={submissionDisabled}
          sendButtonDisabled={sendButtonDisabled || providerCheckPending}
          sendButtonBusy={submitting || providerCheckPending}
          submitting={submitting}
          willQueue={willQueue}
          queuesBehindSubmission={queuesBehindSubmission}
          maxDocumentAttachmentBytes={maxDocumentAttachmentBytes}
          documentAttachmentLimitLabel={documentAttachmentLimitLabel}
          placeholder={placeholder}
          replyPlaceholder={replyPlaceholder}
          conversationStarted={conversationStarted}
          initialText={initialText}
          initialTextKey={initialTextKey}
          initialReferences={initialReferences}
          onSubmit={handleSubmit}
          onEmptySubmit={onEmptySubmit}
          onBeforeSubmit={beforeSubmit}
          onSubmissionPendingChange={onSubmissionPendingChange}
          onSubmitStart={onSubmitStart}
          onOptimisticAttachmentsChange={setOptimisticAttachmentIds}
          getSubmitFailureDraftScope={getSubmitFailureDraftScope}
          onAttachmentError={onAttachmentError}
          interceptBuildRequestsForBuilder={interceptBuildRequestsForBuilder}
          clearOnSubmit={!preserveDraftOnSubmit}
          clearOnSubmitImmediately={clearOnSubmitImmediately}
          plusMenuMode={
            plusMenuMode ??
            (attachmentsEnabled || onAttachmentRequest
              ? "upload-only"
              : "hidden")
          }
          terminalModeControl={terminalModeControl}
          extensionTools={extensionTools}
          attachButton={attachmentsEnabled ? attachButton : null}
          modeControl={modeControl}
          planCommand={planCommand}
          toolbarSlot={toolbarSlot}
          contextUsageSlot={contextUsageSlot}
          headerSlot={headerSlot}
          actionButton={actionButton}
          extraActionButton={extraActionButton}
          stopButton={stopButton}
          layoutVariant={layoutVariant}
          slashCommands={slashCommands}
          slashSkills={slashSkills}
          includeDefaultSlashCommands={includeDefaultSlashCommands}
          includeDefaultSlashSkills={includeDefaultSlashSkills}
          onSlashCommand={onSlashCommand}
          voiceEnabled={voiceEnabled}
          voiceChatEnabled={voiceChatEnabled}
          onVoiceChatStart={onVoiceChatStart}
          onTextChange={onTextChange}
          mentionItems={mentionItems}
          mentionItemsError={mentionItemsError}
          onRetryMentionItems={onRetryMentionItems}
          mentionPopoverDensity={mentionPopoverDensity}
          includeDefaultMentionSearch={includeDefaultMentionSearch}
          onReferencesChange={onReferencesChange}
          onEscape={onEscape}
          onRecallLastMessage={onRecallLastMessage}
          onFocus={onFocus}
          onBlur={onBlur}
          onSelectionChange={onSelectionChange}
          draftScope={draftScope}
          selectedModel={composerModel}
          selectedEngine={composerEngine}
          modelSelectorOpen={modelSelectorOpen}
          selectedEffort={composerEffort}
          availableModels={composerModelGroups}
          availableAgents={availableAgents}
          selectedAgent={selectedAgent}
          agentOnly={agentOnly}
          showAutoModelOption={showAutoModelOption}
          modelListLoading={composerModelListLoading}
          onModelChange={handleModelChange}
          onEffortChange={handleEffortChange}
          onAgentChange={onAgentChange}
          onModelSelectorOpenChange={onModelSelectorOpenChange}
          providerConnectStatusEnabled={resolvedModelStatusChecksEnabled}
          onConnectProvider={onConnectProvider}
          onConnectLocalRuntime={onConnectLocalRuntime}
          imageModelMenu={imageModelMenu}
          setupCardVisible={setupCardVisible}
          onModelConnectionRequiredChange={handleModelConnectionRequiredChange}
        />
      </AgentComposerFrame>
    </>
  );
}

/**
 * Standalone composer that mirrors the agent sidebar's input experience —
 * voice dictation, file upload, model selector, submit-on-Enter — for use in
 * popovers and inline prompt forms (create tool, create deck, create dashboard,
 * the Dispatch new-app flow, etc.).
 *
 * The host owns submission: when the user presses Enter or clicks submit,
 * `onSubmit(text, files, references, options)` is called. PromptComposer runs
 * its own minimal assistant-ui runtime so it can be dropped into any subtree
 * without needing the outer chat to be mounted.
 */
function PromptComposerRuntime(props: PromptComposerProps) {
  const adapters = useComposerRuntimeAdapters();
  const StaleIndexBoundary = adapters.agentChat.StaleIndexBoundary;
  const attachmentAdapter = useMemo(
    () =>
      props.attachmentAdapter ??
      new CompositeAttachmentAdapter([
        new RasterImageAttachmentAdapter(adapters.translate),
        new BinaryDocumentAttachmentAdapter(),
        new TextAttachmentAdapter(),
      ]),
    [props.attachmentAdapter, adapters.translate],
  );
  const runtime = useLocalRuntime(NOOP_ADAPTER, {
    adapters: { attachments: attachmentAdapter },
  });
  const resetKey = [props.draftScope ?? "", props.initialTextKey ?? ""].join(
    ":",
  );

  return (
    <TooltipProvider delayDuration={200}>
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root
          className="contents"
          style={{ display: "contents" }}
        >
          <StaleIndexBoundary
            resetKey={resetKey}
            componentName="PromptComposer"
            remountOnResetKey={false}
          >
            <PromptComposerInner {...props} />
          </StaleIndexBoundary>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </TooltipProvider>
  );
}

export function PromptComposer(props: PromptComposerProps) {
  return <PromptComposerRuntime key={props.draftScope ?? ""} {...props} />;
}
