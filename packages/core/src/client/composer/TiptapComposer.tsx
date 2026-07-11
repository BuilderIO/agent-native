import { useComposer, useComposerRuntime } from "@assistant-ui/react";
import {
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconBulb,
  IconClock,
  IconBolt,
  IconTool,
  IconX,
  IconClipboardList,
  IconPencil,
  IconPlugConnected,
} from "@tabler/icons-react";
import Placeholder from "@tiptap/extension-placeholder";
import type { EditorView } from "@tiptap/pm/view";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  useMemo,
} from "react";

import {
  DEFAULT_REASONING_EFFORT,
  getReasoningEffortOptionsForModel,
  reasoningEffortLabel,
  resolveReasoningEffortSelection,
  type ReasoningEffort,
} from "../../shared/reasoning-effort.js";
import type { VoiceContextPack } from "../../voice/index.js";
import {
  AgentComposerReference,
  formatAgentChatContextItemsForPrompt,
  normalizeAgentComposerReference,
  sendToAgentChat,
  type AgentChatContextItem,
  AgentComposerReferenceInsertPayload,
  AGENT_CHAT_INSERT_REFERENCE_EVENT,
  AGENT_CHAT_INSERT_REFERENCE_MESSAGE_TYPE,
} from "../agent-chat.js";
import { tryDelegateBuildRequestToBuilder } from "../builder-frame.js";
import { isTrustedBuilderMessage } from "../builder-frame.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { isTrustedFrameMessage } from "../frame.js";
import { useBuilderConnectFlow } from "../settings/useBuilderStatus.js";
import { ComposerPlusMenu } from "./ComposerPlusMenu.js";
import { getComposerDraftKey } from "./draft-key.js";
import { FileReference } from "./extensions/FileReference.js";
import { MentionReference } from "./extensions/MentionReference.js";
import { SkillReference } from "./extensions/SkillReference.js";
import { MentionPopover, type MentionPopoverRef } from "./MentionPopover.js";
import {
  createPastedAttachmentFile,
  readClipboardPaste,
  shouldConvertClipboardToAttachment,
} from "./pasted-text.js";
import type {
  MentionItem,
  SkillResult,
  Reference,
  SlashCommand,
  ComposerMode,
  AgentComposerLayoutVariant,
} from "./types.js";
import { useMentionSearch } from "./use-mention-search.js";
import { useSkills } from "./use-skills.js";
import { RealtimeVoiceModeBoundary } from "./useRealtimeVoiceMode.js";
import { useVoiceDictation } from "./useVoiceDictation.js";
import { VoiceButton, VoiceRecordingOverlay } from "./VoiceButton.js";
export interface TiptapComposerHandle {
  focus(): void;
  setText(text: string): void;
  insertReference(ref: AgentComposerReference): void;
}

export type ComposerSubmitIntent = "immediate" | "queued";

export const DEFAULT_VOICE_DICTATION_ENABLED = false;

export interface TiptapComposerSubmitOptions {
  intent?: ComposerSubmitIntent;
}

export function canSubmitComposerContent(options: {
  hasEditorContent: boolean;
  attachmentCount: number;
  disabled?: boolean;
}): boolean {
  return (
    !options.disabled &&
    (options.hasEditorContent || options.attachmentCount > 0)
  );
}

export function resolveComposerPrimaryAction(options: {
  canSubmit: boolean;
  hasStopButton: boolean;
}): "send" | "stop" {
  return !options.canSubmit && options.hasStopButton ? "stop" : "send";
}

export type ContextChipBackspaceAction =
  | { type: "select"; key: string }
  | { type: "remove"; key: string }
  | null;

export function resolveContextChipBackspaceAction(options: {
  contextItemKeys: string[];
  selectedKey: string | null;
  cursorAtStart: boolean;
}): ContextChipBackspaceAction {
  if (!options.cursorAtStart || options.contextItemKeys.length === 0) {
    return null;
  }
  if (
    options.selectedKey &&
    options.contextItemKeys.includes(options.selectedKey)
  ) {
    return { type: "remove", key: options.selectedKey };
  }
  return {
    type: "select",
    key: options.contextItemKeys[options.contextItemKeys.length - 1],
  };
}

const MAX_DOCUMENT_ATTACHMENT_BYTES = 4 * 1024 * 1024;

function composerReferenceFromMentionItem(
  item: MentionItem,
): AgentComposerReference {
  return {
    label: item.label,
    icon: item.icon || "file",
    source: item.source,
    refType: item.refType,
    refId: item.refId || null,
    refPath: item.refPath || null,
    slotKey: item.slotKey,
    slotLabel: item.slotLabel,
    metadata: item.metadata,
    clearsSlots: item.clearsSlots,
    relatedReferences: item.relatedReferences,
  };
}

function mentionReferenceAttrs(ref: AgentComposerReference) {
  return {
    label: ref.label,
    icon: ref.icon || "file",
    source: ref.source,
    refType: ref.refType,
    refId: ref.refId || null,
    refPath: ref.refPath || null,
    slotKey: ref.slotKey || null,
    slotLabel: ref.slotLabel || null,
    metadata: ref.metadata || null,
  };
}

function referenceFromComposerReference(
  ref: AgentComposerReference,
): Reference {
  return {
    type:
      ref.refType === "file"
        ? "file"
        : ref.refType === "agent"
          ? "agent"
          : ref.refType === "custom-agent"
            ? "custom-agent"
            : "mention",
    path: ref.refPath || "",
    name: ref.label,
    source: ref.source || "",
    refType: ref.refType,
    refId: ref.refId || undefined,
    slotKey: ref.slotKey,
    slotLabel: ref.slotLabel,
    metadata: ref.metadata,
  };
}

function applySlotReferenceChanges(
  current: AgentComposerReference[],
  references: AgentComposerReference[],
): AgentComposerReference[] {
  let next = current;

  const applyOne = (ref: AgentComposerReference) => {
    for (const related of ref.relatedReferences ?? []) {
      applyOne(related);
    }
    if (!ref.slotKey) return;
    const cleared = new Set([ref.slotKey, ...(ref.clearsSlots ?? [])]);
    next = next.filter((existing) => !cleared.has(existing.slotKey ?? ""));
    next = [...next, ref];
  };

  for (const ref of references) {
    applyOne(ref);
  }

  return next;
}

function removeSlotReference(
  current: AgentComposerReference[],
  ref: AgentComposerReference,
): AgentComposerReference[] {
  const removed = new Set([ref.slotKey, ...(ref.clearsSlots ?? [])]);
  return current.filter((existing) => !removed.has(existing.slotKey ?? ""));
}

function slotReferenceTitle(ref: AgentComposerReference): string {
  return ref.slotLabel ? `${ref.slotLabel}: ${ref.label}` : ref.label;
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function trimVoiceContextValue(value: string, maxChars: number): string | null {
  const trimmed = value.replace(/\0/g, "").trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}\n[truncated]`;
}

function filterMentionItemsForSlots(
  items: MentionItem[],
  slotReferences: AgentComposerReference[],
): MentionItem[] {
  return items.filter((item) => {
    const requiredSlotKey = metadataString(item.metadata, "requiredSlotKey");
    const requiredRefId = metadataString(item.metadata, "requiredRefId");
    if (!requiredSlotKey || !requiredRefId) return true;
    const selected = slotReferences.find(
      (ref) => ref.slotKey === requiredSlotKey,
    );
    if (!selected?.refId) return true;
    return selected.refId === requiredRefId;
  });
}

function isDocumentAttachment(value: Record<string, unknown>): boolean {
  if (value.type === "document") return true;
  const contentType = String(value.contentType ?? "").toLowerCase();
  const name = String(value.name ?? "").toLowerCase();
  return contentType === "application/pdf" || name.endsWith(".pdf");
}

export function getOversizedDocumentAttachmentError(
  attachments: ReadonlyArray<unknown>,
): string | null {
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object") continue;
    const candidate = attachment as Record<string, unknown>;
    if (!isDocumentAttachment(candidate)) continue;
    const file = candidate.file;
    if (!(file instanceof File)) continue;
    if (file.size <= MAX_DOCUMENT_ATTACHMENT_BYTES) continue;
    const name =
      typeof candidate.name === "string" && candidate.name.trim()
        ? candidate.name
        : file.name;
    const mb = (file.size / 1024 / 1024).toFixed(1);
    const maxMb = (MAX_DOCUMENT_ATTACHMENT_BYTES / 1024 / 1024).toFixed(0);
    return `"${name}" is ${mb} MB — PDFs are capped at ${maxMb} MB to stay within message limits. Please reduce the file size or split it into smaller parts.`;
  }
  return null;
}

export function getComposerSubmitIntentForEnterKey(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "metaKey" | "ctrlKey">,
  isMac: boolean,
): ComposerSubmitIntent | null {
  if (event.key !== "Enter" || event.shiftKey) return null;

  const queuedModifierPressed = isMac ? event.metaKey : event.ctrlKey;
  if (queuedModifierPressed) return "queued";

  if (!event.metaKey && !event.ctrlKey) return "immediate";

  return null;
}

export function insertComposerHardBreakAndScrollIntoView(
  view: Pick<EditorView, "state" | "dispatch">,
): boolean {
  const hardBreak = view.state.schema.nodes.hardBreak;
  if (!hardBreak) return false;

  view.dispatch(
    view.state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView(),
  );
  return true;
}

export function getComposerPopoverPosition(
  view: Pick<EditorView, "coordsAtPos">,
  pos: number,
): { top: number; left: number } | null {
  try {
    const coords = view.coordsAtPos(pos);
    if (!Number.isFinite(coords.top) || !Number.isFinite(coords.left)) {
      return null;
    }
    return { top: coords.top, left: coords.left };
  } catch {
    return null;
  }
}

export function displayableComposerModeMessage(options: {
  messagePrefix: string;
  trimmedText: string;
  attachmentCount: number;
}): string {
  const modePrompt =
    options.trimmedText ||
    (options.attachmentCount > 0 ? "Use the attached context." : "");
  return `${options.messagePrefix}${modePrompt}`;
}

function uniquifyComposerImageFile(file: File): File {
  if (!file.type.startsWith("image/")) return file;
  const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`;
  return new File([file], uniqueName, { type: file.type });
}

function composerDocumentHasContent(doc: {
  textContent: string;
  descendants: (callback: (node: any) => boolean | void) => void;
}): boolean {
  if (doc.textContent.trim().length > 0) return true;
  let hasContent = false;
  doc.descendants((node: any) => {
    if (
      node.type.name === "mentionReference" ||
      node.type.name === "fileReference" ||
      node.type.name === "skillReference"
    ) {
      hasContent = true;
      return false;
    }
    return true;
  });
  return hasContent;
}

