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

import { TooltipProvider } from "../ui/tooltip.js";
import { cn } from "../utils.js";
import { AgentComposerFrame } from "./AgentComposerFrame.js";
import { IMAGE_ATTACHMENT_ACCEPT } from "./attachment-accept.js";
import {
  PROMPT_DOCUMENT_ATTACHMENT_ACCEPT,
  TextAttachmentAdapter,
} from "./attachment-accept.js";
import type { ComposerContextMenuItem } from "./ComposerContextMenu.js";
import type { ComposerTerminalModeControl } from "./ComposerPlusMenu.js";
import type { ComposerContextSnapshot } from "./context-items.js";
import { isPastedTextAttachmentName } from "./pasted-text.js";
import { PastedTextChip } from "./PastedTextChip.js";
import { escapePromptAttachmentAttribute } from "./prompt-attachments.js";
import {
  type EngineModelGroup,
  type ComposerAgentEngineState,
  type AgentChatContextItem,
  type ReasoningEffort,
  useComposerRuntimeAdapters,
} from "./runtime-adapters.js";
import {
  DEFAULT_VOICE_DICTATION_ENABLED,
  isLocalRuntimeEngine,
  TiptapComposer,
  type ComposerAgentOption,
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

export type PromptComposerFile = File;

export interface PromptComposerSubmitOptions {
  intent?: ComposerSubmitIntent;
  model?: string;
  engine?: string;
  effort?: ReasoningEffort;
  attachments?: ReadonlyArray<unknown>;
  contextItems?: ComposerContextSnapshot;
}

export interface PromptComposerProps {
  contextItems?: readonly AgentChatContextItem[];
  onRemoveContextItem?: (key: string) => void;
  onInspectContextItem?: (key: string) => void;
  onRetryContextItem?: (key: string) => void;
  contextMenuItems?: readonly ComposerContextMenuItem[];
  onSubmit: (
    text: string,
    files: PromptComposerFile[],
    references: Reference[],
    options: PromptComposerSubmitOptions,
  ) => void | Promise<void>;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  submissionDisabled?: boolean;
  submitting?: boolean;
  willQueue?: boolean;
  onDisabledClick?: () => void;
  maxDocumentAttachmentBytes?: number;
  documentAttachmentLimitLabel?: string;
  autoFocus?: boolean;
  className?: string;
  style?: CSSProperties;
  rootClassName?: string;
  rootStyle?: CSSProperties;
  draftScope?: string;
  preserveDraftOnSubmit?: boolean;
  showModelSelector?: boolean;
  modelSelectorOpen?: boolean;
  showAutoModelOption?: boolean;
  voiceEnabled?: boolean;
  attachmentsEnabled?: boolean;
  attachmentAdapter?: AttachmentAdapter;
  inlineTextAttachments?: boolean;
  plusMenuMode?: "full" | "upload-only" | "terminal" | "hidden";
  terminalModeControl?: ComposerTerminalModeControl;
  extensionTools?: boolean;
  initialText?: string;
  initialTextKey?: string | number;
  modeControl?: ReactNode;
  execMode?: "build" | "plan";
  onExecModeChange?: (mode: "build" | "plan") => void;
  toolbarSlot?: ReactNode;
  attachButton?: ReactNode;
  actionButton?: ReactNode;
  extraActionButton?: ReactNode;
  layoutVariant?: AgentComposerLayoutVariant;
  slashCommands?: SlashCommand[];
  slashSkills?: SkillResult[];
  includeDefaultSlashCommands?: boolean;
  includeDefaultSlashSkills?: boolean;
  onSlashCommand?: (command: string) => void;
  availableModels?: EngineModelGroup[];
  modelListLoading?: boolean;
  selectedModel?: string;
  selectedEngine?: string;
  selectedEffort?: ReasoningEffort;
  onModelChange?: (model: string, engine: string) => void;
  onEffortChange?: (effort: ReasoningEffort) => void;
  availableAgents?: ComposerAgentOption[];
  selectedAgent?: string;
  agentOnly?: boolean;
  onAgentChange?: (agent: string) => void;
  onModelSelectorOpenChange?: (open: boolean) => void;
  modelStatusChecksEnabled?: boolean;
  onTextChange?: (text: string) => void;
  onAttachmentsChange?: (files: PromptComposerFile[]) => void;
  onModelSelectionChange?: (
    selection: Pick<PromptComposerSubmitOptions, "model" | "engine" | "effort">,
  ) => void;
  onConnectProvider?: () => void;
  onConnectLocalRuntime?: (engine: string) => void;
  composerRef?: Ref<TiptapComposerHandle>;
}

const NOOP_ADAPTER: ChatModelAdapter = {
  async *run() {
    yield* [];
  },
};

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

export function shouldGateComposerForEngine(
  state: ComposerAgentEngineState,
): boolean {
  return state !== "configured";
}

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
  const t = useComposerRuntimeAdapters().translate!;
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
      aria-label={t("agentChat.composer.imagePreview", {
        defaultValue: "Image preview",
      })}
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
        aria-label={t("agentChat.composer.closePreview", {
          defaultValue: "Close preview",
        })}
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
  const t = useComposerRuntimeAdapters().translate!;
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
          aria-label={t("agentChat.composer.previewAttachment", {
            name: attachment.name,
            defaultValue: `Preview ${attachment.name}`,
          })}
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
            aria-label={t("agentChat.composer.removeAttachment", {
              name: attachment.name,
              defaultValue: `Remove ${attachment.name}`,
            })}
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
  contextItems,
  onRemoveContextItem,
  onInspectContextItem,
  onRetryContextItem,
  contextMenuItems,
  placeholder,
  ariaLabel,
  disabled,
  submissionDisabled,
  submitting,
  willQueue = false,
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
  showModelSelector = true,
  modelSelectorOpen,
  showAutoModelOption = true,
  voiceEnabled = DEFAULT_VOICE_DICTATION_ENABLED,
  attachmentsEnabled = true,
  inlineTextAttachments = true,
  plusMenuMode,
  terminalModeControl,
  extensionTools = false,
  initialText,
  initialTextKey,
  modeControl,
  execMode,
  onExecModeChange,
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
  onAttachmentsChange,
  onModelSelectionChange,
  onConnectProvider,
  onConnectLocalRuntime,
  composerRef,
}: PromptComposerProps) {
  const adapters = useComposerRuntimeAdapters();
  const t = adapters.translate!;
  const modelsAdapter = adapters.models!;
  const BuilderSetupCard = modelsAdapter.BuilderSetupCard;
  const BuilderSetupContent = modelsAdapter.BuilderSetupContent;
  const localRef = useRef<TiptapComposerHandle>(null);
  const handleRef = composerRef ?? localRef;
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
  const agentEngineConfigured = modelsAdapter.useAgentEngineConfigured!(
    resolvedModelStatusChecksEnabled,
  );
  const engineState = resolvedModelStatusChecksEnabled
    ? agentEngineConfigured.state
    : "configured";
  const missingApiKey =
    resolvedModelStatusChecksEnabled && engineState === "missing";
  const engineStatusUnresolved =
    resolvedModelStatusChecksEnabled &&
    (engineState === "unknown" || engineState === "unavailable");
  const [missingKeyBouncePulse, setMissingKeyBouncePulse] = useState(0);
  const bounceMissingKeySetup = useCallback(() => {
    setMissingKeyBouncePulse((pulse) => pulse + 1);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("agent-chat:missing-api-key"));
    }
  }, []);
  const handleBuilderConnected = useCallback(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("agent-engine:configured-changed"));
    }
  }, []);
  const useInlineMissingKeySetup = layoutVariant === "compact";
  const gateComposer = shouldGateComposerForEngine(engineState);
  const retryEngineStatus = useCallback(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("agent-engine:configured-changed"));
    }
  }, []);
  useEffect(() => {
    if (!autoFocus || disabled || gateComposer) return;
    const id = window.setTimeout(() => {
      const target =
        typeof handleRef === "object" && handleRef && "current" in handleRef
          ? handleRef.current
          : null;
      target?.focus();
    }, 50);
    return () => window.clearTimeout(id);
  }, [autoFocus, disabled, gateComposer, handleRef]);

  const handleSubmit = useCallback(
    async (
      text: string,
      references: Reference[],
      attachments?: ReadonlyArray<unknown>,
      submitOptions?: TiptapComposerSubmitOptions,
    ) => {
      const { text: finalText, files } = await buildPromptComposerSubmission({
        text,
        attachments,
        inlineTextAttachments,
      });
      await onSubmit(finalText, files, references, {
        intent: submitOptions?.intent ?? "immediate",
        model: composerModel,
        engine: composerEngine,
        effort: composerEffort,
        attachments,
        ...(submitOptions?.contextItems === undefined
          ? {}
          : { contextItems: submitOptions.contextItems }),
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
      {missingApiKey && !useInlineMissingKeySetup && BuilderSetupCard ? (
        <BuilderSetupCard
          onConnected={handleBuilderConnected}
          bouncePulse={missingKeyBouncePulse}
          attached
          fullWidth
          layout="sidebar"
        />
      ) : null}
      {missingApiKey && useInlineMissingKeySetup && BuilderSetupContent ? (
        <div className="agent-builder-setup-inline--attached mb-0 rounded-md border border-border/80 bg-background/80 p-2.5 text-start shadow-sm">
          <BuilderSetupContent
            onConnected={handleBuilderConnected}
            layout="sidebar"
          />
        </div>
      ) : null}
      {engineStatusUnresolved ? (
        <div
          className="mb-2 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
          role="status"
        >
          <span>
            {engineState === "unknown"
              ? t("agentChat.setup.checkingProvider")
              : t("agentChat.setup.providerStatusUnavailable")}
          </span>
          {engineState === "unavailable" ? (
            <button
              type="button"
              className="shrink-0 font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={retryEngineStatus}
            >
              {t("agentChat.common.retry")}
            </button>
          ) : null}
        </div>
      ) : null}
      <AgentComposerFrame
        className={cn(
          "text-start",
          (gateComposer || onDisabledClick) &&
            "agent-composer-area--attached-above",
          className,
        )}
        rootClassName={rootClassName}
        style={style}
        rootStyle={rootStyle}
        layoutVariant={layoutVariant}
        onClick={
          gateComposer
            ? missingApiKey
              ? bounceMissingKeySetup
              : retryEngineStatus
            : disabled && onDisabledClick
              ? () => onDisabledClick()
              : undefined
        }
      >
        <PromptAttachmentStrip />
        <TiptapComposer
          contextItems={contextItems}
          contextMenuItems={gateComposer ? undefined : contextMenuItems}
          onRemoveContextItem={onRemoveContextItem}
          onInspectContextItem={onInspectContextItem}
          onRetryContextItem={onRetryContextItem}
          attachmentsEnabled={attachmentsEnabled}
          ariaLabel={ariaLabel}
          focusRef={handleRef}
          disabled={disabled || gateComposer}
          submissionDisabled={submissionDisabled || gateComposer}
          submitting={submitting}
          willQueue={willQueue}
          maxDocumentAttachmentBytes={maxDocumentAttachmentBytes}
          documentAttachmentLimitLabel={documentAttachmentLimitLabel}
          placeholder={
            gateComposer
              ? engineStatusUnresolved
                ? t("agentChat.setup.checkingProvider")
                : t("agentChat.composer.connectAbove", {
                    defaultValue: "Connect AI above to continue...",
                  })
              : placeholder
          }
          initialText={initialText}
          initialTextKey={initialTextKey}
          onSubmit={handleSubmit}
          clearOnSubmit={!preserveDraftOnSubmit}
          plusMenuMode={
            gateComposer
              ? "hidden"
              : (plusMenuMode ??
                (attachmentsEnabled ? "upload-only" : "hidden"))
          }
          terminalModeControl={terminalModeControl}
          extensionTools={extensionTools}
          attachButton={
            gateComposer || !attachmentsEnabled ? null : attachButton
          }
          modeControl={modeControl}
          execMode={execMode}
          onExecModeChange={onExecModeChange}
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
        />
      </AgentComposerFrame>
    </>
  );
}

function PromptComposerRuntime(props: PromptComposerProps) {
  const StaleIndexBoundary =
    useComposerRuntimeAdapters().agentChat!.StaleIndexBoundary!;
  const attachmentAdapter = useMemo(
    () =>
      props.attachmentAdapter ??
      new CompositeAttachmentAdapter([
        new RasterImageAttachmentAdapter(),
        new BinaryDocumentAttachmentAdapter(),
        new TextAttachmentAdapter(),
      ]),
    [props.attachmentAdapter],
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
          <StaleIndexBoundary
            resetKey={resetKey}
            componentName="PromptComposer"
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
