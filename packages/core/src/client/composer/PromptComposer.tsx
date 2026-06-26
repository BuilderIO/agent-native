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
import { IconX } from "@tabler/icons-react";
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

import type { ReasoningEffort } from "../../shared/reasoning-effort.js";
import { AssistantUiStaleIndexErrorBoundary } from "../assistant-ui-recovery.js";
import { TooltipProvider } from "../components/ui/tooltip.js";
import { useChatModels, type EngineModelGroup } from "../use-chat-models.js";
import { cn } from "../utils.js";
import { AgentComposerFrame } from "./AgentComposerFrame.js";
import { IMAGE_ATTACHMENT_ACCEPT } from "./attachment-accept.js";
import {
  PROMPT_DOCUMENT_ATTACHMENT_ACCEPT,
  TextAttachmentAdapter,
} from "./attachment-accept.js";
import { isPastedTextAttachmentName } from "./pasted-text.js";
import { PastedTextChip } from "./PastedTextChip.js";
import { escapePromptAttachmentAttribute } from "./prompt-attachments.js";
import {
  DEFAULT_VOICE_DICTATION_ENABLED,
  TiptapComposer,
  type ComposerSubmitIntent,
  type TiptapComposerHandle,
  type TiptapComposerSubmitOptions,
} from "./TiptapComposer.js";
import type {
  AgentComposerLayoutVariant,
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
  model?: string;
  engine?: string;
  effort?: ReasoningEffort;
}

export interface PromptComposerProps {
  /** Called when the user submits the composer. */
  onSubmit: (
    text: string,
    files: PromptComposerFile[],
    references: Reference[],
    options: PromptComposerSubmitOptions,
  ) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  style?: CSSProperties;
  rootClassName?: string;
  rootStyle?: CSSProperties;
  /** Forwarded to TiptapComposer for draft persistence. */
  draftScope?: string;
  /** Keep the submitted prompt in the editor. Default: false. */
  preserveDraftOnSubmit?: boolean;
  /** Show the model selector (default: true). */
  showModelSelector?: boolean;
  /** Show the voice dictation button. Defaults to DEFAULT_VOICE_DICTATION_ENABLED. */
  voiceEnabled?: boolean;
  /** Show file upload controls and pass submitted files to onSubmit (default: true). */
  attachmentsEnabled?: boolean;
  /**
   * Controls the shared "+" affordance. Defaults to upload-only for standalone
   * prompt forms; chat surfaces can opt into the full sidebar menu.
   */
  plusMenuMode?: "full" | "upload-only" | "hidden";
  /** Programmatically seed the composer with plain text. */
  initialText?: string;
  /** Stable key used to re-apply `initialText` when the host picks a preset. */
  initialTextKey?: string | number;
  /** Optional host-owned control rendered directly after the "+" button. */
  modeControl?: ReactNode;
  /** Explicit host-owned toolbar slot rendered directly after the "+" button. */
  toolbarSlot?: ReactNode;
  /** Custom attachment button to render instead of the default "+" affordance. */
  attachButton?: ReactNode;
  /** Custom action button to render instead of the default send button. */
  actionButton?: ReactNode;
  /** Extra button rendered alongside the default send button. */
  extraActionButton?: ReactNode;
  /** Shared sizing/layout variant for host surfaces. Default keeps sidebar behavior. */
  layoutVariant?: AgentComposerLayoutVariant;
  /** Additional slash commands surfaced in the shared / menu. */
  slashCommands?: SlashCommand[];
  /** Additional slash skills surfaced in the shared / menu. */
  slashSkills?: SkillResult[];
  /** Include built-in sidebar slash commands like /clear and /help. Default true. */
  includeDefaultSlashCommands?: boolean;
  /** Include app-discovered skills from the default agent endpoint. Default true. */
  includeDefaultSlashSkills?: boolean;
  /** Called when a slash command from the shared / menu is executed. */
  onSlashCommand?: (command: string) => void;
  /** External model list for hosts that already resolve models outside the app. */
  availableModels?: EngineModelGroup[];
  selectedModel?: string;
  selectedEngine?: string;
  selectedEffort?: ReasoningEffort;
  onModelChange?: (model: string, engine: string) => void;
  onEffortChange?: (effort: ReasoningEffort) => void;
  /**
   * Enable server-backed model/provider status checks. Defaults off when the
   * host supplies model state and callbacks, otherwise on.
   */
  modelStatusChecksEnabled?: boolean;
  /** Called whenever the plain editor text changes. */
  onTextChange?: (text: string) => void;
  /**
   * Override the Builder.io connect action in the model picker. When provided,
   * clicking "Connect Builder.io" calls this instead of opening a browser popup.
   * Used by the Electron desktop app to route through the native IPC handler.
   */
  onConnectProvider?: () => void;
  /** Imperative handle for focusing the composer. */
  composerRef?: Ref<TiptapComposerHandle>;
}