export function handleComposerFileDrop(options: {
  event: Pick<DragEvent, "dataTransfer" | "preventDefault" | "stopPropagation">;
  addAttachment: (file: File) => Promise<unknown>;
  onError?: (error: unknown) => void;
}): boolean {
  const droppedFiles = Array.from(options.event.dataTransfer?.files ?? []);
  if (droppedFiles.length === 0) return false;

  options.event.preventDefault();
  options.event.stopPropagation();
  const attachments = droppedFiles.map(uniquifyComposerImageFile);
  void Promise.all(
    attachments.map((file) => options.addAttachment(file)),
  ).catch((error) => {
    options.onError?.(error);
  });
  return true;
}

const BUILT_IN_COMMANDS: SlashCommand[] = [
  { name: "clear", description: "Start a new chat", icon: "clear" },
  { name: "new", description: "Start a new chat", icon: "new" },
  { name: "history", description: "Browse all chats", icon: "history" },
  { name: "plan", description: "Switch to read-only planning", icon: "plan" },
  { name: "act", description: "Switch back to acting", icon: "act" },
  { name: "help", description: "Show available commands", icon: "help" },
];

function normalizeSlashCommandName(name: string): string {
  return name.replace(/^\/+/, "").trim().toLowerCase();
}

function mergeSlashCommands(commands: SlashCommand[]): SlashCommand[] {
  const seen = new Set<string>();
  const merged: SlashCommand[] = [];
  for (const command of commands) {
    const name = normalizeSlashCommandName(command.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    merged.push({ ...command, name });
  }
  return merged;
}

function mergeSlashSkills(skills: SkillResult[]): SkillResult[] {
  const seen = new Set<string>();
  const merged: SkillResult[] = [];
  for (const skill of skills) {
    const key = `${skill.source ?? ""}:${skill.path ?? ""}:${skill.name}`;
    if (!skill.name || seen.has(key)) continue;
    seen.add(key);
    merged.push(skill);
  }
  return merged;
}

const COMPOSER_MODE_CONFIGS: Record<
  ComposerMode,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    placeholder: string;
    messagePrefix: string;
    getContext: (prompt: string) => string;
    beforeSend?: () => void;
  }
> = {
  skill: {
    label: "Create Skill",
    icon: IconBulb,
    placeholder: "Describe the skill you want to create...",
    messagePrefix: "Create a skill: ",
    getContext: (prompt) =>
      `The user wants to create an agent skill. Their description: "${prompt}"

Follow the create-skill pattern to build this. Before writing:

1. **Determine the skill name** — derive a hyphen-case name from the description (e.g. "code review" → "code-review")
2. **Determine the skill type** — Pattern (architectural rule), Workflow (step-by-step), or Generator (scaffolding)
3. **Write the skill** as a personal resource at path "skills/<name>/SKILL.md" using the \`resources\` tool with \`action: "write"\`

The skill file MUST have YAML frontmatter with name and description (under 40 words), then markdown with:
- Clear rule/purpose statement
- Why this skill exists
- How to follow it (with code examples where helpful)
- Common violations to avoid
- Related skills

After creating, update the shared AGENTS.md resource to reference the new skill in its skills table.

Keep the skill concise (under 500 lines) and actionable.`,
  },
  job: {
    label: "Schedule Task",
    icon: IconClock,
    placeholder: "Describe what should happen and when...",
    messagePrefix: "Create a recurring job: ",
    getContext: (prompt) =>
      `The user wants to create a recurring job. Their description: "${prompt}"

Use the manage-jobs tool with action "create" to create this. You need to:
1. Derive a hyphen-case name from the description
2. Convert the schedule to a cron expression (e.g., "every weekday at 9am" → "0 9 * * 1-5")
3. Write clear, self-contained instructions for what the agent should do each time the job runs
4. Create it in personal scope

The job will run automatically on the schedule. Make the instructions specific — include which actions to call and what to do with results.`,
  },
  automation: {
    label: "Create Automation",
    icon: IconBolt,
    placeholder: "Describe what you want to automate...",
    messagePrefix: "Create an automation: ",
    beforeSend: () => {
      window.dispatchEvent(
        new CustomEvent("agent-panel:set-mode", {
          detail: { mode: "chat" },
        }),
      );
    },
    getContext: (prompt) =>
      `The user wants to create a new automation. Scope: personal. Their description: "${prompt}"

Use manage-automations with action=define to create it. Ask clarifying questions if needed about what event to trigger on, conditions, and what actions to take.`,
  },
  extension: {
    label: "Create Extension",
    icon: IconTool,
    placeholder: "Describe the interactive extension you want to build...",
    messagePrefix: "Create an extension: ",
    getContext: (prompt) =>
      `The user wants to create an interactive extension (sandboxed mini-app). Their description: "${prompt}"

Use the create-extension action with Alpine.js HTML content. The extension runs as a sandboxed iframe with Tailwind CSS and modest default canvas padding. For edge-to-edge layouts, put data-extension-layout="full-bleed" on the outermost element.

After creating the extension, navigate the user to it with the path returned by create-extension; extension URLs may include a friendly "/extensions/<id>/<slug>" suffix.

Make the extension functional and visually polished. Extensions can use extensionFetch() for external API calls, appAction()/appFetch() for app operations and app data writes, extensionData for per-extension persistence, and dbQuery() only for read-only inspection of existing app tables.

Prefer appAction()/appFetch() for app data. Some actions return JSON strings for CLI compatibility, so parse string results before counting rows or reading arrays. Do not guess raw SQL table names or columns for app data; use dbQuery() only when the table is known to exist in the current schema.`,
  },
};

function ComposerModeChip({
  mode,
  onRemove,
}: {
  mode: ComposerMode;
  onRemove: () => void;
}) {
  const config = COMPOSER_MODE_CONFIGS[mode];
  const Icon = config.icon;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-xs font-medium text-foreground">
      <Icon className="h-3 w-3 text-muted-foreground" />
      {config.label}
      <button
        type="button"
        onClick={onRemove}
        className="ms-0.5 rounded-sm text-muted-foreground hover:text-foreground cursor-pointer"
      >
        <IconX className="h-3 w-3" />
      </button>
    </span>
  );
}

type ExecMode = "build" | "plan";

export interface TiptapComposerProps {
  placeholder?: string;
  disabled?: boolean;
  focusRef?: React.Ref<TiptapComposerHandle>;
  /** Programmatically seed the editor with plain text. */
  initialText?: string;
  /** Stable key used to re-apply the seeded text. */
  initialTextKey?: string | number;
  /**
   * When provided, called instead of composerRuntime.send(). Used for queue
   * mode and standalone prompt popovers. Receives the live composer
   * attachments so callers (e.g. PromptComposer) can surface uploaded files.
   */
  onSubmit?: (
    text: string,
    references: Reference[],
    attachments?: ReadonlyArray<unknown>,
    options?: TiptapComposerSubmitOptions,
  ) => void;
  /** Return false to stop a submit before it enters the chat runtime. */
  onBeforeSubmit?: () => boolean | Promise<boolean>;
  /**
   * Clear the editor after an onSubmit handler runs. Standalone workflows that
   * may fail outside the composer can keep the draft visible for quick edits.
   */
  clearOnSubmit?: boolean;
  /** Called whenever the plain editor text changes. */
  onTextChange?: (text: string) => void;
  /** Custom action button (e.g. stop button) to render instead of the default send button. */
  actionButton?: React.ReactNode;
  /** Extra button to render alongside the primary action. */
  extraActionButton?: React.ReactNode;
  /**
   * Stop control shown instead of the disabled send button while the composer
   * has no sendable content. Typing or attaching content restores send.
   */
  stopButton?: React.ReactNode;
  /** Custom attachment button to render instead of ComposerPrimitive.AddAttachment. */
  attachButton?: React.ReactNode;
  /** Custom host-owned control rendered next to the attachment affordance. */
  modeControl?: React.ReactNode;
  /** Explicit host-owned toolbar slot rendered next to the attachment affordance. */
  toolbarSlot?: React.ReactNode;
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
  /** Called when a slash command (e.g. /clear, /help) is executed */
  onSlashCommand?: (command: string) => void;
  /** Current execution mode (build/plan) */
  execMode?: ExecMode;
  /** Callback to change execution mode */
  onExecModeChange?: (mode: ExecMode) => void;
  /** Disable Plan mode while leaving Act mode available. */
  planModeDisabled?: boolean;
  /** Explanation shown next to the disabled Plan option. */
  planModeDisabledReason?: string;
  /** Show the microphone button for voice dictation. Defaults to DEFAULT_VOICE_DICTATION_ENABLED. */
  voiceEnabled?: boolean;
  /** Selected model override for this conversation */
  selectedModel?: string;
  /** Selected reasoning effort override for this conversation */
  selectedEffort?: ReasoningEffort;
  /** Available models grouped by provider */
  availableModels?: Array<{
    engine: string;
    label: string;
    models: string[];
    configured: boolean;
  }>;
  /** Callback when user picks a model */
  onModelChange?: (model: string, engine: string) => void;
  /** Callback when user picks a reasoning effort */
  onEffortChange?: (effort: ReasoningEffort) => void;
  /**
   * Disable Builder/provider status polling for hosts that supply provider
   * state through another channel, such as Electron IPC.
   */
  providerConnectStatusEnabled?: boolean;
  /**
   * Override the Builder.io connect action in the model picker. When provided,
   * clicking "Connect Builder.io" calls this instead of opening a browser popup.
   * Used by the Electron desktop app to route through the native IPC handler.
   */
  onConnectProvider?: () => void;
  /**
   * Optional secondary model menu (e.g. an image-generation model) rendered as
   * an extra section inside the model picker. Opt-in; omit for chat-only apps.
   */
  imageModelMenu?: ComposerImageModelMenu;
  /** Stable scope for persisted drafts, usually the active thread or tab id. */
  draftScope?: string;
  /** Keyed context nuggets staged for the next submitted prompt. */
  contextItems?: AgentChatContextItem[];
  /** Remove a staged context nugget by key. */
  onRemoveContextItem?: (key: string) => void;
  /**
   * Controls the "+" menu next to the composer. `"full"` (default) shows the
   * normal Upload / Skill / Job / Automation / Tool / MCP picker. `"upload-only"`
   * collapses it to a single button that opens the file picker directly.
   * `"hidden"` hides attachment controls for text-only prompt surfaces.
   */
  plusMenuMode?: "full" | "upload-only" | "hidden";
  /**
   * When true and the composer is running inside the Builder.io webview/iframe,
   * intercept "build me an app/agent" prompts and forward them to the parent
   * Builder chat via `builder.submitChat` instead of sending to the local
   * agent. Off by default — the chat sidebar opts in; standalone prompt
   * forms (NewWorkspaceAppFlow, etc.) handle delegation themselves with
   * extra context (vault keys, computed app ids) that the raw composer
   * text lacks.
   */
  interceptBuildRequestsForBuilder?: boolean;
  /**
   * Called when a drag-drop or paste attachment fails (e.g. unsupported format,
   * size cap). Use this to surface a visible error in the parent chat surface
   * rather than silently swallowing the problem.
   */
  onAttachmentError?: (message: string) => void;
}

