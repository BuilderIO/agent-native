import { useCallback, useEffect, useMemo, useRef, type Ref } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
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
  SimpleTextAttachmentAdapter,
} from "@assistant-ui/react";
import { IconX } from "@tabler/icons-react";
import { cn } from "../utils.js";
import { TiptapComposer, type TiptapComposerHandle } from "./TiptapComposer.js";
import type { Reference } from "./types.js";
import { useChatModels } from "../use-chat-models.js";
import { isPastedTextAttachmentName } from "./pasted-text.js";
import { PastedTextChip } from "./PastedTextChip.js";

/**
 * Files the user attached via the "+" button in PromptComposer. The host owns
 * what to do with them — typically POST to a per-app upload endpoint and pass
 * the resulting URLs/paths into the prompt that gets sent to the agent.
 */
export type PromptComposerFile = File;

export interface PromptComposerProps {
  /** Called when the user submits the composer. */
  onSubmit: (
    text: string,
    files: PromptComposerFile[],
    references: Reference[],
  ) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  /** Forwarded to TiptapComposer for draft persistence. */
  draftScope?: string;
  /** Show the model selector (default: true). */
  showModelSelector?: boolean;
  /** Show the voice dictation button (default: true). */
  voiceEnabled?: boolean;
  /** Show file upload controls and pass submitted files to onSubmit (default: true). */
  attachmentsEnabled?: boolean;
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
 * Local clone of AssistantChat's BinaryDocumentAttachmentAdapter so PDFs and
 * PPTX files can be attached without dragging the whole assistant chat module
 * into bundles that just want a prompt popover.
 */
class BinaryDocumentAttachmentAdapter implements AttachmentAdapter {
  public accept =
    "application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pdf,.pptx";

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

function getImageSrc(attachment: Attachment): string | null {
  if (attachment.type !== "image") return null;
  if ("file" in attachment && attachment.file) {
    return URL.createObjectURL(attachment.file);
  }
  const imagePart = attachment.content?.find((part) => part.type === "image");
  return imagePart && "image" in imagePart ? imagePart.image : null;
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: (id: string) => void;
}) {
  const src = useMemo(() => getImageSrc(attachment), [attachment]);
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
      <div className="group relative h-16 w-16 overflow-hidden rounded-lg border border-border/70 bg-muted/50">
        <img
          src={src}
          alt={attachment.name}
          className="h-full w-full object-cover"
        />
        <button
          type="button"
          onClick={() => onRemove(attachment.id)}
          aria-label={`Remove ${attachment.name}`}
          className="absolute right-1 top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-border/60 bg-background/90 text-muted-foreground hover:text-foreground"
        >
          <IconX className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="group relative inline-flex max-w-[200px] items-center gap-2 rounded-md border border-border/70 bg-muted/50 px-2 py-1.5 text-xs">
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
    <div className="flex flex-wrap gap-2 px-2 pt-2">
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
  draftScope,
  showModelSelector = true,
  voiceEnabled = true,
  attachmentsEnabled = true,
  composerRef,
}: PromptComposerProps) {
  const localRef = useRef<TiptapComposerHandle>(null);
  const handleRef = composerRef ?? localRef;
  const models = useChatModels();

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
    ) => {
      // PromptComposer hosts (NewWorkspaceAppFlow, create-tool, create-deck,
      // …) submit a single string prompt — they don't run the assistant-ui
      // attachment send pipeline. TiptapComposer auto-converts large pastes
      // into a "Pasted text" chip, which would otherwise disappear into an
      // unprocessed File. Inline the chip body back into the prompt text so
      // newlines and full content survive the round-trip.
      const files: File[] = [];
      const pastedTextBlocks: string[] = [];
      for (const att of attachments ?? []) {
        const a = att as Attachment;
        if ("file" in a && a.file instanceof File) {
          const file = a.file;
          if (isPastedTextAttachmentName(file.name)) {
            try {
              pastedTextBlocks.push(await file.text());
            } catch {
              // If we can't read it, fall back to surfacing it as a regular
              // attachment file rather than silently losing it.
              files.push(file);
            }
          } else {
            files.push(file);
          }
        }
      }
      const finalText = pastedTextBlocks.length
        ? [text.trim(), ...pastedTextBlocks].filter(Boolean).join("\n\n")
        : text;
      onSubmit(finalText, files, references);
    },
    [onSubmit],
  );

  return (
    <div
      className={cn(
        "agent-composer-area flex flex-col rounded-lg border border-input bg-background focus-within:ring-1 focus-within:ring-ring",
        className,
      )}
    >
      <ComposerPrimitive.Root className="flex flex-col">
        <PromptAttachmentStrip />
        <TiptapComposer
          focusRef={handleRef}
          disabled={disabled}
          placeholder={placeholder}
          onSubmit={handleSubmit}
          plusMenuMode={attachmentsEnabled ? "upload-only" : "hidden"}
          voiceEnabled={voiceEnabled}
          draftScope={draftScope}
          selectedModel={showModelSelector ? models.selectedModel : undefined}
          selectedEffort={showModelSelector ? models.selectedEffort : undefined}
          availableModels={
            showModelSelector ? models.availableModels : undefined
          }
          onModelChange={showModelSelector ? models.onModelChange : undefined}
          onEffortChange={showModelSelector ? models.onEffortChange : undefined}
        />
      </ComposerPrimitive.Root>
    </div>
  );
}

/**
 * Standalone composer that mirrors the agent sidebar's input experience —
 * voice dictation, file upload, model selector, submit-on-Enter — for use in
 * popovers and inline prompt forms (create tool, create deck, create dashboard,
 * the Dispatch new-app flow, etc.).
 *
 * The host owns submission: when the user presses Enter or clicks submit,
 * `onSubmit(text, files, references)` is called. PromptComposer runs its own
 * minimal assistant-ui runtime so it can be dropped into any subtree without
 * needing the outer chat to be mounted.
 */
export function PromptComposer(props: PromptComposerProps) {
  const attachmentAdapter = useMemo(
    () =>
      new CompositeAttachmentAdapter([
        new SimpleImageAttachmentAdapter(),
        new BinaryDocumentAttachmentAdapter(),
        new SimpleTextAttachmentAdapter(),
      ]),
    [],
  );
  const runtime = useLocalRuntime(NOOP_ADAPTER, {
    adapters: { attachments: attachmentAdapter },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="contents">
        <PromptComposerInner {...props} />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