// Minimal pass-through adapter. PromptComposer always submits through
// onSubmitOverride, so the runtime never actually calls this — but
// `useLocalRuntime` needs *something* shaped like a ChatModelAdapter.
const NOOP_ADAPTER: ChatModelAdapter = {
  async *run() {
    return;
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
      id: state.file.name,
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
  public accept = IMAGE_ATTACHMENT_ACCEPT;
}

function isInlineableTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (file.type === "application/json") return true;
  return /\.(txt|md|markdown|csv|json|yaml|yml|html?|css|xml)$/i.test(
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

export async function buildPromptComposerSubmission(options: {
  text: string;
  attachments?: ReadonlyArray<unknown>;
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
        if (isInlineableTextFile(file)) {
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

function getImageSrc(attachment: Attachment): string | null {
  if (attachment.type !== "image") return null;
  if ("file" in attachment && attachment.file) {
    return URL.createObjectURL(attachment.file);
  }
  const imagePart = attachment.content?.find((part) => part.type === "image");
  return imagePart && "image" in imagePart ? imagePart.image : null;
}

function ImagePreviewLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label="Image preview"
      onClick={onClose}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 p-6 cursor-zoom-out"
    >
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full object-contain rounded-md shadow-2xl cursor-default"
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className="absolute end-4 top-4 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/30 bg-black/40 text-white hover:bg-black/60"
      >
        <IconX className="h-4 w-4" />
      </button>
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: (id: string) => void;
}) {
  const src = useMemo(() => getImageSrc(attachment), [attachment]);
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(
    () => () => {
      if (src?.startsWith("blob:")) URL.revokeObjectURL(src);
    },
    [src],
  );

  if (isPastedTextAttachmentName(attachment.name)) {
    return <PastedTextChip attachment={attachment} onRemove={onRemove} />;
  }

  if (src) {
    return (
      <>
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          aria-label={`Preview ${attachment.name}`}
          className="agent-composer-attachment-image group relative flex h-16 min-w-16 max-w-28 cursor-zoom-in items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-muted/50"
        >
          <img
            src={src}
            alt={attachment.name}
            className="max-h-full max-w-full object-contain p-1"
          />
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(attachment.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onRemove(attachment.id);
              }
            }}
            aria-label={`Remove ${attachment.name}`}
            className="absolute end-1 top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-border/60 bg-background/90 text-muted-foreground hover:text-foreground"
          >
            <IconX className="h-3 w-3" />
          </span>
        </button>
        {previewOpen ? (
          <ImagePreviewLightbox
            src={src}
            alt={attachment.name}
            onClose={() => setPreviewOpen(false)}
          />
        ) : null}
      </>
    );
  }

  return (
    <div className="agent-composer-attachment-chip group relative inline-flex max-w-[200px] items-center gap-2 rounded-md border border-border/70 bg-muted/50 px-2 py-1.5 text-xs">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-background text-[9px] font-semibold uppercase text-muted-foreground">
        {attachment.name.split(".").pop() || "file"}
      </div>
      <span className="min-w-0 truncate font-medium">{attachment.name}</span>
      <button
        type="button"
        onClick={() => onRemove(attachment.id)}
        aria-label={`Remove ${attachment.name}`}
        className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
      >
        <IconX className="h-3 w-3" />
      </button>
    </div>
  );
}

function PromptAttachmentStrip() {
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
    <div className="agent-composer-attachment-strip flex flex-wrap gap-2 px-2 pt-2">
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
  placeholder,
  disabled,
  autoFocus,
  className,
  style,
  rootClassName,
  rootStyle,
  draftScope,
  preserveDraftOnSubmit = false,
  showModelSelector = true,
  voiceEnabled = DEFAULT_VOICE_DICTATION_ENABLED,
  attachmentsEnabled = true,
  plusMenuMode,
  initialText,
  initialTextKey,
  modeControl,
  toolbarSlot,
  attachButton,
  actionButton,
  extraActionButton,
  layoutVariant,
  slashCommands,
  slashSkills,
  includeDefaultSlashCommands,
  includeDefaultSlashSkills,
  onSlashCommand,
  availableModels,
  selectedModel,
  selectedEngine,
  selectedEffort,
  onModelChange,
  onEffortChange,
  modelStatusChecksEnabled,
  onTextChange,
  onConnectProvider,
  composerRef,
}: PromptComposerProps) {
  const localRef = useRef<TiptapComposerHandle>(null);
  const handleRef = composerRef ?? localRef;
  const hostManagedModels = Boolean(
    availableModels && selectedModel && onModelChange,
  );
  const resolvedModelStatusChecksEnabled =
    modelStatusChecksEnabled ?? !hostManagedModels;
  const models = useChatModels({
    enabled: showModelSelector && resolvedModelStatusChecksEnabled,
  });
  const composerModel = showModelSelector
    ? (selectedModel ?? models.selectedModel)
    : undefined;
  const composerEngine = showModelSelector
    ? (selectedEngine ?? models.selectedEngine)
    : undefined;
  const composerEffort = showModelSelector
    ? (selectedEffort ?? models.selectedEffort)
    : undefined;
  const composerModelGroups = showModelSelector
    ? (availableModels ?? models.availableModels)
    : undefined;
  const handleModelChange = showModelSelector
    ? (onModelChange ?? models.onModelChange)
    : undefined;
  const handleEffortChange = showModelSelector
    ? (onEffortChange ?? models.onEffortChange)
    : undefined;

  useEffect(() => {
    if (!autoFocus) return;
    const id = window.setTimeout(() => {
      const target =
        typeof handleRef === "object" && handleRef && "current" in handleRef
          ? handleRef.current
          : null;
      target?.focus();
    }, 50);
    return () => window.clearTimeout(id);
  }, [autoFocus, handleRef]);

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
      });
      onSubmit(finalText, files, references, {
        intent: submitOptions?.intent ?? "immediate",
        model: composerModel,
        engine: composerEngine,
        effort: composerEffort,
      });
    },
    [composerEffort, composerEngine, composerModel, onSubmit],
  );

  return (
    <AgentComposerFrame
      className={cn("text-start", className)}
      rootClassName={rootClassName}
      style={style}
      rootStyle={rootStyle}
      layoutVariant={layoutVariant}
    >
      <PromptAttachmentStrip />
      <TiptapComposer
        focusRef={handleRef}
        disabled={disabled}
        placeholder={placeholder}
        initialText={initialText}
        initialTextKey={initialTextKey}
        onSubmit={handleSubmit}
        clearOnSubmit={!preserveDraftOnSubmit}
        plusMenuMode={
          plusMenuMode ?? (attachmentsEnabled ? "upload-only" : "hidden")
        }
        attachButton={attachButton}
        modeControl={modeControl}
        toolbarSlot={toolbarSlot}
        actionButton={actionButton}
        extraActionButton={extraActionButton}
        layoutVariant={layoutVariant}
        slashCommands={slashCommands}
        slashSkills={slashSkills}
        includeDefaultSlashCommands={includeDefaultSlashCommands}
        includeDefaultSlashSkills={includeDefaultSlashSkills}
        onSlashCommand={onSlashCommand}
        voiceEnabled={voiceEnabled}
        onTextChange={onTextChange}
        draftScope={draftScope}
        selectedModel={composerModel}
        selectedEffort={composerEffort}
        availableModels={composerModelGroups}
        onModelChange={handleModelChange}
        onEffortChange={handleEffortChange}
        providerConnectStatusEnabled={resolvedModelStatusChecksEnabled}
        onConnectProvider={onConnectProvider}
      />
    </AgentComposerFrame>
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
export function PromptComposer(props: PromptComposerProps) {
  const attachmentAdapter = useMemo(
    () =>
      new CompositeAttachmentAdapter([
        new RasterImageAttachmentAdapter(),
        new BinaryDocumentAttachmentAdapter(),
        new TextAttachmentAdapter(),
      ]),
    [],
  );
  const runtime = useLocalRuntime(NOOP_ADAPTER, {
    adapters: { attachments: attachmentAdapter },
  });
  const resetKey = [
    props.draftScope ?? "",
    props.initialTextKey ?? "",
    props.initialText ?? "",
  ].join(":");

  return (
    <TooltipProvider delayDuration={200}>
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root
          className="contents"
          style={{ display: "contents" }}
        >
          <AssistantUiStaleIndexErrorBoundary
            resetKey={resetKey}
            componentName="PromptComposer"
          >
            <PromptComposerInner {...props} />
          </AssistantUiStaleIndexErrorBoundary>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </TooltipProvider>
  );
}