function plainTextToDoc(text: string) {
  const lines = text.length > 0 ? text.split(/\r?\n/) : [""];
  return {
    type: "doc",
    content: lines.map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}

/** Tiptap keeps the Editor object truthy after destroy but clears commandManager. */
export function isComposerEditorUsable<T extends { isDestroyed?: boolean }>(
  editor: T | null | undefined,
): editor is T {
  return Boolean(editor && editor.isDestroyed !== true);
}

export function createTiptapComposerExtensions(
  getPlaceholder: () => string | undefined,
) {
  return [
    StarterKit.configure({
      heading: false,
      horizontalRule: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      blockquote: false,
      codeBlock: false,
      strike: false,
      italic: false,
      bold: false,
      code: false,
      dropcursor: false,
      gapcursor: false,
      link: false,
      trailingNode: false,
      underline: false,
    }),
    Placeholder.configure({
      placeholder: () => getPlaceholder() ?? "",
      emptyEditorClass: "is-editor-empty",
      showOnlyCurrent: false,
    }),
    FileReference,
    SkillReference,
    MentionReference,
  ];
}

function ModeSelector({
  mode,
  onChange,
  planModeDisabled = false,
  planModeDisabledReason = "Open Agent Native Desktop to use Plan mode.",
}: {
  mode: ExecMode;
  onChange: (mode: ExecMode) => void;
  planModeDisabled?: boolean;
  planModeDisabledReason?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={mode === "build" ? "Act mode" : "Plan mode"}
          data-agent-composer-slot="mode-button"
          className="agent-composer-mode-button shrink-0 flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          {mode === "build" ? "Act" : "Plan"}
          <IconChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={6}
        collisionPadding={8}
        data-agent-native-composer-popover="true"
        className="z-[260] w-60 rounded-lg border-border p-0 py-1 shadow-lg"
        style={{ fontSize: 13 }}
      >
        <button
          type="button"
          onClick={() => {
            onChange("build");
            setOpen(false);
          }}
          className="flex w-full items-center gap-3 px-3 py-2 hover:bg-accent/50 text-start"
        >
          <IconPencil className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <span className="font-medium text-foreground text-[13px]">Act</span>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Use tools and make approved changes
            </p>
          </div>
          {mode === "build" && (
            <IconCheck className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          )}
        </button>
        <button
          type="button"
          disabled={planModeDisabled}
          title={planModeDisabled ? planModeDisabledReason : undefined}
          onClick={() => {
            if (planModeDisabled) return;
            onChange("plan");
            setOpen(false);
          }}
          className={`flex w-full items-center gap-3 px-3 py-2 text-start ${
            planModeDisabled
              ? "cursor-not-allowed opacity-60"
              : "hover:bg-accent/50"
          }`}
        >
          <IconClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <span className="font-medium text-foreground text-[13px]">
              Plan
            </span>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {planModeDisabled
                ? planModeDisabledReason
                : "Read-only research and approval first"}
            </p>
          </div>
          {mode === "plan" && !planModeDisabled && (
            <IconCheck className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          )}
        </button>
      </PopoverContent>
    </Popover>
  );
}

const FRIENDLY_MODEL_NAMES: Record<string, string> = {
  auto: "Default model",
  "claude-fable-5": "Fable 5",
  "kimi-k2-5": "Kimi K2.5",
  "deepseek-v3-1": "DeepSeek v3.1",
  "z-ai/glm-5.2": "GLM 5.2",
};

export const MODEL_SELECTOR_POPOVER_STYLE = {
  fontSize: 13,
  maxHeight: "min(500px, var(--radix-popover-content-available-height, 500px))",
} satisfies React.CSSProperties;

function friendlyModelName(model: string): string {
  if (FRIENDLY_MODEL_NAMES[model]) return FRIENDLY_MODEL_NAMES[model];
  // Claude: claude-{tier}-{major}[-minor][-dateYYYYMMDD] → Tier Major[.Minor]
  const claude = model.match(
    /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?(?:-\d{8,})?$/,
  );
  if (claude) {
    const tier = claude[1][0].toUpperCase() + claude[1].slice(1);
    return `${tier} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`;
  }
  // GPT: gpt-{major}-{minor}[-suffix] or gpt-{major}.{minor}[-suffix]
  if (model.startsWith("gpt-")) {
    const rest = model.slice(4);
    const gpt = rest.match(/^(\d+)[.-](\d+)(?:[.-](.+))?$/);
    if (gpt) {
      const suffix = gpt[3]
        ? " " +
          gpt[3]
            .split("-")
            .map((s) => s[0].toUpperCase() + s.slice(1))
            .join(" ")
        : "";
      return `GPT-${gpt[1]}.${gpt[2]}${suffix}`;
    }
    return `GPT-${rest}`;
  }
  if (/^o\d/.test(model)) return model;
  // Gemini: gemini-{major}-{minor}-{variant}[-preview] → Gemini Major.Minor Variant
  const geminiVersioned = model.match(
    /^gemini-(\d+)-(\d+)-(.+?)(?:-preview)?$/,
  );
  if (geminiVersioned) {
    const variant = geminiVersioned[3]
      .split("-")
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join(" ");
    return `Gemini ${geminiVersioned[1]}.${geminiVersioned[2]} ${variant}`;
  }
  // Gemini: gemini-{version.parts}[-preview] → Gemini Version Parts
  const gemini = model.match(/^gemini-(.+?)(?:-preview)?$/);
  if (gemini) {
    const parts = gemini[1]
      .split("-")
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join(" ");
    return `Gemini ${parts}`;
  }
  return model;
}

export function compactComposerModelName(model: string): string {
  const gpt56Variant = model.match(
    /^(?:openai\/)?gpt-5[.-]6[.-](sol|terra|luna)$/i,
  )?.[1];
  if (gpt56Variant) {
    return gpt56Variant[0].toUpperCase() + gpt56Variant.slice(1).toLowerCase();
  }
  return friendlyModelName(model);
}

export function compactComposerReasoningEffortLabel(
  effort: ReasoningEffort,
): string {
  if (effort === "medium" || effort === "auto") return "Med";
  if (effort === "minimal") return "Min";
  if (effort === "xhigh") return "XHigh";
  return reasoningEffortLabel(effort);
}

/**
 * Deduplicate models to only the latest version per family.
 * e.g. [opus-4-7, opus-4-6, opus-4-5] → [opus-4-7]
 */
function latestModelsOnly(models: string[]): string[] {
  const seen = new Set<string>();
  return models.filter((m) => {
    // Claude: family = tier (opus/sonnet/haiku)
    const claude = m.match(/^claude-(opus|sonnet|haiku)-/);
    if (claude) {
      if (seen.has(claude[1])) return false;
      seen.add(claude[1]);
      return true;
    }
    // GPT: family = gpt-{major} (e.g. gpt-5.6-sol and gpt-5.6-luna are different)
    // OpenAI reasoning: each is its own family
    // Gemini: family = gemini-{major} + variant
    const gemini = m.match(/^gemini-(\d+(?:\.\d+)?)-(.+?)(?:-preview)?$/);
    if (gemini) {
      const family = gemini[2]; // flash, pro, etc.
      if (seen.has(`gemini-${family}`)) return false;
      seen.add(`gemini-${family}`);
      return true;
    }
    return true;
  });
}

/**
 * Optional secondary model menu for apps that drive a separate generation model
 * alongside the chat LLM (e.g. the Assets app's image-generation model). When
 * provided, the model picker renders an extra collapsible section so the user
 * can see and pick both "what reasons about my request" (the chat model) and
 * "what produces the output" (this model). Opt-in — omit it and nothing changes.
 */
export interface ComposerImageModelMenu {
  /** Currently-selected model id for this secondary menu. */
  value: string;
  /** Selectable options (stable id + human label). */
  options: Array<{ value: string; label: string }>;
  /** Invoked when the user picks a different option. */
  onChange: (value: string) => void;
  /** Section header. Defaults to "Image model". */
  label?: string;
}

export function getComposerReasoningEffortOptions(
  model: string,
): ReasoningEffort[] {
  return model === "auto"
    ? ["low", "medium", "high", "xhigh", "max"]
    : getReasoningEffortOptionsForModel(model);
}

function ModelSelector({
  model,
  effort = DEFAULT_REASONING_EFFORT,
  engines,
  onChange,
  onEffortChange,
  providerConnectStatusEnabled = true,
  onConnectProvider,
  imageModel,
}: {
  model: string;
  effort?: ReasoningEffort;
  engines: Array<{
    engine: string;
    label: string;
    models: string[];
    configured: boolean;
  }>;
  onChange: (model: string, engine: string) => void;
  onEffortChange?: (effort: ReasoningEffort) => void;
  providerConnectStatusEnabled?: boolean;
  onConnectProvider?: () => void;
  imageModel?: ComposerImageModelMenu;
}) {
  const [open, setOpen] = useState(false);
  const autoModelGroup = engines.find((group) => group.models.includes("auto"));
  const providerGroups = useMemo(
    () =>
      engines
        .map((group) => ({
          ...group,
          models: group.models.filter((candidate) => candidate !== "auto"),
        }))
        .filter((group) => group.models.length > 0),
    [engines],
  );
  const effortOptions = getComposerReasoningEffortOptions(model);
  const selectedEffort = resolveReasoningEffortSelection(model, effort);

  // Collapse non-selected families by default. The family containing the
  // currently-selected model stays expanded so the user sees their pick at
  // a glance; clicking another family's header expands it inline.
  const selectedGroupKey = useMemo(() => {
    const found = providerGroups.find((g) => g.models.includes(model));
    return found ? `${found.engine}:${found.label}` : null;
  }, [model, providerGroups]);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(selectedGroupKey ? [selectedGroupKey] : []),
  );

  // Reset expansion when the popover re-opens so the picker always lands
  // on the "selected family expanded, others collapsed" view.
  useEffect(() => {
    if (open) {
      setExpandedGroups(new Set(selectedGroupKey ? [selectedGroupKey] : []));
    }
  }, [open, selectedGroupKey]);

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // The reasoning effort list is collapsed by default — it's a secondary
  // control most users don't touch, so it stays tucked behind a header that
  // reveals the current effort at a glance. Reset to collapsed on each open.
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  useEffect(() => {
    if (open) setReasoningExpanded(false);
  }, [open]);

  // The optional image-model section follows the same collapsed-by-default
  // pattern; the current selection shows next to the header.
  const [imageExpanded, setImageExpanded] = useState(false);
  useEffect(() => {
    if (open) setImageExpanded(false);
  }, [open]);
  const imageModelLabel =
    imageModel?.options.find((option) => option.value === imageModel.value)
      ?.label ?? imageModel?.value;

  // When Builder.io isn't connected, surface a one-click connect path —
  // it unlocks every model family (Claude, OpenAI, Gemini) without the
  // user having to paste individual API keys.
  const builderFlow = useBuilderConnectFlow({
    enabled: providerConnectStatusEnabled,
    trackingSource: "composer_builder_cta",
  });
  const hasConfiguredBuilderModels = providerGroups.some(
    (group) => group.engine === "builder" && group.configured,
  );
  const showBuilderCta =
    (builderFlow.hasFetchedStatus ||
      (!providerConnectStatusEnabled && !!onConnectProvider)) &&
    !builderFlow.configured &&
    !builderFlow.envManaged &&
    !hasConfiguredBuilderModels;
  const openLlmSettings = useCallback(() => {
    try {
      window.location.hash = "llm";
    } catch {}
    window.dispatchEvent(new CustomEvent("agent-panel:open-settings"));
    setOpen(false);
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-agent-composer-slot="model-button"
          aria-label={`Model: ${friendlyModelName(model)}${
            effortOptions.length > 0
              ? `. Reasoning: ${reasoningEffortLabel(selectedEffort)}`
              : ""
          }`}
          className="agent-composer-model-button flex min-w-0 max-w-[10.5rem] shrink items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          <span className="min-w-0 truncate">
            {compactComposerModelName(model)}
          </span>
          {effortOptions.length > 0 && (
            <span className="agent-composer-model-effort min-w-0 shrink truncate text-muted-foreground/70">
              · {compactComposerReasoningEffortLabel(selectedEffort)}
            </span>
          )}
          <IconChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={6}
        collisionPadding={8}
        data-agent-native-composer-popover="true"
        className="z-[260] box-border w-72 overflow-y-auto rounded-lg border-border p-0 py-1 shadow-lg"
        style={MODEL_SELECTOR_POPOVER_STYLE}
      >
        {showBuilderCta && (
          <>
            <button
              type="button"
              onClick={() => {
                if (onConnectProvider) {
                  onConnectProvider();
                } else {
                  builderFlow.start();
                }
              }}
              disabled={!onConnectProvider && builderFlow.connecting}
              className="flex w-full items-start gap-2 px-3 py-2 text-start hover:bg-accent/50 disabled:opacity-60"
            >
              <IconPlugConnected className="h-4 w-4 shrink-0 mt-0.5 text-blue-500" />
              <span className="flex-1 min-w-0">
                <span className="block text-[12px] font-medium text-foreground">
                  {!onConnectProvider && builderFlow.connecting
                    ? "Connecting Builder.io…"
                    : "Connect Builder.io"}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  Free credits for Claude, OpenAI &amp; Gemini
                </span>
              </span>
            </button>
            <div className="my-1 border-t border-border" />
          </>
        )}
        {imageModel && imageModel.options.length > 0 && (
          <>
            <div className="flex items-center hover:bg-accent/30">
              <button
                type="button"
                aria-expanded={imageExpanded}
                onClick={() => setImageExpanded((prev) => !prev)}
                className="flex flex-1 min-w-0 items-center gap-1.5 px-2 py-1.5 cursor-pointer text-start"
              >
                {imageExpanded ? (
                  <IconChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                ) : (
                  <IconChevronRight className="h-3 w-3 shrink-0 text-muted-foreground rtl:-scale-x-100" />
                )}
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide shrink-0">
                  {imageModel.label ?? "Image model"}
                </span>
                {!imageExpanded && imageModelLabel && (
                  <span className="text-[11px] text-muted-foreground/80 truncate">
                    {imageModelLabel}
                  </span>
                )}
              </button>
            </div>
            {imageExpanded &&
              imageModel.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    imageModel.onChange(option.value);
                    setImageExpanded(false);
                  }}
                  className="flex w-full items-center gap-3 ps-7 pe-3 py-1.5 text-start hover:bg-accent/50"
                >
                  <span className="flex-1 min-w-0 text-[13px] text-foreground truncate">
                    {option.label}
                  </span>
                  {option.value === imageModel.value && (
                    <IconCheck className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                  )}
                </button>
              ))}
            <div className="my-1 border-t border-border" />
          </>
        )}
        {autoModelGroup && (
          <button
            type="button"
            onClick={() => {
              onChange("auto", autoModelGroup.engine);
              setOpen(false);
            }}
            className="flex w-full items-center gap-3 px-3 py-1.5 text-start hover:bg-accent/50"
          >
            <span className="flex-1 min-w-0 text-[13px] text-foreground truncate">
              Auto
            </span>
            {model === "auto" && (
              <IconCheck className="h-3.5 w-3.5 shrink-0 text-blue-500" />
            )}
          </button>
        )}
        {autoModelGroup && providerGroups.length > 0 && (
          <div className="my-1 border-t border-border" />
        )}
        {providerGroups.map((group) => {
          const models = latestModelsOnly(group.models);
          const groupKey = `${group.engine}:${group.label}`;
          const isExpanded = expandedGroups.has(groupKey);
          const ChevronIcon = isExpanded ? IconChevronDown : IconChevronRight;
          return (
            <div key={groupKey}>
              <div className="flex items-center hover:bg-accent/30">
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => toggleGroup(groupKey)}
                  className="flex flex-1 min-w-0 items-center gap-1.5 px-2 py-1.5 cursor-pointer text-start"
                >
                  <ChevronIcon className="h-3 w-3 shrink-0 text-muted-foreground rtl:-scale-x-100" />
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide shrink-0">
                    {group.label}
                  </span>
                  {!isExpanded && groupKey === selectedGroupKey && (
                    <span className="text-[11px] text-muted-foreground/80 truncate">
                      {friendlyModelName(model)}
                    </span>
                  )}
                </button>
                {!group.configured && (
                  <button
                    type="button"
                    className="text-[10px] text-muted-foreground/60 hover:text-foreground cursor-pointer pe-3 py-1.5"
                    onClick={openLlmSettings}
                  >
                    needs API key
                  </button>
                )}
              </div>
              {isExpanded &&
                models.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      if (!group.configured) {
                        openLlmSettings();
                        return;
                      }
                      onChange(m, group.engine);
                      const nextOptions = getReasoningEffortOptionsForModel(m);
                      if (
                        nextOptions.length > 0 &&
                        !nextOptions.includes(selectedEffort)
                      ) {
                        onEffortChange?.(DEFAULT_REASONING_EFFORT);
                      }
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 ps-7 pe-3 py-1.5 text-start ${
                      group.configured
                        ? "hover:bg-accent/50"
                        : "opacity-40 cursor-default"
                    }`}
                  >
                    <span className="flex-1 min-w-0 text-[13px] text-foreground truncate">
                      {friendlyModelName(m)}
                    </span>
                    {m === model && group.configured && (
                      <IconCheck className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                    )}
                  </button>
                ))}
            </div>
          );
        })}
        {effortOptions.length > 0 && (
          <>
            <div className="my-1 border-t border-border" />
            <div className="flex items-center hover:bg-accent/30">
              <button
                type="button"
                aria-expanded={reasoningExpanded}
                onClick={() => setReasoningExpanded((prev) => !prev)}
                className="flex flex-1 min-w-0 items-center gap-1.5 px-2 py-1.5 cursor-pointer text-start"
              >
                {reasoningExpanded ? (
                  <IconChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                ) : (
                  <IconChevronRight className="h-3 w-3 shrink-0 text-muted-foreground rtl:-scale-x-100" />
                )}
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide shrink-0">
                  Reasoning
                </span>
                {!reasoningExpanded && (
                  <span className="text-[11px] text-muted-foreground/80 truncate">
                    {reasoningEffortLabel(selectedEffort)}
                  </span>
                )}
              </button>
            </div>
            {reasoningExpanded &&
              effortOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onEffortChange?.(option)}
                  className="flex w-full items-center gap-3 ps-7 pe-3 py-1.5 text-start hover:bg-accent/50"
                >
                  <span className="flex-1 min-w-0 text-[13px] text-foreground truncate">
                    {reasoningEffortLabel(option)}
                  </span>
                  {option === selectedEffort && (
                    <IconCheck className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                  )}
                </button>
              ))}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

type PopoverState = {
  type: "@" | "/";
  position: { top: number; left: number };
  startPos: number;
  query: string;
} | null;

export function TiptapComposer({
  placeholder = "Message agent...",
  disabled = false,
  focusRef,
  initialText,
  initialTextKey,
  onSubmit,
  onBeforeSubmit,
  clearOnSubmit = true,
  onTextChange,
  actionButton,
  extraActionButton,
  stopButton,
  attachButton,
  modeControl,
  toolbarSlot,
  layoutVariant = "default",
  slashCommands = [],
  slashSkills = [],
  includeDefaultSlashCommands = true,
  includeDefaultSlashSkills = true,
  onSlashCommand,
  execMode,
  onExecModeChange,
  planModeDisabled = false,
  planModeDisabledReason,
  voiceEnabled = DEFAULT_VOICE_DICTATION_ENABLED,
  selectedModel,
  selectedEffort,
  availableModels,
  onModelChange,
  onEffortChange,
  providerConnectStatusEnabled,
  onConnectProvider,
  imageModelMenu,
  draftScope,
  contextItems = [],
  onRemoveContextItem,
  plusMenuMode = "full",
  interceptBuildRequestsForBuilder = false,
  onAttachmentError,
}: TiptapComposerProps) {
  const [popover, setPopover] = useState<PopoverState>(null);
  const popoverRef = useRef<MentionPopoverRef>(null);
  const composerRuntime = useComposerRuntime();
  const lastComposerRuntimeSyncRef = useRef<{
    text: string;
    runConfigSignature: string;
  } | null>(null);
  const submitInFlightRef = useRef(false);
  const [editorHasText, setEditorHasText] = useState(false);
  const [slotReferences, setSlotReferences] = useState<
    AgentComposerReference[]
  >([]);
  const [selectedContextItemKey, setSelectedContextItemKey] = useState<
    string | null
  >(null);
  const composerText = useComposer((state) => state.text);
  const composerAttachments = useComposer((state) => state.attachments);
  const canSend = canSubmitComposerContent({
    hasEditorContent: editorHasText || slotReferences.length > 0,
    attachmentCount: composerAttachments.length,
    disabled,
  });
  const primaryAction = resolveComposerPrimaryAction({
    canSubmit: canSend,
    hasStopButton: Boolean(stopButton),
  });
  const hasContextRows = contextItems.length > 0 || slotReferences.length > 0;
  const [composerMode, setComposerMode] = useState<ComposerMode | null>(null);
  const composerModeRef = useRef<ComposerMode | null>(null);
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent);

  // Refs for values accessed in handleKeyDown (ProseMirror doesn't re-bind)
  const popoverStateRef = useRef<PopoverState>(null);
  const onAttachmentErrorRef = useRef(onAttachmentError);
  onAttachmentErrorRef.current = onAttachmentError;
  const execModeRef = useRef(execMode);
  execModeRef.current = execMode;
  const onExecModeChangeRef = useRef(onExecModeChange);
  onExecModeChangeRef.current = onExecModeChange;
  const planModeDisabledRef = useRef(planModeDisabled);
  planModeDisabledRef.current = planModeDisabled;

  const { items: mentionItems, isLoading: mentionsLoading } = useMentionSearch(
    popover?.type === "@" ? popover.query : "",
    popover?.type === "@",
  );
  const filteredMentionItems = useMemo(
    () => filterMentionItemsForSlots(mentionItems, slotReferences),
    [mentionItems, slotReferences],
  );

  const {
    skills,
    hint,
    isLoading: skillsLoading,
  } = useSkills(includeDefaultSlashSkills && popover?.type === "/");

  const allSlashCommands = useMemo(
    () =>
      mergeSlashCommands([
        ...(includeDefaultSlashCommands ? BUILT_IN_COMMANDS : []),
        ...slashCommands,
      ]),
    [includeDefaultSlashCommands, slashCommands],
  );

  const allSlashSkills = useMemo(
    () =>
      mergeSlashSkills([
        ...(includeDefaultSlashSkills ? skills : []),
        ...slashSkills,
      ]),
    [includeDefaultSlashSkills, skills, slashSkills],
  );

  const filteredCommands = useMemo(() => {
    if (!popover || popover.type !== "/") return allSlashCommands;
    const q = popover.query.toLowerCase();
    if (!q) return allSlashCommands;
    return allSlashCommands.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    );
  }, [allSlashCommands, popover]);

  const filteredSkills = useMemo(() => {
    if (!popover || popover.type !== "/") return allSlashSkills;
    const q = popover.query.toLowerCase();
    if (!q) return allSlashSkills;
    return allSlashSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q),
    );
  }, [allSlashSkills, popover]);

  // Keep refs in sync with state
  const mentionItemsRef = useRef(filteredMentionItems);
  mentionItemsRef.current = filteredMentionItems;
  const filteredCommandsRef = useRef(filteredCommands);
  filteredCommandsRef.current = filteredCommands;
  const filteredSkillsRef = useRef(filteredSkills);
  filteredSkillsRef.current = filteredSkills;
  const onSlashCommandRef = useRef(onSlashCommand);
  onSlashCommandRef.current = onSlashCommand;
  const onTextChangeRef = useRef(onTextChange);
  onTextChangeRef.current = onTextChange;
  const contextItemsRef = useRef(contextItems);
  contextItemsRef.current = contextItems;
  const onRemoveContextItemRef = useRef(onRemoveContextItem);
  onRemoveContextItemRef.current = onRemoveContextItem;
  const selectedContextItemKeyRef = useRef<string | null>(null);
  selectedContextItemKeyRef.current = selectedContextItemKey;
  const initialTextKeyRef = useRef<string | number | undefined>(undefined);
  const seenReferenceInsertIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (
      selectedContextItemKey &&
      !contextItems.some((item) => item.key === selectedContextItemKey)
    ) {
      selectedContextItemKeyRef.current = null;
      setSelectedContextItemKey(null);
    }
  }, [contextItems, selectedContextItemKey]);

  const closePopover = useCallback(() => {
    setPopover(null);
    popoverStateRef.current = null;
  }, []);

  // Persist draft to localStorage so hot-reloads don't lose the prompt
  const draftKey = getComposerDraftKey(draftScope);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    return () => {
      clearTimeout(draftTimerRef.current);
    };
  }, []);
  useEffect(() => {
    lastComposerRuntimeSyncRef.current = null;
  }, [composerRuntime]);
  // Tiptap reads extension config once at init; ref keeps runtime prop
  // changes visible to Placeholder's function form.
  const placeholderRef = useRef(placeholder);
  useEffect(() => {
    placeholderRef.current = composerMode
      ? COMPOSER_MODE_CONFIGS[composerMode].placeholder
      : placeholder;
  }, [placeholder, composerMode]);

  const editor = useEditor({
    extensions: createTiptapComposerExtensions(() => placeholderRef.current),
    editable: !disabled,
    onCreate: ({ editor: ed }) => {
      // Restore draft on mount
      try {
        if (initialText !== undefined) {
          ed.commands.setContent(plainTextToDoc(initialText));
          ed.commands.focus("end");
          setEditorHasText(composerDocumentHasContent(ed.state.doc));
          initialTextKeyRef.current = initialTextKey ?? initialText;
        } else {
          const saved = localStorage.getItem(draftKey);
          if (saved) {
            ed.commands.setContent(saved);
            ed.commands.focus("end");
            setEditorHasText(composerDocumentHasContent(ed.state.doc));
          }
        }
        onTextChangeRef.current?.(ed.state.doc.textContent.trim());
      } catch {}
    },
    onUpdate: ({ editor: ed }) => {
      // Drive the send button's enabled state from the actual editor contents;
      // the composer runtime is only synced on submit, so its isEmpty lags.
      setEditorHasText(composerDocumentHasContent(ed.state.doc));
      onTextChangeRef.current?.(ed.state.doc.textContent.trim());

      // Debounce-save draft to localStorage
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = setTimeout(() => {
        try {
          const html = ed.getHTML();
          const isEmpty = !composerDocumentHasContent(ed.state.doc);
          if (isEmpty) {
            localStorage.removeItem(draftKey);
          } else {
            localStorage.setItem(draftKey, html);
          }
        } catch {}
      }, 300);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to } = ed.state.selection;
      if (selectedContextItemKeyRef.current && (from !== to || from > 1)) {
        selectedContextItemKeyRef.current = null;
        setSelectedContextItemKey(null);
      }
    },
    editorProps: {
      attributes: {
        "data-agent-composer-variant": layoutVariant,
        "data-agent-composer-slot": "editor-input",
        class:
          "agent-composer-prosemirror flex-1 resize-none bg-transparent text-sm text-foreground outline-none leading-[1.625rem] min-h-[3.25rem] max-h-[10rem] overflow-y-auto",
      },
      handlePaste: (_view, event) => {
        const paste = readClipboardPaste(event.clipboardData);
        const pastedText = paste.text;
        const files = Array.from(event.clipboardData?.files ?? []).filter(
          (file) => file.type.startsWith("image/"),
        );
        if (files.length > 0) {
          event.preventDefault();
          const attachments: File[] = files.map((file) => {
            // SimpleImageAttachmentAdapter uses file.name as the attachment id.
            // Clipboard images (e.g. screenshots) are typically all named
            // "image.png", so a second paste would replace the first instead of
            // appending. Prepend a unique token so each paste gets a distinct id.
            const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`;
            return new File([file], uniqueName, { type: file.type });
          });

          // Google Docs rich clipboard payloads can contain both embedded
          // image files and the document text. Since handling files means we
          // prevent Tiptap's default paste, preserve any text as its own chip
          // instead of silently dropping the source material.
          if (pastedText.trim()) {
            attachments.push(createPastedAttachmentFile(paste));
          }

          void Promise.all(
            attachments.map((file) => composerRuntime.addAttachment(file)),
          ).catch((error) => {
            const msg =
              error instanceof Error
                ? error.message
                : "Could not attach the pasted image. Try a different format.";
            onAttachmentErrorRef.current?.(msg);
          });
          return true;
        }

        // Page-sized pastes turn into a `Pasted text` attachment chip so the
        // prompt stays readable while normal paragraphs and lists stay inline.
        // When the paste is HTML (e.g. an Alpine.js extension or a document the
        // user wants hosted), it's stored as a real .html attachment so it
        // travels the same rail as uploading that file — the agent reads it
        // verbatim via contentFromAttachment instead of retyping it inline,
        // which cuts off mid-stream on large files and triggers a spin.
        if (shouldConvertClipboardToAttachment(paste)) {
          event.preventDefault();
          void composerRuntime
            .addAttachment(createPastedAttachmentFile(paste))
            .catch((error) => {
              const msg =
                error instanceof Error
                  ? error.message
                  : "Could not attach the pasted text.";
              onAttachmentErrorRef.current?.(msg);
            });
          return true;
        }

        return false;
      },
      handleDrop: (_view, event) => {
        // Drag-and-drop files (decks, images, PDFs, etc.) into the composer.
        // Mark handled drops as consumed so the chat-wide drop target does not
        // add the same file a second time.
        return handleComposerFileDrop({
          event: event as DragEvent,
          addAttachment: (file) => composerRuntime.addAttachment(file),
          onError: (error) => {
            const msg =
              error instanceof Error
                ? error.message
                : "Could not attach the dropped file. Try a different format.";
            onAttachmentErrorRef.current?.(msg);
          },
        });
      },
      handleKeyDown: (view, event) => {
        const pop = popoverStateRef.current;

        // Handle popover keyboard nav
        if (pop) {
          if (event.key === "ArrowUp") {
            event.preventDefault();
            popoverRef.current?.moveUp();
            return true;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            popoverRef.current?.moveDown();
            return true;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const idx = popoverRef.current?.getSelectedIndex() ?? 0;
            const currentCommands = filteredCommandsRef.current;
            const currentSkills = filteredSkillsRef.current;
            if (pop.type === "@") {
              const item = popoverRef.current?.getSelectedMention();
              if (item) selectMention(view, pop, item);
            } else if (pop.type === "/") {
              const cmd = popoverRef.current?.getSelectedCommand();
              if (cmd) {
                executeCommand(view, pop, cmd);
              } else {
                const skillIdx = idx - currentCommands.length;
                if (currentSkills[skillIdx]) {
                  selectSkill(view, pop, currentSkills[skillIdx]);
                }
              }
            }
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            popoverStateRef.current = null;
            setPopover(null);
            return true;
          }
          if (event.key === " " && pop.query === "") {
            popoverStateRef.current = null;
            setPopover(null);
            return false;
          }
        }

        const { from, to } = view.state.selection;
        const cursorAtStart = from === to && from <= 1;
        if (event.key === "Backspace" && onRemoveContextItemRef.current) {
          const chipAction = resolveContextChipBackspaceAction({
            contextItemKeys: contextItemsRef.current.map((item) => item.key),
            selectedKey: selectedContextItemKeyRef.current,
            cursorAtStart,
          });
          if (chipAction) {
            event.preventDefault();
            if (chipAction.type === "select") {
              selectedContextItemKeyRef.current = chipAction.key;
              setSelectedContextItemKey(chipAction.key);
            } else {
              selectedContextItemKeyRef.current = null;
              setSelectedContextItemKey(null);
              contextItemsRef.current = contextItemsRef.current.filter(
                (item) => item.key !== chipAction.key,
              );
              onRemoveContextItemRef.current?.(chipAction.key);
            }
            return true;
          }
        }
        if (selectedContextItemKeyRef.current) {
          selectedContextItemKeyRef.current = null;
          setSelectedContextItemKey(null);
        }

        // Backspace removes composer mode chip when editor is empty
        if (event.key === "Backspace" && composerModeRef.current) {
          if (
            view.state.doc.textContent.trim() === "" &&
            from === to &&
            from <= 1
          ) {
            setComposerMode(null);
            composerModeRef.current = null;
            return true;
          }
        }

        // Keyboard shortcut toggles Act/Plan mode from inside the editor.
        if (event.key === "Tab" && event.shiftKey) {
          event.preventDefault();
          const current = execModeRef.current;
          const cb = onExecModeChangeRef.current;
          if (current && cb) {
            const next = current === "build" ? "plan" : "build";
            if (next !== "plan" || !planModeDisabledRef.current) {
              cb(next);
            }
          }
          return true;
        }

        // Submit on Enter. Shift+Enter inserts a newline and keeps the
        // composer scrolled to the caret.
        // Cmd+Enter on macOS / Ctrl+Enter elsewhere marks the submit queued.
        if (event.key === "Enter" && event.shiftKey) {
          event.preventDefault();
          return insertComposerHardBreakAndScrollIntoView(view);
        }

        const submitIntent = getComposerSubmitIntentForEnterKey(event, isMac);
        if (submitIntent) {
          event.preventDefault();
          void submitComposer(submitIntent);
          return true;
        }

        // Detect @ trigger — only when preceded by start-of-text, space, or newline
        // (not after alphanumeric chars, which would indicate an email address)
        if (event.key === "@") {
          const { from } = view.state.selection;
          const textBefore = view.state.doc.textBetween(
            Math.max(0, from - 1),
            from,
          );
          if (from === 1 || textBefore === "" || /\s/.test(textBefore)) {
            const position = getComposerPopoverPosition(view, from);
            if (!position) return false;
            setTimeout(() => {
              const state: PopoverState = {
                type: "@",
                position,
                startPos: view.state.selection.from,
                query: "",
              };
              popoverStateRef.current = state;
              setPopover(state);
            }, 0);
          }
          return false;
        }

        // Detect / trigger (only at start of line or after whitespace)
        if (event.key === "/") {
          const { from } = view.state.selection;
          const textBefore = view.state.doc.textBetween(
            Math.max(0, from - 1),
            from,
          );
          if (from === 1 || textBefore === "" || /\s/.test(textBefore)) {
            const position = getComposerPopoverPosition(view, from);
            if (!position) return false;
            setTimeout(() => {
              const state: PopoverState = {
                type: "/",
                position,
                startPos: view.state.selection.from,
                query: "",
              };
              popoverStateRef.current = state;
              setPopover(state);
            }, 0);
          }
          return false;
        }

        return false;
      },
    },
  });

  // A tab can stay mounted while becoming the active composer later. Publish
  // its existing draft when the host starts observing it so contextual UI is
  // correct immediately after a tab switch, not only after the next keystroke.
  useEffect(() => {
    if (!isComposerEditorUsable(editor) || !onTextChange) return;
    onTextChange(editor.state.doc.textContent.trim());
  }, [editor, onTextChange]);

  const insertReference = useCallback(
    (ref: AgentComposerReference) => {
      const normalized = normalizeAgentComposerReference(ref);
      const ed = editor;
      if (!normalized || !isComposerEditorUsable(ed)) return;
      if (normalized.slotKey) {
        setSlotReferences((current) =>
          applySlotReferenceChanges(current, [normalized]),
        );
        ed.commands.focus("end");
        return;
      }
      if (normalized.relatedReferences?.some((item) => item.slotKey)) {
        setSlotReferences((current) =>
          applySlotReferenceChanges(
            current,
            normalized.relatedReferences ?? [],
          ),
        );
      }
      ed.chain()
        .focus()
        .insertContent({
          type: "mentionReference",
          attrs: mentionReferenceAttrs(normalized),
        })
        .insertContent(" ")
        .run();
      setEditorHasText(true);
    },
    [editor],
  );

  const insertReferenceIfEmpty = useCallback(
    (payload: AgentComposerReferenceInsertPayload) => {
      const insertMessageId =
        typeof payload.insertMessageId === "string"
          ? payload.insertMessageId
          : "";
      if (insertMessageId) {
        if (seenReferenceInsertIdsRef.current.has(insertMessageId)) return;
        seenReferenceInsertIdsRef.current.add(insertMessageId);
      }
      const ed = editor;
      if (!isComposerEditorUsable(ed) || disabled || composerModeRef.current)
        return;
      const normalized = normalizeAgentComposerReference(payload);
      if (normalized?.slotKey) {
        insertReference(normalized);
        return;
      }
      if (composerAttachments.length > 0) return;
      if (composerDocumentHasContent(ed.state.doc)) return;
      insertReference(payload);
    },
    [composerAttachments.length, disabled, editor, insertReference],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleEvent = (event: Event) => {
      const payload = (event as CustomEvent).detail;
      const normalized = normalizeAgentComposerReference(payload);
      if (!normalized) return;
      insertReferenceIfEmpty({
        ...normalized,
        insertMessageId:
          typeof payload?.insertMessageId === "string"
            ? payload.insertMessageId
            : "",
      });
    };
    const handleMessage = (event: MessageEvent) => {
      if (!isTrustedFrameMessage(event) && !isTrustedBuilderMessage(event)) {
        return;
      }
      if (event.data?.type !== AGENT_CHAT_INSERT_REFERENCE_MESSAGE_TYPE) {
        return;
      }
      const payload = event.data.data;
      const normalized = normalizeAgentComposerReference(payload);
      if (!normalized) return;
      insertReferenceIfEmpty({
        ...normalized,
        insertMessageId:
          typeof payload?.insertMessageId === "string"
            ? payload.insertMessageId
            : "",
      });
    };
    window.addEventListener(AGENT_CHAT_INSERT_REFERENCE_EVENT, handleEvent);
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener(
        AGENT_CHAT_INSERT_REFERENCE_EVENT,
        handleEvent,
      );
      window.removeEventListener("message", handleMessage);
    };
  }, [insertReferenceIfEmpty]);

  useImperativeHandle(focusRef, () => ({
    focus() {
      if (isComposerEditorUsable(editor)) editor.commands.focus("end");
    },
    setText(text: string) {
      if (!isComposerEditorUsable(editor)) return;
      editor.commands.setContent(plainTextToDoc(text));
      editor.commands.focus("end");
      const trimmed = editor.state.doc.textContent.trim();
      setEditorHasText(trimmed.length > 0);
      setSlotReferences([]);
      composerRuntime.setText(trimmed);
      onTextChangeRef.current?.(trimmed);
      try {
        if (trimmed) {
          localStorage.setItem(draftKey, editor.getHTML());
        } else {
          localStorage.removeItem(draftKey);
        }
      } catch {}
    },
    insertReference,
  }));

  const handleSelectMode = useCallback(
    (mode: ComposerMode) => {
      setComposerMode(mode);
      composerModeRef.current = mode;
      setTimeout(() => {
        if (isComposerEditorUsable(editor)) editor.commands.focus("end");
      }, 50);
    },
    [editor],
  );

  // --- Live voice transcription: text appears in the editor as the user speaks ---
  const voiceAnchorRef = useRef<number | null>(null);
  const prevVoiceInsertRef = useRef("");

  const handleLiveUpdate = useCallback(
    (finalText: string, interimText: string) => {
      const ed = editor;
      if (!isComposerEditorUsable(ed)) return;

      if (voiceAnchorRef.current == null) {
        const { from } = ed.state.selection;
        const prevChar =
          from > 1 ? ed.state.doc.textBetween(from - 1, from) : "";
        if (prevChar && !/\s/.test(prevChar)) {
          ed.chain().insertContent(" ").run();
        }
        voiceAnchorRef.current = ed.state.selection.from;
        prevVoiceInsertRef.current = "";
      }

      const anchor = voiceAnchorRef.current;
      const prevLen = prevVoiceInsertRef.current.length;
      const newText = finalText + interimText;

      if (newText === prevVoiceInsertRef.current) return;

      ed.chain()
        .deleteRange({ from: anchor, to: anchor + prevLen })
        .insertContentAt(anchor, newText)
        .run();

      prevVoiceInsertRef.current = newText;
    },
    [editor],
  );

  const insertTranscript = useCallback(
    (text: string) => {
      const ed = editor;
      if (!isComposerEditorUsable(ed)) return;

      const anchor = voiceAnchorRef.current;
      if (anchor != null) {
        const prevLen = prevVoiceInsertRef.current.length;
        if (text) {
          ed.chain()
            .focus()
            .deleteRange({ from: anchor, to: anchor + prevLen })
            .insertContentAt(anchor, text + " ")
            .run();
        } else if (prevLen > 0) {
          ed.chain()
            .deleteRange({ from: anchor, to: anchor + prevLen })
            .run();
        }
        voiceAnchorRef.current = null;
        prevVoiceInsertRef.current = "";
      } else if (text) {
        const { from } = ed.state.selection;
        const prevChar =
          from > 1 ? ed.state.doc.textBetween(from - 1, from) : "";
        const needsLead = prevChar && !/\s/.test(prevChar);
        ed.chain()
          .focus()
          .insertContent((needsLead ? " " : "") + text + " ")
          .run();
      }
    },
    [editor],
  );

  const buildVoiceContextPack = useCallback(():
    | VoiceContextPack
    | undefined => {
    const snippets: Array<{ label: string; value: string }> = [];

    const activeContext = trimVoiceContextValue(
      formatAgentChatContextItemsForPrompt(contextItems),
      3200,
    );
    if (activeContext) {
      snippets.push({ label: "Active app context", value: activeContext });
    }

    const selectedReferences = trimVoiceContextValue(
      slotReferences.map((ref) => slotReferenceTitle(ref)).join(", "),
      1200,
    );
    if (selectedReferences) {
      snippets.push({
        label: "Selected references",
        value: selectedReferences,
      });
    }

    const draft = isComposerEditorUsable(editor)
      ? trimVoiceContextValue(editor.state.doc.textContent, 1200)
      : null;
    if (draft) snippets.push({ label: "Current draft", value: draft });

    if (typeof document !== "undefined") {
      const title = trimVoiceContextValue(document.title, 160);
      if (title) snippets.push({ label: "Page title", value: title });
    }

    if (typeof window !== "undefined") {
      const route = trimVoiceContextValue(window.location.pathname, 240);
      if (route) snippets.push({ label: "Route", value: route });
    }

    if (snippets.length === 0) return undefined;
    return {
      surface: "agent-composer",
      mode: "dictation",
      snippets,
    };
  }, [contextItems, editor, slotReferences]);

  const voice = useVoiceDictation({
    onTranscript: insertTranscript,
    onLiveUpdate: handleLiveUpdate,
    contextPack: buildVoiceContextPack,
  });

  // Clean up live text if voice session ends without a final transcript (cancel/error)
  useEffect(() => {
    if (voice.state === "idle" && voiceAnchorRef.current != null) {
      const anchor = voiceAnchorRef.current;
      const prevLen = prevVoiceInsertRef.current.length;
      if (isComposerEditorUsable(editor) && prevLen > 0) {
        editor
          .chain()
          .deleteRange({ from: anchor, to: anchor + prevLen })
          .run();
      }
      voiceAnchorRef.current = null;
      prevVoiceInsertRef.current = "";
    }
  }, [voice.state, editor]);

  // Global shortcut: Cmd/Ctrl + Shift + M toggles dictation. Escape cancels
  // while recording. Scoped to avoid firing when focus is outside the app.
  useEffect(() => {
    if (!voiceEnabled || !voice.supported) return;
    const handler = (e: KeyboardEvent) => {
      // e.key can be undefined on some trusted keydown events (autofill/IME
      // quirks) — seen crashing in production (AGENT-NATIVE-BROWSER-S).
      const isToggleCombo =
        typeof e.key === "string" &&
        e.key.toLowerCase() === "m" &&
        e.shiftKey &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey;
      if (isToggleCombo) {
        e.preventDefault();
        if (voice.state === "recording" || voice.state === "starting") {
          voice.stop();
        } else if (voice.state !== "transcribing") {
          void voice.start();
        }
        return;
      }
      if (
        e.key === "Escape" &&
        (voice.state === "recording" || voice.state === "starting")
      ) {
        e.preventDefault();
        voice.cancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [voiceEnabled, voice]);

  const extractComposerPayload = useCallback(() => {
    const ed = editor;
    if (!isComposerEditorUsable(ed)) {
      return {
        text: slotReferences.map((ref) => slotReferenceTitle(ref)).join(", "),
        references: slotReferences.map(referenceFromComposerReference),
      };
    }

    const references: Reference[] = slotReferences.map(
      referenceFromComposerReference,
    );

    // Build text that preserves @mentions (getText() strips them).
    // Walk the document and reconstruct with @name for mention/file/skill nodes.
    const textParts: string[] = [];
    ed.state.doc.descendants((node: any) => {
      if (node.isText) {
        textParts.push(node.text);
      } else if (node.type.name === "mentionReference") {
        textParts.push(`@[${node.attrs.label}|${node.attrs.icon || "file"}]`);
      } else if (node.type.name === "fileReference") {
        const label = node.attrs.path?.split("/").pop() || node.attrs.path;
        textParts.push(`@[${label}|file]`);
      } else if (node.type.name === "skillReference") {
        textParts.push(`/${node.attrs.name}`);
      } else if (node.type.name === "hardBreak") {
        textParts.push("\n");
      } else if (
        node.type.name === "paragraph" &&
        textParts.length > 0 &&
        textParts[textParts.length - 1] !== "\n"
      ) {
        textParts.push("\n");
      }
    });
    const rawText = textParts.join("").trim();
    const text =
      rawText ||
      slotReferences.map((ref) => slotReferenceTitle(ref)).join(", ");

    ed.state.doc.descendants((node: any) => {
      if (node.type.name === "fileReference") {
        // Legacy support
        references.push({
          type: "file",
          path: node.attrs.path,
          name: node.attrs.path?.split("/").pop() || node.attrs.path,
          source: node.attrs.source || "codebase",
        });
      } else if (node.type.name === "mentionReference") {
        const refType = node.attrs.refType;
        references.push({
          type:
            refType === "file"
              ? "file"
              : refType === "agent"
                ? "agent"
                : refType === "custom-agent"
                  ? "custom-agent"
                  : "mention",
          path: node.attrs.refPath || "",
          name: node.attrs.label,
          source: node.attrs.source,
          refType: node.attrs.refType,
          refId: node.attrs.refId,
          slotKey: node.attrs.slotKey,
          slotLabel: node.attrs.slotLabel,
          metadata: node.attrs.metadata,
        });
      } else if (node.type.name === "skillReference") {
        references.push({
          type: "skill",
          path: node.attrs.path,
          name: node.attrs.name,
          source: node.attrs.source || "codebase",
        });
      }
    });

    return { text, references };
  }, [editor, slotReferences]);

  const syncComposerRuntimeState = useCallback(
    (text: string, references: Reference[]) => {
      const requestMode =
        execMode === "plan" ? "plan" : execMode === "build" ? "act" : undefined;
      const custom: {
        references?: Reference[];
        requestMode?: "act" | "plan";
      } = {};
      if (references.length > 0) {
        custom.references = references;
      }
      if (requestMode) {
        custom.requestMode = requestMode;
      }
      const runConfig = Object.keys(custom).length > 0 ? { custom } : {};
      const runConfigSignature = JSON.stringify(runConfig);
      const last = lastComposerRuntimeSyncRef.current;
      if (
        last?.text === text &&
        last.runConfigSignature === runConfigSignature
      ) {
        return;
      }
      composerRuntime.setText(text);
      composerRuntime.setRunConfig(runConfig);
      lastComposerRuntimeSyncRef.current = { text, runConfigSignature };
    },
    [composerRuntime, execMode],
  );

  const resetComposerRuntimeState = useCallback(() => {
    const runConfigSignature = "{}";
    const last = lastComposerRuntimeSyncRef.current;
    if (last?.text === "" && last.runConfigSignature === runConfigSignature) {
      return;
    }
    composerRuntime.setText("");
    composerRuntime.setRunConfig({});
    lastComposerRuntimeSyncRef.current = { text: "", runConfigSignature };
  }, [composerRuntime]);

  const syncComposerState = useCallback(() => {
    const { text, references } = extractComposerPayload();
    syncComposerRuntimeState(text, references);
    return { text, references };
  }, [extractComposerPayload, syncComposerRuntimeState]);

  const clearEditorAfterSubmit = useCallback(() => {
    const ed = editor;
    if (!isComposerEditorUsable(ed)) return;
    ed.commands.clearContent();
    setEditorHasText(false);
    setSlotReferences([]);
    resetComposerRuntimeState();
    try {
      localStorage.removeItem(draftKey);
    } catch {}
    closePopover();
  }, [closePopover, draftKey, editor, resetComposerRuntimeState]);

  const submitComposer = useCallback(
    async (intent: ComposerSubmitIntent = "immediate") => {
      const ed = editor;
      if (!isComposerEditorUsable(ed)) return;
      if (submitInFlightRef.current) return;

      const { text, references } = syncComposerState();
      const attachments = composerRuntime.getState().attachments;
      if (!text.trim() && references.length === 0 && attachments.length === 0)
        return;
      const oversizedDocumentError =
        getOversizedDocumentAttachmentError(attachments);
      if (oversizedDocumentError) {
        onAttachmentErrorRef.current?.(oversizedDocumentError);
        return;
      }
      const cancelActiveVoice = () => {
        if (
          voice.state === "recording" ||
          voice.state === "starting" ||
          voice.state === "transcribing"
        ) {
          voice.cancel();
        }
      };

      // Intercept slash commands typed directly (e.g. "/clear" + Enter)
      const trimmed = text.trim();
      if (trimmed.startsWith("/") && references.length === 0) {
        const cmdName = normalizeSlashCommandName(trimmed);
        const matched = allSlashCommands.find((c) => c.name === cmdName);
        if (matched) {
          clearEditorAfterSubmit();
          onSlashCommandRef.current?.(matched.name);
          return;
        }
      }

      // Builder iframe delegation: when this app is mounted inside the
      // Builder.io webview and the user typed a "build me an app/agent"
      // prompt, hand it up to the parent Builder chat instead of sending
      // it to this app's domain agent. Builder is the code-writing agent;
      // the local agent (dispatch, mail, etc.) cannot scaffold workspace
      // apps from inside its own iframe.
      if (
        !composerMode &&
        interceptBuildRequestsForBuilder &&
        tryDelegateBuildRequestToBuilder(trimmed)
      ) {
        cancelActiveVoice();
        clearEditorAfterSubmit();
        return;
      }

      if (onBeforeSubmit) {
        submitInFlightRef.current = true;
        try {
          const shouldSubmit = await onBeforeSubmit();
          if (!shouldSubmit) return;
        } finally {
          submitInFlightRef.current = false;
        }
      }
      if (!isComposerEditorUsable(ed)) return;

      // Composer mode: send with context via agent chat bridge
      if (composerMode) {
        const config = COMPOSER_MODE_CONFIGS[composerMode];
        config.beforeSend?.();
        const message = displayableComposerModeMessage({
          messagePrefix: config.messagePrefix,
          trimmedText: trimmed,
          attachmentCount: attachments.length,
        });
        const modePrompt =
          trimmed ||
          (attachments.length > 0 ? "Use the attached context." : "");
        if (attachments.length > 0) {
          composerRuntime.setText(
            `${message}\n\n<context>\n${config.getContext(modePrompt)}\n</context>`,
          );
          composerRuntime.send();
        } else {
          sendToAgentChat({
            message,
            context: config.getContext(modePrompt),
            mode:
              execMode === "plan"
                ? "plan"
                : execMode === "build"
                  ? "act"
                  : undefined,
            submit: true,
          });
        }
        cancelActiveVoice();
        if (isComposerEditorUsable(ed)) ed.commands.clearContent();
        setEditorHasText(false);
        setSlotReferences([]);
        setComposerMode(null);
        composerModeRef.current = null;
        try {
          localStorage.removeItem(draftKey);
        } catch {}
        closePopover();
        return;
      }

      if (onSubmit) {
        onSubmit(text, references, attachments, { intent });
        // Clear any pending attachments now that the host has them.
        void composerRuntime.clearAttachments().catch(() => {});
        if (!clearOnSubmit) {
          closePopover();
          return;
        }
        cancelActiveVoice();
        clearEditorAfterSubmit();
        return;
      } else {
        composerRuntime.send();
      }
      cancelActiveVoice();
      if (isComposerEditorUsable(ed)) ed.commands.clearContent();
      setEditorHasText(false);
      setSlotReferences([]);
      try {
        localStorage.removeItem(draftKey);
      } catch {}
      closePopover();
    },
    [
      closePopover,
      clearEditorAfterSubmit,
      composerMode,
      composerRuntime,
      draftKey,
      editor,
      interceptBuildRequestsForBuilder,
      clearOnSubmit,
      onBeforeSubmit,
      onSubmit,
      syncComposerState,
      voice,
      allSlashCommands,
    ],
  );

  // Helper functions that operate on the editor view directly
  // These are called from handleKeyDown which can't use React state
  function selectMention(
    _view: any,
    pop: NonNullable<PopoverState>,
    item: MentionItem,
  ) {
    const ed = editor;
    if (!isComposerEditorUsable(ed)) return;
    const currentPos = ed.state.selection.from;
    // startPos is after the trigger char, so -1 to include the @ or /
    const deleteFrom = Math.max(0, pop.startPos - 1);
    ed.chain().focus().deleteRange({ from: deleteFrom, to: currentPos }).run();
    insertReference(composerReferenceFromMentionItem(item));
    popoverStateRef.current = null;
    setPopover(null);
  }

  function executeCommand(
    _view: any,
    pop: NonNullable<PopoverState>,
    command: SlashCommand,
  ) {
    const ed = editor;
    if (!isComposerEditorUsable(ed)) return;
    const currentPos = ed.state.selection.from;
    const deleteFrom = Math.max(0, pop.startPos - 1);
    ed.chain().focus().deleteRange({ from: deleteFrom, to: currentPos }).run();
    popoverStateRef.current = null;
    setPopover(null);
    onSlashCommandRef.current?.(command.name);
  }

  function selectSkill(
    _view: any,
    pop: NonNullable<PopoverState>,
    skill: SkillResult,
  ) {
    const ed = editor;
    if (!isComposerEditorUsable(ed)) return;
    const currentPos = ed.state.selection.from;
    const deleteFrom = Math.max(0, pop.startPos - 1);
    ed.chain()
      .focus()
      .deleteRange({ from: deleteFrom, to: currentPos })
      .insertContent({
        type: "skillReference",
        attrs: { name: skill.name, path: skill.path, source: skill.source },
      })
      .insertContent(" ")
      .run();
    popoverStateRef.current = null;
    setPopover(null);
  }

  // Popover select handlers for click-based selection (from MentionPopover)
  const handleSelectMention = useCallback(
    (item: MentionItem) => {
      if (!isComposerEditorUsable(editor) || !popover) return;
      const currentPos = editor.state.selection.from;
      const deleteFrom = Math.max(0, popover.startPos - 1);
      editor
        .chain()
        .focus()
        .deleteRange({ from: deleteFrom, to: currentPos })
        .run();
      insertReference(composerReferenceFromMentionItem(item));
      closePopover();
    },
    [editor, popover, closePopover, insertReference],
  );

  const handleSelectCommand = useCallback(
    (command: SlashCommand) => {
      if (!isComposerEditorUsable(editor) || !popover) return;
      const currentPos = editor.state.selection.from;
      const deleteFrom = Math.max(0, popover.startPos - 1);
      editor
        .chain()
        .focus()
        .deleteRange({ from: deleteFrom, to: currentPos })
        .run();
      closePopover();
      onSlashCommand?.(command.name);
    },
    [editor, popover, closePopover, onSlashCommand],
  );

  const handleSelectSkill = useCallback(
    (skill: SkillResult) => {
      if (!isComposerEditorUsable(editor) || !popover) return;
      const currentPos = editor.state.selection.from;
      const deleteFrom = Math.max(0, popover.startPos - 1);
      editor
        .chain()
        .focus()
        .deleteRange({ from: deleteFrom, to: currentPos })
        .insertContent({
          type: "skillReference",
          attrs: { name: skill.name, path: skill.path, source: skill.source },
        })
        .insertContent(" ")
        .run();
      closePopover();
    },
    [editor, popover, closePopover],
  );

  // Track query text as user types after trigger
  useEffect(() => {
    if (!isComposerEditorUsable(editor) || !popover) return;

    const updateHandler = () => {
      const pop = popoverStateRef.current;
      if (!pop) return;
      const { from } = editor.state.selection;
      const { startPos, type } = pop;

      if (from < startPos) {
        closePopover();
        return;
      }

      const text = editor.state.doc.textBetween(startPos, from);

      // Verify the trigger character is still there
      if (startPos > 0) {
        const triggerChar = editor.state.doc.textBetween(
          startPos - 1,
          startPos,
        );
        if (
          (type === "@" && triggerChar !== "@") ||
          (type === "/" && triggerChar !== "/")
        ) {
          closePopover();
          return;
        }
      }

      if (pop.query === text) return;
      const updated = { ...pop, query: text };
      popoverStateRef.current = updated;
      setPopover(updated);
    };

    editor.on("update", updateHandler);
    editor.on("selectionUpdate", updateHandler);
    return () => {
      if (isComposerEditorUsable(editor)) {
        editor.off("update", updateHandler);
        editor.off("selectionUpdate", updateHandler);
      }
    };
  }, [editor, popover, closePopover]);

  useEffect(() => {
    if (!isComposerEditorUsable(editor)) return;
    if (composerText !== "") return;
    if (editor.isEmpty) return;
    editor.commands.clearContent();
  }, [composerText, editor]);

  useEffect(() => {
    if (!isComposerEditorUsable(editor) || initialText === undefined) return;
    const key = initialTextKey ?? initialText;
    if (initialTextKeyRef.current === key) return;
    initialTextKeyRef.current = key;
    editor.commands.setContent(plainTextToDoc(initialText));
    editor.commands.focus("end");
    const trimmed = editor.state.doc.textContent.trim();
    setEditorHasText(trimmed.length > 0);
    composerRuntime.setText(trimmed);
    onTextChangeRef.current?.(trimmed);
    try {
      if (trimmed) {
        localStorage.setItem(draftKey, editor.getHTML());
      } else {
        localStorage.removeItem(draftKey);
      }
    } catch {}
  }, [composerRuntime, draftKey, editor, initialText, initialTextKey]);

  // Tiptap only reads `editable` at init; prop changes need setEditable.
  useEffect(() => {
    if (!isComposerEditorUsable(editor)) return;
    editor.setEditable(!disabled);
    if (disabled) editor.commands.blur();
  }, [editor, disabled]);

  return (
    <RealtimeVoiceModeBoundary>
      <style>{`
        .aui-composer .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: var(--color-muted-foreground);
          opacity: 0.5;
          float: left;
          height: 0;
          pointer-events: none;
        }
      `}</style>
      {composerMode && (
        <div
          data-agent-composer-variant={layoutVariant}
          data-agent-composer-slot="mode-row"
          className="agent-composer-mode-row px-2.5 pt-2 pb-0"
        >
          <ComposerModeChip
            mode={composerMode}
            onRemove={() => {
              setComposerMode(null);
              composerModeRef.current = null;
              if (isComposerEditorUsable(editor)) {
                editor.commands.focus("end");
              }
            }}
          />
        </div>
      )}
      {hasContextRows && (
        <div
          data-agent-composer-variant={layoutVariant}
          data-agent-composer-slot="context-row"
          className="agent-composer-context-row flex flex-wrap gap-1.5 px-2.5 pt-2 pb-0"
        >
          {slotReferences.map((ref) => (
            <span
              key={ref.slotKey}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground shadow-sm"
            >
              <IconClipboardList className="h-3 w-3 shrink-0 text-muted-foreground" />
              {ref.slotLabel && (
                <span className="shrink-0 text-muted-foreground">
                  {ref.slotLabel}
                </span>
              )}
              <span className="min-w-0 truncate">{ref.label}</span>
              <button
                type="button"
                onClick={() => {
                  setSlotReferences((current) =>
                    removeSlotReference(current, ref),
                  );
                  if (isComposerEditorUsable(editor)) {
                    editor.commands.focus("end");
                  }
                }}
                aria-label={`Remove ${slotReferenceTitle(ref)} reference`}
                className="ms-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <IconX className="h-3 w-3" />
              </button>
            </span>
          ))}
          {contextItems.map((item) => (
            <span
              key={item.key}
              data-state={
                selectedContextItemKey === item.key ? "selected" : undefined
              }
              className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium text-foreground ${
                selectedContextItemKey === item.key
                  ? "border-ring bg-accent ring-2 ring-ring/40"
                  : "border-border bg-muted/50"
              }`}
            >
              <IconClipboardList className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{item.title}</span>
              <button
                type="button"
                onClick={() => {
                  selectedContextItemKeyRef.current = null;
                  setSelectedContextItemKey(null);
                  onRemoveContextItem?.(item.key);
                }}
                aria-label={`Remove ${item.title} context`}
                className="ms-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <IconX className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div
        data-agent-composer-variant={layoutVariant}
        data-agent-composer-slot="editor-wrap"
        className={`agent-composer-editor-wrap ${
          composerMode || hasContextRows ? "px-2 pt-1 pb-1" : "px-2 pt-2 pb-1"
        }`}
      >
        <EditorContent
          editor={editor}
          data-agent-composer-variant={layoutVariant}
          data-agent-composer-slot="editor"
          className="agent-composer-editor aui-composer flex-1 min-w-0 [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:m-0 px-0.5"
        />
      </div>
      {voiceEnabled && <VoiceRecordingOverlay voice={voice} />}
      <div
        data-agent-composer-variant={layoutVariant}
        data-agent-composer-slot="toolbar"
        className="agent-composer-toolbar flex items-center gap-1 px-2 py-1.5"
      >
        {attachButton ??
          (plusMenuMode === "hidden" ? null : (
            <ComposerPlusMenu
              onSelectMode={handleSelectMode}
              mode={plusMenuMode}
              onAttachmentError={onAttachmentError}
            />
          ))}
        {toolbarSlot ?? modeControl}
        <div data-agent-composer-slot="toolbar-spacer" className="flex-1" />
        {selectedModel && availableModels && onModelChange && (
          <ModelSelector
            model={selectedModel}
            effort={selectedEffort}
            engines={availableModels}
            onChange={onModelChange}
            onEffortChange={onEffortChange}
            providerConnectStatusEnabled={providerConnectStatusEnabled}
            onConnectProvider={onConnectProvider}
            imageModel={imageModelMenu}
          />
        )}
        {execMode && onExecModeChange && (
          <ModeSelector
            mode={execMode}
            onChange={onExecModeChange}
            planModeDisabled={planModeDisabled}
            planModeDisabledReason={planModeDisabledReason}
          />
        )}
        {actionButton ?? (
          <>
            {extraActionButton}
            {voiceEnabled && (
              <VoiceButton voice={voice} isMac={isMac} disabled={disabled} />
            )}
            {primaryAction === "stop" ? (
              stopButton
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => void submitComposer("immediate")}
                    disabled={!canSend}
                    data-agent-composer-slot="send-button"
                    className="agent-composer-send-button shrink-0 flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-[opacity,transform] duration-150 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <IconArrowUp className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Send message</TooltipContent>
              </Tooltip>
            )}
          </>
        )}
      </div>
      <MentionPopover
        ref={popoverRef}
        type={popover?.type ?? "@"}
        position={popover?.position ?? null}
        mentionItems={filteredMentionItems}
        skills={filteredSkills}
        commands={filteredCommands}
        hint={hint}
        isLoading={popover?.type === "@" ? mentionsLoading : skillsLoading}
        query={popover?.query ?? ""}
        onSelectMention={handleSelectMention}
        onSelectSkill={handleSelectSkill}
        onSelectCommand={handleSelectCommand}
        onClose={closePopover}
      />
    </RealtimeVoiceModeBoundary>
  );
}
