import { useComposer, useComposerRuntime } from "@assistant-ui/react";
import {
  IconCheck,
  IconChevronDown,
  IconBulb,
  IconClock,
  IconBolt,
  IconTool,
  IconX,
  IconClipboardList,
  IconAlertCircle,
  IconLoader2,
  IconRefresh,
} from "@tabler/icons-react";
import type { Editor } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useImperativeHandle,
  useMemo,
} from "react";
import { toast } from "sonner";

import { Button } from "../ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuTrailing,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.js";
import { formatAttachmentError } from "./attachment-accept.js";
import { ComposerNotice } from "./composer-notice.js";
import {
  searchComposerContextActions,
  type ComposerContextMenuItem,
} from "./ComposerContextMenu.js";
import {
  ComposerPlusMenu,
  type ComposerTerminalModeControl,
} from "./ComposerPlusMenu.js";
import {
  areComposerContextItemsReady,
  ComposerContextError,
  snapshotComposerContextItems,
  type ComposerContextSnapshot,
} from "./context-items.js";
import { getComposerDraftKey } from "./draft-key.js";
import { FileReference } from "./extensions/FileReference.js";
import { MentionReference } from "./extensions/MentionReference.js";
import { SkillReference } from "./extensions/SkillReference.js";
import { MentionItemMedia } from "./MentionItemMedia.js";
import { MentionPopover, type MentionPopoverRef } from "./MentionPopover.js";
import {
  curateModelPickerRows,
  filterModelGroupsForAgent,
  isClaudeCodeAgentId,
  resolvePreferredAgentModel,
} from "./model-selection.js";
import {
  hasModelDetails,
  RecommendedBadge,
  ModelDetailsCard,
} from "./ModelPickerParts.js";
import {
  createPastedAttachmentFile,
  readClipboardPaste,
  shouldConvertClipboardToAttachment,
} from "./pasted-text.js";
import {
  AGENT_CHAT_INSERT_REFERENCE_EVENT,
  AGENT_CHAT_INSERT_REFERENCE_MESSAGE_TYPE,
  DEFAULT_REASONING_EFFORT,
  formatPromptContextItems,
  getReasoningEffortOptionsForModel,
  getComposerReferenceEventTarget,
  type ComposerModelDescription,
  reasoningEffortLabel,
  resolveReasoningEffortSelection,
  type AgentChatContextItem,
  type AgentComposerReference,
  type AgentComposerReferenceInsertPayload,
  type ComposerTranslate,
  type ReasoningEffort,
  type VoiceContextPack,
  useComposerRuntimeAdapters,
} from "./runtime-adapters.js";
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
import {
  RealtimeVoiceModeBoundary,
  useRealtimeVoiceModeCopy,
  useRealtimeVoiceModeOptional,
} from "./useRealtimeVoiceMode.js";
import { useVoiceDictation } from "./useVoiceDictation.js";
import {
  ComposerSendButton,
  isVoiceRecordingActive,
  VoiceButton,
  VoiceRecordingOverlay,
} from "./VoiceButton.js";
/**
 * What a send would take from the composer at one moment, so a host that held
 * a send back can tell the draft it held from one the person kept editing.
 */
export interface ComposerDraftSnapshot {
  text: string;
  /** Each reference exactly as it would be submitted, stably serialized. */
  referenceKeys: string[];
  attachmentIds: string[];
}

/** The same value always serializes the same, whatever order its keys were set in. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const attachmentFileInstances = new WeakMap<object, number>();
let nextAttachmentFileInstance = 0;

/**
 * Names and ids can repeat: a replacement file may carry the same name, and
 * the image adapter has used the name as the id. The attachment's own File
 * object is what tells one file from another, so it is part of the identity.
 */
function composerAttachmentIdentity(attachment: {
  id?: string;
  name?: string;
  file?: unknown;
}): string {
  const label = attachment.id ?? attachment.name ?? "";
  const file = attachment.file;
  if (!file || typeof file !== "object") return label;
  let instance = attachmentFileInstances.get(file);
  if (instance === undefined) {
    instance = ++nextAttachmentFileInstance;
    attachmentFileInstances.set(file, instance);
  }
  return `${label}#${instance}`;
}

export function composerDraftSnapshot(
  text: string,
  references: readonly Reference[],
  attachments: readonly { id?: string; name?: string; file?: unknown }[],
): ComposerDraftSnapshot {
  return {
    text,
    referenceKeys: references.map((ref) => stableJson(ref)),
    attachmentIds: attachments.map(composerAttachmentIdentity),
  };
}

export function sameComposerDraft(
  a: ComposerDraftSnapshot,
  b: ComposerDraftSnapshot,
): boolean {
  return (
    a.text === b.text &&
    JSON.stringify(a.referenceKeys) === JSON.stringify(b.referenceKeys) &&
    JSON.stringify(a.attachmentIds) === JSON.stringify(b.attachmentIds)
  );
}

export interface TiptapComposerHandle {
  focus(): void;
  /** Add a file through the same attachment pipeline as paste and drop. */
  addAttachment(file: File): Promise<unknown>;
  /** Insert text through the editor's normal input path. */
  insertText(text: string): void;
  /**
   * Insert text at the current selection, keeping the existing draft. Typed
   * triggers such as `@` open their menus as if the person typed them.
   */
  insertTextAtCursor?(text: string): void;
  /**
   * Replace the draft. Each reference becomes a chip in place of
   * `text.slice(start, end)`; one that overlaps another or crosses a line
   * break stays text.
   */
  setText(text: string, references?: readonly ComposerTextReference[]): void;
  /** Submit replacement text with the current attachments and context, without editing the draft on failure. */
  submitWithText(text: string): Promise<boolean>;
  /** Submit the current draft as if the person pressed send. */
  submit?(): Promise<boolean>;
  /** The draft as a send would take it right now. */
  getDraftSnapshot?(): ComposerDraftSnapshot;
  insertReference(ref: AgentComposerReference): void;
  replaceReference(refType: string, ref: AgentComposerReference | null): void;
  getSelection(): ComposerTextSelection | null;
  setSelection(
    start: number,
    end?: number,
    direction?: ComposerTextSelection["direction"],
  ): void;
  dismissPopover(): boolean;
}

export interface ComposerTextSelection {
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
}

/** A chip standing for `text.slice(start, end)` of a draft's plain text. */
export interface ComposerTextReference {
  start: number;
  end: number;
  reference: AgentComposerReference;
}

export type ComposerSubmitIntent = "immediate" | "queued";

export const DEFAULT_VOICE_DICTATION_ENABLED = false;

export interface TiptapComposerSubmitOptions {
  intent?: ComposerSubmitIntent;
  steer?: boolean;
  contextItems?: ComposerContextSnapshot;
  /** Clear the submitted draft once the host owns the message and its failure recovery. */
  onLocalSubmit?: () => void;
  /** Mode instructions, separate from provider-owned context awaiting revalidation. */
  composerModeContext?: string;
  /** Id `onSubmitStart` returned, so the sent message can be matched to its placeholder. */
  submissionId?: string;
  /** Set when `/plan` asked for this one message to be a read-only plan turn. */
  requestMode?: "plan";
}

export interface ComposerSubmitStartAttachment {
  id: string;
  name: string;
  contentType?: string;
  file?: Blob;
}

/** What the user sent, captured before any preflight or host await. */
export interface ComposerSubmitStart {
  text: string;
  references: Reference[];
  attachments: readonly ComposerSubmitStartAttachment[];
  intent: ComposerSubmitIntent;
}

export interface ComposerSubmitStartHandle {
  id: string;
  /** Called once the submit settles, whether it was sent, refused or failed. */
  end: () => void;
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

const VOICE_TERMINAL_PUNCTUATION = /[.!?…。！？:;](?:["'”’»)\]}]*)$/;

export function formatVoiceTranscriptForComposer(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return `${trimmed}${VOICE_TERMINAL_PUNCTUATION.test(trimmed) ? "" : "."} `;
}

export function canRemoveVoicePreview(options: {
  documentSize: number;
  anchor: number;
  previewText: string;
  currentText: string;
}): boolean {
  if (!options.previewText) return false;
  if (options.anchor < 1) return false;
  if (options.anchor + options.previewText.length > options.documentSize) {
    return false;
  }
  return options.currentText === options.previewText;
}

export function getComposerSendTooltipKey(
  willQueue: boolean,
): "composer.queueMessage" | "composer.sendMessage" {
  return willQueue ? "composer.queueMessage" : "composer.sendMessage";
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
const FILE_COMPARISON_CHUNK_BYTES = 64 * 1024;
const MAX_ATTACHMENT_COMPARISON_BYTES = 16 * 1024 * 1024;
const MAX_ATTACHMENT_COMPARISONS = 128;

type AttachmentComparisonBudget = {
  remainingBytes: number;
  remainingComparisons: number;
};

function normalizeAttachmentContentType(contentType: string | undefined) {
  return contentType?.trim().toLowerCase() || "application/octet-stream";
}

async function haveSameFileContents(
  first: Blob,
  second: Blob,
  budget: AttachmentComparisonBudget,
) {
  if (first === second) return true;
  if (first.size !== second.size) return false;

  for (
    let offset = 0;
    offset < first.size;
    offset += FILE_COMPARISON_CHUNK_BYTES
  ) {
    const end = Math.min(offset + FILE_COMPARISON_CHUNK_BYTES, first.size);
    const comparisonBytes = (end - offset) * 2;
    if (comparisonBytes > budget.remainingBytes) return false;
    budget.remainingBytes -= comparisonBytes;
    const [firstChunk, secondChunk] = await Promise.all([
      first.slice(offset, end).arrayBuffer(),
      second.slice(offset, end).arrayBuffer(),
    ]);
    budget.remainingBytes +=
      comparisonBytes - firstChunk.byteLength - secondChunk.byteLength;
    const firstBytes = new Uint8Array(firstChunk);
    const secondBytes = new Uint8Array(secondChunk);
    if (firstBytes.some((byte, index) => byte !== secondBytes[index])) {
      return false;
    }
  }

  return true;
}

async function haveSameAttachmentInput(
  first: { file: Blob; name: string; contentType: string },
  second: { file: Blob; name: string; contentType: string },
  budget: AttachmentComparisonBudget,
) {
  if (budget.remainingComparisons === 0) return false;
  budget.remainingComparisons -= 1;
  const firstExtension = first.name.match(/\.[^.]+$/)?.[0].toLowerCase() ?? "";
  const secondExtension =
    second.name.match(/\.[^.]+$/)?.[0].toLowerCase() ?? "";
  if (
    firstExtension !== secondExtension ||
    first.contentType !== second.contentType
  ) {
    return false;
  }
  return haveSameFileContents(first.file, second.file, budget);
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function isSameComposerAttachment(
  current: { id: string; file?: unknown },
  submitted: { id: string; file?: unknown },
) {
  return (
    current.id === submitted.id &&
    (current === submitted ||
      (submitted.file != null && current.file === submitted.file))
  );
}

function isSameComposerAttachmentSnapshot(
  current: { id: string; file?: unknown },
  snapshot: { id: string; file?: unknown },
) {
  return current.id === snapshot.id && current.file === snapshot.file;
}

// Host Add-menu actions listed among "@" suggestions. Picking one runs the
// action or opens its picker as a dialog instead of inserting a mention.
const COMPOSER_CONTEXT_ENTRY_SOURCE = "composer-context";

function composerReferenceFromMentionItem(
  item: MentionItem,
): AgentComposerReference {
  return {
    label: item.referenceLabel ?? item.label,
    icon: item.icon || "file",
    media: item.media,
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

export function mentionItemMatchesQuery(
  item: MentionItem,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return [item.label, ...(item.aliases ?? []), item.description ?? ""].some(
    (candidate) => candidate.toLowerCase().includes(normalizedQuery),
  );
}

export function findExactMentionItem(
  items: MentionItem[],
  query: string,
): MentionItem | undefined {
  const normalizedQuery = query.toLowerCase();
  return items.find((item) =>
    [item.label, ...(item.aliases ?? [])].some(
      (candidate) => candidate.toLowerCase() === normalizedQuery,
    ),
  );
}

function mentionReferenceAttrs(ref: AgentComposerReference) {
  return {
    label: ref.label,
    icon: ref.icon || "file",
    media: ref.media || null,
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
  const contentType =
    typeof value.contentType === "string"
      ? value.contentType.toLowerCase()
      : "";
  const name = typeof value.name === "string" ? value.name.toLowerCase() : "";
  return contentType === "application/pdf" || name.endsWith(".pdf");
}

export function getOversizedDocumentAttachmentError(
  attachments: ReadonlyArray<unknown>,
  options: {
    maxBytes?: number;
    label?: string;
    translate?: ComposerTranslate;
  } = {},
): string | null {
  const maxBytes = options.maxBytes ?? MAX_DOCUMENT_ATTACHMENT_BYTES;
  const label = options.label ?? "PDFs";
  const t = options.translate;
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object") continue;
    const candidate = attachment as Record<string, unknown>;
    if (!isDocumentAttachment(candidate)) continue;
    const file = candidate.file;
    if (!(file instanceof File)) continue;
    if (file.size <= maxBytes) continue;
    const name =
      typeof candidate.name === "string" && candidate.name.trim()
        ? candidate.name
        : file.name;
    const mb = (file.size / 1024 / 1024).toFixed(1);
    const maxMb = Number((maxBytes / 1024 / 1024).toFixed(1)).toString();
    return (
      t?.("agentChat.composer.documentTooLarge", {
        defaultValue:
          '"{{name}}" is {{size}} MB. {{label}} are capped at {{maxSize}} MB to stay within message limits. Please reduce the file size or split it into smaller parts.',
        name,
        size: mb,
        label,
        maxSize: maxMb,
      }) ??
      `"${name}" is ${mb} MB. ${label} are capped at ${maxMb} MB to stay within message limits. Please reduce the file size or split it into smaller parts.`
    );
  }
  return null;
}

export function getComposerSubmitIntentForEnterKey(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "metaKey" | "ctrlKey">,
  isMac: boolean,
): ComposerSubmitIntent | null {
  if (event.key !== "Enter" || event.shiftKey) return null;

  const queuedModifierPressed = isMac ? event.metaKey : event.ctrlKey;
  if (queuedModifierPressed) return "immediate";

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

/** True when the document holds nothing at all, not even an inline atom. */
export function isComposerDocEmpty(doc: {
  childCount: number;
  firstChild: { childCount: number } | null;
}): boolean {
  return (
    doc.childCount === 0 ||
    (doc.childCount === 1 && (doc.firstChild?.childCount ?? 0) === 0)
  );
}

export function getComposerPopoverAnchorPosition(
  view: Pick<EditorView, "coordsAtPos" | "dom">,
  pos: number,
): { top: number; left: number; width?: number } | null {
  const position = getComposerPopoverPosition(view, pos);
  if (!position) return null;
  const root = view.dom.closest<HTMLElement>(
    '[data-agent-composer-slot="root"]',
  );
  const rect = root?.getBoundingClientRect();
  if (!rect || rect.width <= 0) return position;
  return { top: rect.top, left: rect.left, width: rect.width };
}

export function displayableComposerModeMessage(options: {
  messagePrefix: string;
  trimmedText: string;
  attachmentCount: number;
  attachedContextFallback?: string;
}): string {
  const modePrompt =
    options.trimmedText ||
    (options.attachmentCount > 0
      ? (options.attachedContextFallback ?? "Use the attached context.")
      : "");
  return `${options.messagePrefix}${modePrompt}`;
}

function uniquifyComposerImageFile(file: File): File {
  if (!file.type.startsWith("image/")) return file;
  const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`;
  return new File([file], uniqueName, { type: file.type });
}

type ComposerDocument = {
  textContent: string;
  descendants: (callback: (node: any) => boolean | void) => void;
};

type ComposerDraftEditor = {
  isDestroyed?: boolean;
  getHTML(): string;
  state: { doc: ComposerDocument };
};

const COMPOSER_DRAFT_SAVE_DELAY_MS = 300;
const COMPOSER_DRAFT_FORMAT = "agent-composer-draft-v1";

function readComposerDraft(value: string): {
  html: string;
  slotReferences: AgentComposerReference[];
} {
  if (!value.startsWith(`{"format":"${COMPOSER_DRAFT_FORMAT}"`)) {
    return { html: value, slotReferences: [] };
  }
  const parsed = JSON.parse(value);
  if (
    parsed?.format !== COMPOSER_DRAFT_FORMAT ||
    typeof parsed.html !== "string" ||
    !Array.isArray(parsed.slotReferences)
  ) {
    throw new Error("Stored composer draft has an invalid format.");
  }
  return { html: parsed.html, slotReferences: parsed.slotReferences };
}

function writeComposerDraft(
  draftKey: string | null,
  html: string,
  slotReferences: AgentComposerReference[],
): void {
  if (!draftKey) return;
  try {
    if (!html.trim() && slotReferences.length === 0) {
      localStorage.removeItem(draftKey);
    } else if (slotReferences.length > 0) {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          format: COMPOSER_DRAFT_FORMAT,
          html,
          slotReferences,
        }),
      );
    } else {
      localStorage.setItem(draftKey, html);
    }
  } catch {
    // coercion-ok: Browser storage is optional and can be unavailable or full.
  }
}

function composerDocumentHasContent(doc: ComposerDocument): boolean {
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

function persistComposerDraft(
  draftKey: string | null,
  editor: ComposerDraftEditor,
  slotReferences: AgentComposerReference[],
): void {
  if (!composerDocumentHasContent(editor.state.doc) && !slotReferences.length) {
    writeComposerDraft(draftKey, "", []);
    return;
  }
  writeComposerDraft(draftKey, editor.getHTML(), slotReferences);
}

function clearComposerDraft(
  draftKey: string | null,
  expectedValue?: string | null,
): void {
  if (!draftKey) return;
  try {
    if (
      expectedValue !== undefined &&
      localStorage.getItem(draftKey) !== expectedValue
    ) {
      // A submit that started against this key may resolve long after its
      // composer instance unmounted. If a freshly mounted composer reused
      // the exact same scope (e.g. the host reopens the same popover before
      // the earlier submit settles) and the visitor typed something new,
      // localStorage now holds that newer draft — leave it alone instead of
      // wiping out a draft this stale submit never wrote.
      return;
    }
    localStorage.removeItem(draftKey);
  } catch {
    // coercion-ok: browser storage is optional and can be unavailable or full.
  }
}

export function handleComposerFileDrop(options: {
  event: Pick<DragEvent, "dataTransfer" | "preventDefault" | "stopPropagation">;
  addAttachment: (file: File) => Promise<unknown>;
  attachmentsEnabled?: boolean;
  onError?: (error: unknown, fileName: string) => void;
}): boolean {
  const droppedFiles = Array.from(options.event.dataTransfer?.files ?? []);
  if (droppedFiles.length === 0) return false;

  options.event.preventDefault();
  options.event.stopPropagation();
  if (options.attachmentsEnabled === false) return true;
  let errorReported = false;
  void Promise.all(
    droppedFiles.map(async (droppedFile) => {
      try {
        await options.addAttachment(uniquifyComposerImageFile(droppedFile));
      } catch (error) {
        if (errorReported) return;
        errorReported = true;
        options.onError?.(error, droppedFile.name);
      }
    }),
  );
  return true;
}

/** Handled by the composer itself: it marks only the next message as a plan. */
const PLAN_SLASH_COMMAND = "plan";

function planSlashCommand(t: ComposerTranslate): SlashCommand {
  return {
    name: PLAN_SLASH_COMMAND,
    description: t("agentChat.commands.planNext", {
      defaultValue: "Plan the next message",
    }),
    icon: "plan",
  };
}

function builtInCommands(
  t: ComposerTranslate,
  { planCommand = false }: { planCommand?: boolean } = {},
): SlashCommand[] {
  return [
    {
      name: "clear",
      description: t("agentChat.commands.clearShort", {
        defaultValue: "Start a new chat",
      }),
      icon: "clear",
    },
    {
      name: "new",
      description: t("agentChat.commands.newShort", {
        defaultValue: "Start a new chat",
      }),
      icon: "new",
    },
    {
      name: "history",
      description: t("agentChat.commands.history", {
        defaultValue: "Browse all chats",
      }),
      icon: "history",
    },
    ...(planCommand ? [planSlashCommand(t)] : []),
    {
      name: "help",
      description: t("agentChat.commands.help", {
        defaultValue: "Show available commands",
      }),
      icon: "help",
    },
  ];
}

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
    icon: React.ComponentType<{ className?: string }>;
    getContext: (prompt: string) => string;
    beforeSend?: () => void;
  }
> = {
  skill: {
    icon: IconBulb,
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
    icon: IconClock,
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
    icon: IconBolt,
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
    icon: IconTool,
    getContext: (prompt) =>
      `The user wants to create an interactive extension (sandboxed mini-app). Their description: "${prompt}"

Use the create-extension action with Alpine.js HTML content. The extension runs as a sandboxed iframe with Tailwind CSS and modest default canvas padding. For edge-to-edge layouts, put data-extension-layout="full-bleed" on the outermost element.

After creating the extension, navigate the user to it with the path returned by create-extension; extension URLs may include a friendly "/extensions/<id>/<slug>" suffix.

Make the extension functional and visually polished. Extensions can use extensionFetch() for external API calls, appAction()/appFetch() for app operations and app data writes, extensionData for per-extension persistence, and dbQuery() only for read-only inspection of existing app tables.

Prefer appAction()/appFetch() for app data. Some actions return JSON strings for CLI compatibility, so parse string results before counting rows or reading arrays. Do not guess raw SQL table names or columns for app data; use dbQuery() only when the table is known to exist in the current schema.`,
  },
};

function localizedComposerModeConfig(mode: ComposerMode, t: ComposerTranslate) {
  const config = COMPOSER_MODE_CONFIGS[mode];
  const copies: Record<
    ComposerMode,
    { label: string; placeholder: string; messagePrefix: string }
  > = {
    skill: {
      label: t("agentChat.composer.createSkill", {
        defaultValue: "Create Skill",
      }),
      placeholder: t("agentChat.composer.describeSkill", {
        defaultValue: "Describe the skill you want to create...",
      }),
      messagePrefix: t("agentChat.composer.createSkillPrefix", {
        defaultValue: "Create a skill: ",
      }),
    },
    job: {
      label: t("agentChat.composer.scheduleTask", {
        defaultValue: "Schedule Task",
      }),
      placeholder: t("agentChat.composer.describeSchedule", {
        defaultValue: "Describe what should happen and when...",
      }),
      messagePrefix: t("agentChat.composer.scheduleTaskPrefix", {
        defaultValue: "Create a recurring job: ",
      }),
    },
    automation: {
      label: t("agentChat.composer.createAutomation", {
        defaultValue: "Create Automation",
      }),
      placeholder: t("agentChat.composer.describeAutomation", {
        defaultValue: "Describe what you want to automate...",
      }),
      messagePrefix: t("agentChat.composer.createAutomationPrefix", {
        defaultValue: "Create an automation: ",
      }),
    },
    extension: {
      label: t("agentChat.composer.createExtension", {
        defaultValue: "Create Extension",
      }),
      placeholder: t("agentChat.composer.describeExtension", {
        defaultValue: "Describe the interactive extension you want to build...",
      }),
      messagePrefix: t("agentChat.composer.createExtensionPrefix", {
        defaultValue: "Create an extension: ",
      }),
    },
  };
  return { ...config, ...copies[mode] };
}

function ComposerModeChip({
  mode,
  onRemove,
}: {
  mode: ComposerMode;
  onRemove: () => void;
}) {
  const t = useComposerRuntimeAdapters().translate!;
  const config = localizedComposerModeConfig(mode, t);
  return (
    <ComposerChip
      icon={config.icon}
      label={config.label}
      removeLabel={t("agentChat.common.cancel", { defaultValue: "Cancel" })}
      onRemove={onRemove}
    />
  );
}

function ComposerChip({
  icon: Icon,
  label,
  removeLabel,
  onRemove,
  slot,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  removeLabel: string;
  onRemove: () => void;
  slot?: string;
}) {
  return (
    <span
      data-agent-composer-slot={slot}
      className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 text-xs font-medium text-foreground"
    >
      <Icon className="h-3 w-3 text-muted-foreground" />
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="-my-1 -me-1.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
      >
        <IconX aria-hidden="true" className="h-3 w-3" />
      </button>
    </span>
  );
}

export interface ComposerAgentOption {
  /** Stable host-defined identifier for the agent runtime. */
  id: string;
  /** Human-readable runtime name shown in the picker. */
  label: string;
  /** Optional icon shown beside the runtime name. */
  icon?: React.ReactNode;
  /** Optional short detail shown below the runtime name. */
  description?: string;
  /** Whether this runtime can be selected right now. */
  configured?: boolean;
  /** Optional status text such as "Installed" or "Sign in". */
  statusLabel?: string;
}

export interface TiptapComposerProps {
  /**
   * Placeholder for an empty thread. With `conversationStarted` it yields to
   * `replyPlaceholder`; without it, it is the only placeholder.
   */
  placeholder?: string;
  /** Placeholder once the thread has messages. Defaults to "Reply…". */
  replyPlaceholder?: string;
  /** The thread already has messages, so the composer reads as a reply. */
  conversationStarted?: boolean;
  /** Accessible name for the editable prompt surface. */
  ariaLabel?: string;
  disabled?: boolean;
  /** Unset preserves generic references; false excludes inactive chats; true reports sidebar readiness. */
  isReferenceTarget?: boolean;
  /** Disable the + and @ launchers while the editor stays editable. */
  contextControlsDisabled?: boolean;
  /** Prevent submission without making the editable surface lose focus. */
  submissionDisabled?: boolean;
  /** Disable only the send control while the submission is being accepted. */
  sendButtonDisabled?: boolean;
  /** Show progress in the send control while a pre-submit check is running. */
  sendButtonBusy?: boolean;
  /** Prevent submission while a host request is in flight. */
  submitting?: boolean;
  /** Override the generic document attachment cap for a multipart host. */
  maxDocumentAttachmentBytes?: number;
  /** Disable file attachments while keeping text chat available. */
  attachmentsEnabled?: boolean;
  onAttachmentRequest?: () => void;
  contextButtonTooltipDisabled?: boolean;
  /** Label used in the visible document attachment limit error. */
  documentAttachmentLimitLabel?: string;
  focusRef?: React.Ref<TiptapComposerHandle>;
  /** Programmatically seed the editor with plain text. */
  initialText?: string;
  /** Stable key used to re-apply the seeded text. */
  initialTextKey?: string | number;
  /** Chips placed into `initialText`, as `setText` takes them. */
  initialReferences?: readonly ComposerTextReference[];
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
  ) => void | Promise<void>;
  onEmptySubmit?: () => void | Promise<void>;
  /** Return false to stop a submit before it enters the chat runtime. */
  onBeforeSubmit?: (
    draft?: ComposerDraftSnapshot,
  ) => boolean | Promise<boolean>;
  onSubmissionPendingChange?: (pending: boolean) => void;
  /**
   * Called synchronously when a submit takes its draft, before `onBeforeSubmit`
   * or `onSubmit` await anything. Return a handle to own an optimistic copy of
   * the message; its attachments then leave the strip until the submit settles.
   * The owner also reports an `onSubmit` failure, so the composer adds none.
   */
  onSubmitStart?: (
    submission: ComposerSubmitStart,
  ) => ComposerSubmitStartHandle | undefined;
  /** Attachments an optimistic message is showing; hide them from the draft. */
  onOptimisticAttachmentsChange?: (attachmentIds: readonly string[]) => void;
  /** Scope where a failed submission should be recovered after the host forks. */
  getSubmitFailureDraftScope?: () => string | null;
  /**
   * Clear the submitted draft after local ownership or successful submission.
   * Standalone workflows may keep the draft visible for quick edits.
   */
  clearOnSubmit?: boolean;
  /** Clear the submitted text before awaiting the host request. */
  clearOnSubmitImmediately?: boolean;
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
  /**
   * ArrowUp in an empty composer with the caret at the start. Return true when
   * the host started editing the last sent message, so the key is consumed.
   */
  onRecallLastMessage?: () => boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onSelectionChange?: (selection: ComposerTextSelection) => void;
  /** Custom action button (e.g. stop button) to render instead of the default send button. */
  actionButton?: React.ReactNode;
  /** Whether the default send action will wait behind existing work. */
  willQueue?: boolean;
  /**
   * A draft sent while an earlier one is still being submitted goes out as a
   * queued send behind it. Without this the composer waits for the earlier
   * submission before it takes another.
   */
  queuesBehindSubmission?: boolean;
  /** Extra button to render alongside the primary action. */
  extraActionButton?: React.ReactNode;
  /**
   * Stop control rendered beside send while a run is active, whatever the
   * draft holds. Pass it only while there is something to stop; Escape in the
   * editor clicks it when it is enabled.
   */
  stopButton?: React.ReactNode;
  /** Custom attachment button to render instead of ComposerPrimitive.AddAttachment. */
  attachButton?: React.ReactNode;
  /** Custom host-owned control rendered next to the attachment affordance. */
  modeControl?: React.ReactNode;
  /** Explicit host-owned toolbar slot rendered next to the attachment affordance. */
  toolbarSlot?: React.ReactNode;
  /**
   * Context usage control rendered just before the model chip. The composer
   * never fetches usage itself.
   */
  contextUsageSlot?: React.ReactNode;
  /** Host-owned row rendered inside the frame, above the editor. */
  headerSlot?: React.ReactNode;
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
  /** Called when a slash command (e.g. /clear, /help) is executed */
  onSlashCommand?: (command: string) => void;
  /**
   * Offer `/plan`, which sends only the next message as a read-only plan turn
   * through `requestMode` in the submit options. Opt in only when the submit
   * handler honors `requestMode`.
   */
  planCommand?: boolean;
  /** Show the microphone button for voice dictation. Defaults to DEFAULT_VOICE_DICTATION_ENABLED. */
  voiceEnabled?: boolean;
  /** Let an empty draft turn Send into the voice-chat button (default: true). Dictation is unaffected. */
  voiceChatEnabled?: boolean;
  /** Starts voice chat from the empty Send slot in place of the provider's default start. */
  onVoiceChatStart?: () => void;
  /** Selected model override for this conversation */
  selectedModel?: string;
  /** Selected provider engine for this conversation */
  selectedEngine?: string;
  /** Selected effort override for this conversation */
  selectedEffort?: ReasoningEffort;
  /** Show the legacy provider-level Auto model option (default: true). */
  showAutoModelOption?: boolean;
  /** Controlled open state for hosts that resize around the model picker. */
  modelSelectorOpen?: boolean;
  /** Available models grouped by provider */
  availableModels?: Array<{
    engine: string;
    label: string;
    models: string[];
    modelDisplayNames?: Readonly<Record<string, string>>;
    configured: boolean;
    statusLabel?: string;
    isSubscription?: boolean;
  }>;
  /** Whether the model list is still being resolved. */
  modelListLoading?: boolean;
  /** Callback when user picks a model */
  onModelChange?: (model: string, engine: string) => void;
  /** Callback when user picks an effort */
  onEffortChange?: (effort: ReasoningEffort) => void;
  /** Local or hosted agent runtimes shown above the model list. */
  availableAgents?: ComposerAgentOption[];
  /** Selected agent runtime identifier. Defaults to the built-in agent. */
  selectedAgent?: string;
  /** Show only the selected agent in the model control. */
  agentOnly?: boolean;
  /** Mark the selected runtime as the hosted tools-only harness mode. */
  hostedHarness?: boolean;
  /** Callback when the user picks an agent runtime. */
  onAgentChange?: (agent: string) => void;
  /** Called when the shared model picker opens or closes. */
  onModelSelectorOpenChange?: (open: boolean) => void;
  /**
   * Disable Builder/provider status polling for hosts that supply provider
   * state through another channel, such as Electron IPC.
   */
  providerConnectStatusEnabled?: boolean;
  /**
   * Handle the existing-account choice in the Builder chooser in the model
   * picker. "Create and activate" always uses the shared one-click flow.
   */
  onConnectProvider?: () => void;
  /** Route local runtime setup through the host's native bridge. */
  onConnectLocalRuntime?: (engine: string) => void;
  /**
   * A provider setup card is on screen for this composer. The model control
   * then hides while it would only repeat the card's connect choices.
   */
  setupCardVisible?: boolean;
  /**
   * Reports whether the loaded model list offers only connect paths, which
   * is known before the server's readiness check answers.
   */
  onModelConnectionRequiredChange?: (required: boolean) => void;
  /**
   * Optional secondary model menu (e.g. an image-generation model) rendered as
   * an extra section inside the model picker. Opt-in; omit for chat-only apps.
   */
  imageModelMenu?: ComposerImageModelMenu;
  /** Stable scope for persisted drafts, usually the active thread or tab id. */
  draftScope?: string;
  /** Keyed context nuggets staged for the next submitted prompt. */
  contextItems?: readonly AgentChatContextItem[];
  /** Remove a staged context nugget by key. */
  onRemoveContextItem?: (key: string) => void;
  onInspectContextItem?: (key: string) => void;
  onRetryContextItem?: (key: string) => void;
  /** Shared + menu entries; matching IDs replace built-in full-mode actions. */
  contextMenuItems?: readonly ComposerContextMenuItem[];
  /**
   * Controls the "+" menu next to the composer. `"full"` (default) shows the
   * normal Upload / Skill / Job / Automation / MCP picker, plus Extension when
   * `extensionTools` is true. `"upload-only"` provides the shared upload and
   * host-context launcher without full-mode actions. `"hidden"` suppresses
   * the launcher unless the host explicitly provides `contextMenuItems`.
   */
  plusMenuMode?: "full" | "upload-only" | "terminal" | "hidden";
  /** Controls the terminal-specific plus menu when `plusMenuMode` is terminal. */
  terminalModeControl?: ComposerTerminalModeControl;
  /**
   * Include extension creation in the full "+" menu. Defaults to false so
   * apps opt into the extension capability deliberately.
   */
  extensionTools?: boolean;
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
   * size cap) so the host can show it in its own surface. Without it, the
   * composer shows the message inline.
   */
  onAttachmentError?: (message: string) => void;
}

interface TextChip {
  start: number;
  end: number;
  attrs: ReturnType<typeof mentionReferenceAttrs>;
}

function plainTextToDoc(text: string, chips: readonly TextChip[] = []) {
  const ordered = [...chips].sort((a, b) => a.start - b.start);
  const lines: { start: number; end: number }[] = [];
  let lineStart = 0;
  for (const separator of text.matchAll(/\r?\n/g)) {
    lines.push({ start: lineStart, end: separator.index });
    lineStart = separator.index + separator[0].length;
  }
  lines.push({ start: lineStart, end: text.length });
  return {
    type: "doc",
    content: lines.map((line) => {
      const content: Record<string, unknown>[] = [];
      let cursor = line.start;
      const addText = (end: number) => {
        if (end > cursor) {
          content.push({ type: "text", text: text.slice(cursor, end) });
        }
      };
      for (const chip of ordered) {
        if (
          chip.start < cursor ||
          line.end < chip.end ||
          chip.end <= chip.start
        )
          continue;
        addText(chip.start);
        content.push({ type: "mentionReference", attrs: chip.attrs });
        cursor = chip.end;
      }
      addText(line.end);
      // Drafts are reported trimmed, so a chip that ends one lost the space
      // picking it added; without it the next word typed joins the chip's text.
      if (
        cursor === text.length &&
        content.at(-1)?.type === "mentionReference"
      ) {
        content.push({ type: "text", text: " " });
      }
      return { type: "paragraph", content };
    }),
  };
}

/** Tiptap keeps the Editor object truthy after destroy but clears commandManager. */
// The session shell hides its tree with an inline display: none (RequireSession).
function isInsideHiddenShell(element: HTMLElement): boolean {
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    if (node.style?.display === "none") return true;
  }
  return false;
}

export function isComposerEditorUsable<T extends { isDestroyed?: boolean }>(
  editor: T | null | undefined,
): editor is T {
  return Boolean(editor && editor.isDestroyed !== true);
}

export function focusComposerEditorWhenVisible(
  editor: Editor | null | undefined,
): void {
  if (!isComposerEditorUsable(editor)) return;
  const dom = editor.view.dom;
  if (isInsideHiddenShell(dom) && typeof ResizeObserver !== "undefined") {
    let observer: ResizeObserver;
    const disconnect = () => {
      observer.disconnect();
      editor.off("destroy", disconnect);
    };
    observer = new ResizeObserver(() => {
      if (!isComposerEditorUsable(editor)) {
        disconnect();
        return;
      }
      if (isInsideHiddenShell(dom)) return;
      disconnect();
      if (isComposerEditorUsable(editor)) editor.commands.focus("end");
    });
    editor.on("destroy", disconnect);
    observer.observe(dom);
    return;
  }
  editor.commands.focus("end");
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
      showOnlyWhenEditable: false,
    }),
    FileReference,
    SkillReference,
    MentionReference,
  ];
}

const FRIENDLY_MODEL_NAMES: Record<string, string> = {
  auto: "Default model",
  "codex-cli": "Codex",
  "claude-cli": "Claude Code",
  "pi-cli": "Pi",
  "opencode-cli": "OpenCode",
  "claude-fable-5": "Claude Fable 5",
  "claude-fable-5-1": "Claude Fable 5.1",
  "qwen3-coder": "Qwen3 Coder",
  "kimi-k2-5": "Kimi K2.5",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
  "deepseek-v4-1-flash": "DeepSeek V4.1 Flash",
  "deepseek-v3-1": "DeepSeek v3.1",
  "z-ai-glm-4-5": "Z-AI GLM 4.5",
  "z-ai-glm-5-1": "Z-AI GLM 5.1",
  "z-ai-glm-5-3-flash": "Z-AI GLM 5.3 Flash",
  "grok-code-fast": "Grok Code Fast",
  "x-ai/grok-build-0.1": "Grok Build 0.1",
  "gpt-6-1-sol": "GPT-6.1 Sol",
  "gemini-3-1-pro": "Gemini 3.1 Pro",
  "gemini-3-8-flash": "Gemini 3.8 Flash",
  "google/gemini-3.1-pro-preview": "Gemini 3.1 Pro",
  "google/gemini-3.5-flash-lite": "Gemini 3.5 Flash-Lite",
  "google/gemini-3.1-flash-lite": "Gemini 3.1 Flash-Lite",
  "anthropic/claude-haiku-5.5": "Claude Haiku 5.5",
  "deepseek/deepseek-v4-pro": "DeepSeek V4 Pro",
  "deepseek/deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
  "deepseek/deepseek-chat-v3.1": "DeepSeek v3.1",
  "z-ai/glm-4.5": "Z-AI GLM 4.5",
  "z-ai/glm-5.1": "Z-AI GLM 5.1",
  "z-ai/glm-5.3-flash": "Z-AI GLM 5.3 Flash",
  "x-ai/grok-4.7": "Grok 4.7",
  "qwen/qwen3-coder": "Qwen3 Coder",
  "moonshotai/kimi-k2.5": "Kimi K2.5",
  "z-ai/glm-5.2": "GLM 5.2",
  "openai/gpt-6-astra": "GPT-6 Astra",
  "openai/gpt-6-astra-pro": "GPT-6 Astra Pro",
  "gpt-6.1-sol": "GPT-6.1 Sol",
  "gpt-6-luna": "GPT-6 Luna",
  "openai/gpt-6.1-sol": "GPT-6.1 Sol",
  "openai/gpt-6-luna": "GPT-6 Luna",
  "anthropic/claude-opus-5.5": "Claude Opus 5.5",
  "anthropic/claude-sonnet-5.5": "Claude Sonnet 5.5",
  "anthropic/claude-fable-5.1": "Claude Fable 5.1",
  "google/gemini-3.8-flash": "Gemini 3.8 Flash",
  "qwen/qwen3.8-max-0902": "Qwen 3.8 Max",
  "meta/muse-spark-1.3": "Muse Spark 1.3",
  "inception/mercury-2.5": "Mercury 2.5",
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-opus-4-8": "Claude Opus 4.8",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-sonnet-5": "Claude Sonnet 5",
  "gpt-5-4": "GPT-5.4",
  "gpt-5-5": "GPT-5.5",
  "gpt-5-4-mini": "GPT-5.4 Mini",
  "gpt-5-1-codex-mini": "GPT-5.1 Codex Mini",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "gemini-3-5-flash-lite": "Gemini 3.5 Flash-Lite",
  "gemini-3-1-flash-lite": "Gemini 3.1 Flash-Lite",
};

const LOCAL_RUNTIME_ENGINES = new Set([
  "codex-cli",
  "claude-cli",
  "pi-cli",
  "opencode-cli",
]);

export function isLocalRuntimeEngine(engine?: string): boolean {
  return engine !== undefined && LOCAL_RUNTIME_ENGINES.has(engine);
}

export function hasConfiguredCloudProvider(
  groups: ReadonlyArray<{ engine: string; configured: boolean }>,
): boolean {
  return groups.some(
    (group) => group.configured && !isLocalRuntimeEngine(group.engine),
  );
}

function isOpenAiModelId(model: string): boolean {
  const normalizedModel = model.toLowerCase();
  return (
    normalizedModel.startsWith("gpt-") ||
    normalizedModel.startsWith("openai/gpt-")
  );
}

export function isOpenAiModelProviderGroup(group: {
  engine: string;
  label: string;
  models: string[];
}): boolean {
  const engine = group.engine.toLowerCase();
  const label = group.label.toLowerCase();
  if (engine === "codex-cli") {
    return group.models.some(isOpenAiModelId);
  }
  return (
    engine.includes("openai") ||
    label.includes("openai") ||
    group.models.some(isOpenAiModelId)
  );
}

const BUILDER_GROUP_SUFFIX = / · Builder\.io$/i;

// The suffix is the only thing separating Builder.io credits from a group
// billed to the user's own key for the same family, so keep it on collision.
export function modelProviderGroupLabel(
  group: { engine: string; label: string },
  groups: ReadonlyArray<{ engine: string; label: string }>,
): string {
  const short = group.label.replace(BUILDER_GROUP_SUFFIX, "");
  if (short === group.label) return group.label;
  const collides = groups.some(
    (other) =>
      other !== group &&
      other.label.replace(BUILDER_GROUP_SUFFIX, "").toLowerCase() ===
        short.toLowerCase(),
  );
  return collides ? group.label : short;
}

const HARNESS_AGENTS_DOCS_URL =
  "https://www.agent-native.com/docs/harness-agents";

export const MODEL_SELECTOR_POPOVER_STYLE = {
  maxHeight:
    "min(500px, var(--radix-dropdown-menu-content-available-height, 500px))",
} satisfies React.CSSProperties;

type ModelPickerSection = "more" | "effort" | "image" | "agent" | "mode";
const MODEL_PICKER_STACK_BELOW_PX = 544;
// The shared menu primitives as they come; only the stacking order and a
// scrollable height are added, since the composer sits above app overlays.
const MODEL_SELECTOR_MENU_CLASS = "z-[9999] overflow-y-auto";
const MODEL_PICKER_TWO_LINE_ITEM_CLASS = "flex-col items-start gap-0 py-1.5";

/**
 * With nothing connected, every family is a dead "needs API key" row, so the
 * picker shows only the connect CTAs. Never hide the list unless a CTA is
 * there to replace it — an empty popover reads as more broken, not less.
 */
export function shouldShowOnlyConnectPath(
  showBuilderCta: boolean,
  groups: ReadonlyArray<{ configured: boolean }>,
): boolean {
  return showBuilderCta && groups.every((group) => !group.configured);
}

/**
 * When nothing is routable yet, the model hook resolves `selectedModel` to
 * `""` rather than pre-selecting something unusable — that reflects "nothing
 * chosen," not "nothing to show." The picker itself still has a job to do in
 * that state (its connect-provider CTAs). During the initial discovery window
 * the list is empty too, but the button still needs to exist so the picker can
 * reveal its loading or setup state instead of making the composer look
 * incomplete.
 */
export function shouldRenderModelSelector(
  availableModels: ReadonlyArray<unknown> | undefined,
  onModelChange: unknown,
): boolean {
  return Boolean(availableModels && onModelChange);
}

function friendlyModelName(model: string, t?: ComposerTranslate): string {
  if (model === "auto") {
    return (
      t?.("agentChat.composer.defaultModel", {
        defaultValue: "Default model",
      }) ?? "Default model"
    );
  }
  const friendlyName = Object.hasOwn(FRIENDLY_MODEL_NAMES, model)
    ? FRIENDLY_MODEL_NAMES[model]
    : undefined;
  if (friendlyName !== undefined) return friendlyName;
  const normalizedModel = model.replace(/^(?:anthropic|openai|google)\//, "");
  // Claude: claude-{tier}-{major}[-minor][-dateYYYYMMDD].
  const undatedModel = normalizedModel.replace(/-\d{8,}$/, "");
  const claude = undatedModel.match(
    /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:[-.](\d+))?$/,
  );
  if (claude) {
    const tier = claude[1][0].toUpperCase() + claude[1].slice(1);
    return `Claude ${tier} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`;
  }
  // GPT: gpt-{major}[-minor][-variant] → GPT-Major[.Minor] Variant.
  const gpt = normalizedModel.match(/^gpt-(\d+)(?:[.-](\d+))?(?:[.-](.+))?$/);
  if (gpt) {
    const version = `${gpt[1]}${gpt[2] ? `.${gpt[2]}` : ""}`;
    const variant = gpt[3]
      ?.split("-")
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join(" ");
    return `GPT-${version}${variant ? ` ${variant}` : ""}`;
  }
  if (/^o\d/.test(normalizedModel)) return normalizedModel;
  // Gemini: gemini-{version.parts}-{variant}[-preview] → Gemini Version Variant.
  const geminiVersioned = normalizedModel.match(
    /^gemini-(\d+(?:[-.]\d+)+)-(.+?)(?:-preview)?$/,
  );
  if (geminiVersioned) {
    const variant = geminiVersioned[2]
      .split("-")
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join(" ");
    const version = geminiVersioned[1].replace(/-/g, ".");
    return `Gemini ${version} ${variant}`.replace("Flash Lite", "Flash-Lite");
  }
  // Gemini: gemini-{version.parts}[-preview] → Gemini Version Parts
  const gemini = normalizedModel.match(/^gemini-(.+?)(?:-preview)?$/);
  if (gemini) {
    const parts = gemini[1]
      .split("-")
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join(" ");
    return `Gemini ${parts}`;
  }
  return model;
}

export function compactComposerModelName(
  model: string,
  t?: ComposerTranslate,
): string {
  const fullName = friendlyModelName(model, t);
  if (model === "auto" || LOCAL_RUNTIME_ENGINES.has(model)) return fullName;
  if (/^DeepSeek\b/i.test(fullName)) return fullName;
  const shortName = fullName
    .replace(/^GPT-\d+(?:\.\d+)?\s*/i, "")
    .replace(/^Gemini\s+\d+(?:\.\d+)?\s*/i, "")
    .replace(/^Claude\s+/i, "")
    .replace(/^Qwen\s*\d*(?:\.\d+)?\s*/i, "")
    .replace(/^(DeepSeek)\s+v?\d+(?:\.\d+)?/i, "$1")
    .replace(/^Z-AI\s*/i, "")
    .replace(/^Grok\s*/i, "")
    .replace(/\s+[a-z]*\d+(?:\.\d+)*$/i, "")
    .trim();
  return shortName || fullName;
}

function localizedReasoningEffortLabel(
  t: ComposerTranslate,
  effort: ReasoningEffort,
  defaultValue: string,
): string {
  switch (effort) {
    case "auto":
      return t("agentChat.composer.reasoningEffort.auto", { defaultValue });
    case "none":
      return t("agentChat.composer.reasoningEffort.none", { defaultValue });
    case "minimal":
      return t("agentChat.composer.reasoningEffort.minimal", { defaultValue });
    case "low":
      return t("agentChat.composer.reasoningEffort.low", { defaultValue });
    case "medium":
      return t("agentChat.composer.reasoningEffort.medium", { defaultValue });
    case "high":
      return t("agentChat.composer.reasoningEffort.high", { defaultValue });
    case "xhigh":
      return t("agentChat.composer.reasoningEffort.xhigh", { defaultValue });
    case "max":
      return t("agentChat.composer.reasoningEffort.max", { defaultValue });
  }
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

interface ModelPickerRow {
  key: string;
  model: string;
  engine: string;
  label: string;
  /** The card's title: the row's name without a provider suffix. */
  cardName: string;
  /** Marked with the Recommended badge (Auto). */
  recommended?: boolean;
  description?: ComposerModelDescription | undefined;
  identity: string;
  recommendedRank?: number | undefined;
  rootRank?: number | undefined;
  provider?: string | undefined;
}

function useNoLiveModelDescriptions(): undefined {
  return undefined;
}

function ModelSelector({
  model,
  effort,
  engines,
  agents,
  selectedAgent,
  selectedEngine,
  agentOnly = false,
  hostedHarness = false,
  showAutoModelOption = true,
  modelListLoading = false,
  open: controlledOpen,
  onChange,
  onEffortChange,
  onAgentChange,
  onModelSelectorOpenChange,
  providerConnectStatusEnabled = true,
  onConnectProvider,
  onConnectLocalRuntime,
  terminalModeControl,
  imageModel,
  setupCardVisible = false,
  onConnectionRequiredChange,
}: {
  model: string;
  selectedEngine?: string;
  effort?: ReasoningEffort;
  agents?: ComposerAgentOption[];
  selectedAgent?: string;
  hostedHarness?: boolean;
  engines: Array<{
    engine: string;
    label: string;
    models: string[];
    modelDisplayNames?: Readonly<Record<string, string>>;
    configured: boolean;
    statusLabel?: string;
    isSubscription?: boolean;
  }>;
  agentOnly?: boolean;
  showAutoModelOption?: boolean;
  modelListLoading?: boolean;
  onChange: (model: string, engine: string) => void;
  onEffortChange?: (effort: ReasoningEffort) => void;
  onAgentChange?: (agent: string) => void;
  providerConnectStatusEnabled?: boolean;
  onConnectProvider?: () => void;
  onConnectLocalRuntime?: (engine: string) => void;
  terminalModeControl?: ComposerTerminalModeControl;
  onModelSelectorOpenChange?: (open: boolean) => void;
  imageModel?: ComposerImageModelMenu;
  open?: boolean;
  setupCardVisible?: boolean;
  onConnectionRequiredChange?: (required: boolean) => void;
}) {
  const adapters = useComposerRuntimeAdapters();
  const t = adapters.translate;
  const formatNumber = adapters.formatNumber;
  const reasoning = adapters.models?.reasoning;
  const engineNames = useMemo(
    () => engines.map((group) => group.engine),
    [engines],
  );
  const useLiveDescribe =
    adapters.models?.useDescribeModel ?? useNoLiveModelDescriptions;
  const describeModel =
    useLiveDescribe(engineNames) ?? adapters.models?.describe;
  const defaultEffort = reasoning?.defaultEffort ?? DEFAULT_REASONING_EFFORT;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const isClaudeCodeAgent = isClaudeCodeAgentId(selectedAgent);
  const autoModelGroup = showAutoModelOption
    ? isClaudeCodeAgent
      ? undefined
      : engines.find((group) => group.models.includes("auto"))
    : undefined;
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
  const isCodexAgent =
    selectedAgent === "codex" || selectedAgent === "codex-cli";
  const modelProviderGroups = useMemo(() => {
    const hasCodexLocalGroup = providerGroups.some(
      (group) => group.engine === "codex-cli",
    );
    const groups = providerGroups.flatMap((group) => {
      if (group.engine === "claude-cli") {
        return isClaudeCodeAgent ? [group] : [];
      }
      if (group.engine === "codex-cli") {
        return isCodexAgent && isOpenAiModelProviderGroup(group) ? [group] : [];
      }
      if (
        isCodexAgent &&
        hasCodexLocalGroup &&
        group.engine === "ai-sdk:openai"
      ) {
        return [];
      }
      if (LOCAL_RUNTIME_ENGINES.has(group.engine)) return [];
      if (!isCodexAgent) return [group];
      if (!isOpenAiModelProviderGroup(group)) return [];

      const isExplicitOpenAiProvider =
        group.engine.toLowerCase().includes("openai") ||
        group.label.toLowerCase().includes("openai");
      const models = isExplicitOpenAiProvider
        ? group.models
        : group.models.filter(isOpenAiModelId);
      return models.length > 0 ? [{ ...group, models }] : [];
    });
    return filterModelGroupsForAgent(selectedAgent, groups);
  }, [isClaudeCodeAgent, isCodexAgent, providerGroups, selectedAgent]);
  const preferredAgentModel = useMemo(
    () => resolvePreferredAgentModel(selectedAgent, modelProviderGroups),
    [modelProviderGroups, selectedAgent],
  );
  const selectedModelIsAvailable = modelProviderGroups.some(
    (group) =>
      group.models.includes(model) &&
      (selectedEngine === undefined || group.engine === selectedEngine),
  );
  useEffect(() => {
    if (
      !isClaudeCodeAgent ||
      selectedModelIsAvailable ||
      !preferredAgentModel
    ) {
      return;
    }
    onChange(preferredAgentModel.model, preferredAgentModel.engine);
  }, [
    isClaudeCodeAgent,
    onChange,
    preferredAgentModel,
    selectedModelIsAvailable,
  ]);
  const effortOptionsFor = useCallback(
    (candidate: string, engine: string | undefined): ReasoningEffort[] =>
      describeModel
        ? describeModel(candidate, engine).efforts
        : (reasoning?.getOptionsForModel?.(candidate) ??
          getComposerReasoningEffortOptions(candidate)),
    [describeModel, reasoning],
  );
  const effortOptions = agentOnly
    ? []
    : effortOptionsFor(model, selectedEngine);
  const resolveEffort = (candidate: string, value?: ReasoningEffort) =>
    reasoning?.resolve?.(candidate, value) ??
    resolveReasoningEffortSelection(candidate, value);
  const selectedEffort = resolveEffort(model, effort ?? defaultEffort);
  const effortLabel = useCallback(
    (value: ReasoningEffort) =>
      localizedReasoningEffortLabel(
        t,
        value,
        (reasoning?.label ?? reasoningEffortLabel)(value),
      ),
    [reasoning?.label, t],
  );
  const selectedAgentOption = agents?.find(
    (agent) => agent.id === (selectedAgent ?? "default"),
  );
  const selectedAgentLabel = selectedAgentOption?.label ?? "Default";

  const [openSection, setOpenSection] = useState<ModelPickerSection | null>(
    null,
  );
  const [highlightedRow, setHighlightedRow] = useState<string | null>(null);
  const [moreSide, setMoreSide] = useState<"left" | "right">("right");
  const sectionTriggerRefs = useRef<
    Partial<Record<ModelPickerSection, HTMLDivElement | null>>
  >({});

  const setPickerOpen = useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(nextOpen);
      if (!nextOpen) {
        setOpenSection(null);
        setHighlightedRow(null);
      }
      onModelSelectorOpenChange?.(nextOpen);
    },
    [controlledOpen, onModelSelectorOpenChange],
  );

  // Keep setup actions visible, but do not show unusable model rows until one
  // provider or local agent is ready.
  const builderFlow = adapters.builder!.useConnectFlow!({
    enabled: providerConnectStatusEnabled,
    provisionAccount: true,
    trackingSource: "composer_builder_cta",
  });
  const BuilderConnectPopover = adapters.builder?.BuilderConnectPopover;
  const hasConfiguredBuilderModels = providerGroups.some(
    (group) => group.engine === "builder" && group.configured,
  );
  const hasConfiguredCloudProviderReady =
    hasConfiguredCloudProvider(providerGroups);
  const hasConnectedSubscription = providerGroups.some(
    (group) =>
      hasConfiguredCloudProviderReady &&
      group.configured &&
      group.isSubscription &&
      !LOCAL_RUNTIME_ENGINES.has(group.engine),
  );
  const hasUnconfiguredVisibleModels = modelProviderGroups.some(
    (group) => !group.configured,
  );
  const hasConfiguredProvider = providerGroups.some(
    (group) => group.configured,
  );
  const showBuilderAction =
    !isClaudeCodeAgent &&
    !hasConfiguredCloudProviderReady &&
    (Boolean(onConnectProvider) ||
      (providerConnectStatusEnabled &&
        !builderFlow.configured &&
        !builderFlow.envManaged &&
        !hasConfiguredBuilderModels &&
        !hasConnectedSubscription));
  const showAddKeysAction =
    !isClaudeCodeAgent &&
    !hasConfiguredCloudProviderReady &&
    (hasUnconfiguredVisibleModels || showBuilderAction);
  const showProviderActions = showBuilderAction || showAddKeysAction;
  const onlyConnectPathAvailable = shouldShowOnlyConnectPath(
    showProviderActions,
    providerGroups,
  );
  // Only engines this person can run right now contribute rows; connecting a
  // provider stays on the setup card and in settings.
  const availableGroups = useMemo(
    () => modelProviderGroups.filter((group) => group.configured),
    [modelProviderGroups],
  );
  const modelRows = useMemo(() => {
    const entries = availableGroups.flatMap((group) =>
      group.models.map(
        (candidate): { group: typeof group; row: ModelPickerRow } => {
          const description = describeModel?.(candidate, group.engine);
          const label =
            group.modelDisplayNames?.[candidate] ??
            description?.shortName ??
            friendlyModelName(candidate, t);
          return {
            group,
            row: {
              key: `${group.engine}\u0000${candidate}`,
              model: candidate,
              engine: group.engine,
              label,
              cardName: label,
              description,
              identity: description?.catalogId ?? candidate,
              recommendedRank: description?.recommended
                ? description.recommendedRank
                : undefined,
              rootRank: description?.rootRank,
              provider: description?.provider,
            },
          };
        },
      ),
    );
    // One model on two engines (Builder credits and a personal key) reads the
    // same; the provider suffix is what tells the rows apart.
    const labelCounts = new Map<string, number>();
    for (const { row } of entries) {
      labelCounts.set(row.label, (labelCounts.get(row.label) ?? 0) + 1);
    }
    return entries.map(({ group, row }) => {
      if ((labelCounts.get(row.label) ?? 0) < 2) return row;
      return {
        ...row,
        label: `${row.label} · ${modelProviderGroupLabel(group, availableGroups)}`,
      };
    });
  }, [availableGroups, describeModel, t]);
  const curatedRows = useMemo(
    () => curateModelPickerRows(modelRows),
    [modelRows],
  );
  const autoRow: ModelPickerRow | undefined =
    autoModelGroup?.configured && !isClaudeCodeAgent
      ? (() => {
          const description = describeModel?.("auto", autoModelGroup.engine);
          return {
            key: "auto",
            model: "auto",
            engine: autoModelGroup.engine,
            label: t("agentChat.composer.auto", { defaultValue: "Auto" }),
            cardName: t("agentChat.composer.auto", { defaultValue: "Auto" }),
            recommended: description?.recommended === true,
            description,
            identity: "auto",
          };
        })()
      : undefined;

  const selectedModelProviderGroups = modelProviderGroups.filter(
    (group) =>
      group.models.includes(model) &&
      (!selectedEngine || group.engine === selectedEngine),
  );
  const selectedModelDisplayName = selectedModelProviderGroups
    .map((group) => group.modelDisplayNames?.[model])
    .find((displayName) => typeof displayName === "string");
  const selectedModelDescription =
    model === "auto"
      ? autoRow?.description
      : describeModel?.(model, selectedEngine);
  // With no level chosen the provider's own default applies; name it when
  // the catalog or the provider says what it is.
  const providerDefaultEffort = selectedModelDescription?.providerDefaultEffort;
  const effectiveEffort =
    selectedEffort === "auto" ? providerDefaultEffort : selectedEffort;
  const effortValueLabel = effortLabel(effectiveEffort ?? "auto");
  const selectedModelFriendlyName =
    selectedModelDisplayName ??
    selectedModelDescription?.name ??
    friendlyModelName(model, t);
  const selectedModelNeedsConnection =
    onlyConnectPathAvailable ||
    (selectedModelProviderGroups.length > 0 &&
      selectedModelProviderGroups.every((group) => !group.configured));
  // Only a loaded list that names providers, none of them connected, means
  // setup. A selected model on an unconnected provider still has others, and
  // an empty list is a catalog that failed to load, not proof of anything.
  const connectionRequired =
    onlyConnectPathAvailable && !modelListLoading && providerGroups.length > 0;
  useEffect(() => {
    onConnectionRequiredChange?.(connectionRequired);
  }, [connectionRequired, onConnectionRequiredChange]);
  useEffect(
    () => () => onConnectionRequiredChange?.(false),
    [onConnectionRequiredChange],
  );
  // One connect label on every surface: hosts differ in which connect paths
  // they offer, and the picker lists those paths.
  const selectedModelButtonLabel = selectedModelNeedsConnection
    ? t("agentChat.composer.connectAgent", { defaultValue: "Connect agent" })
    : model === "auto" && autoRow
      ? autoRow.label
      : (selectedModelDisplayName ??
        selectedModelDescription?.shortName ??
        selectedModelFriendlyName);
  const openLlmSettings = useCallback(() => {
    try {
      window.location.hash = "llm";
    } catch {
      // coercion-ok: browser storage is optional and can be unavailable or full.
    }
    window.dispatchEvent(new CustomEvent("agent-panel:open-settings"));
    setPickerOpen(false);
  }, [setPickerOpen]);
  const connectLocalRuntime = useCallback(
    (engine: string) => {
      onConnectLocalRuntime?.(engine);
      setPickerOpen(false);
    },
    [onConnectLocalRuntime, setPickerOpen],
  );

  const hasAgentSection = Boolean(agents && agents.length > 0);
  // The setup card is the one setup path; a chip offering the same two
  // choices beside it reads as a second, competing one.
  if (
    setupCardVisible &&
    selectedModelNeedsConnection &&
    !hasAgentSection &&
    !terminalModeControl
  ) {
    return null;
  }

  // Two menus side by side need about 34rem; below that a submenu cannot
  // clear the viewport on either side, so the sections stack in one menu and
  // the model card, which needs the same room, stays hidden.
  const stacked =
    open &&
    typeof window !== "undefined" &&
    window.innerWidth < MODEL_PICKER_STACK_BELOW_PX;

  const connectItems = showProviderActions ? (
    <>
      {showBuilderAction && BuilderConnectPopover ? (
        <>
          <BuilderConnectPopover
            flow={builderFlow}
            onConnect={(provisionAccount) => {
              if (onConnectProvider && !provisionAccount) {
                onConnectProvider();
              } else {
                builderFlow.start({ provisionAccount });
              }
            }}
          >
            <DropdownMenuItem
              disabled={builderFlow.connecting}
              // The Builder choice opens its own popover from this row.
              onSelect={(event) => event.preventDefault()}
              className={MODEL_PICKER_TWO_LINE_ITEM_CLASS}
            >
              <span className="block font-medium text-foreground">
                {builderFlow.connecting
                  ? t("agentPanel.connectingBuilder", {
                      defaultValue: "Setting up Builder.io…",
                    })
                  : t("agentPanel.connectBuilderIo", {
                      defaultValue: "Use Builder.io",
                    })}
              </span>
              <span className="block agent-kit-caption-copy text-muted-foreground">
                {t("agentPanel.builderModelCredits", {
                  defaultValue: "Free credits for Claude, OpenAI & Gemini",
                })}
              </span>
            </DropdownMenuItem>
          </BuilderConnectPopover>
          {!onConnectProvider && builderFlow.error && (
            <p
              role="alert"
              className="px-2 pb-2 agent-kit-caption-copy text-destructive"
            >
              {builderFlow.error}
            </p>
          )}
        </>
      ) : null}
      {showAddKeysAction && (
        <DropdownMenuItem
          onSelect={openLlmSettings}
          className={MODEL_PICKER_TWO_LINE_ITEM_CLASS}
        >
          <span className="block font-medium text-foreground">
            {t("agentPanel.addOwnKeys", {
              defaultValue: "Add your own keys",
            })}
          </span>
          <span className="block agent-kit-caption-copy text-muted-foreground">
            {t("agentPanel.configureProviderKeys", {
              defaultValue: "Choose a cloud, gateway, or local provider",
            })}
          </span>
        </DropdownMenuItem>
      )}
    </>
  ) : null;

  const agentItems = hasAgentSection ? (
    <>
      <DropdownMenuRadioGroup
        value={selectedAgent ?? "default"}
        onValueChange={(value) => {
          onAgentChange?.(value);
          setPickerOpen(false);
        }}
      >
        {agents?.map((agent) => {
          const isConfigured = agent.configured !== false;
          const canConnect = !isConfigured && Boolean(onConnectLocalRuntime);
          const statusLabel =
            agent.statusLabel ?? (!isConfigured ? "Unavailable" : undefined);
          const item = isConfigured ? (
            <DropdownMenuRadioItem
              key={agent.id}
              value={agent.id}
              indicator="check"
              disabled={!onAgentChange}
            >
              <span className="min-w-0 flex-1 truncate">{agent.label}</span>
            </DropdownMenuRadioItem>
          ) : (
            <DropdownMenuItem
              key={agent.id}
              inset
              disabled={!canConnect}
              onSelect={() => connectLocalRuntime(agent.id)}
              className="text-muted-foreground"
            >
              <span className="min-w-0 flex-1 truncate">{agent.label}</span>
              {statusLabel ? (
                <span className="ms-auto max-w-[6rem] shrink-0 truncate agent-kit-micro-copy text-muted-foreground/70">
                  {statusLabel}
                </span>
              ) : null}
            </DropdownMenuItem>
          );
          return agent.description ? (
            <Tooltip key={agent.id}>
              <TooltipTrigger asChild>{item}</TooltipTrigger>
              <TooltipContent
                side="left"
                className="max-w-xs"
                onEscapeKeyDown={() => setPickerOpen(false)}
              >
                {agent.description}
              </TooltipContent>
            </Tooltip>
          ) : (
            item
          );
        })}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator className="my-1" />
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuItem asChild inset>
            <a href={HARNESS_AGENTS_DOCS_URL} target="_blank" rel="noreferrer">
              {t("agentChat.composer.learnMoreHarnessAgents", {
                defaultValue: "Learn more about harness agents",
              })}
            </a>
          </DropdownMenuItem>
        </TooltipTrigger>
        <TooltipContent
          side="left"
          className="max-w-xs"
          onEscapeKeyDown={() => setPickerOpen(false)}
        >
          {hostedHarness
            ? t("agentChat.composer.hostedHarnessDescription", {
                defaultValue:
                  "Hosted mode uses app tools only. For full coding with a repository and shell, use Agent-Native Desktop.",
              })
            : t("agentChat.composer.harnessAgentDescription", {
                defaultValue:
                  "Harnesses run their own coding loop and local tools.",
              })}
        </TooltipContent>
      </Tooltip>
    </>
  ) : null;

  const selectModel = (m: string, engine: string) => {
    onChange(m, engine);
    const nextOptions = effortOptionsFor(m, engine);
    if (
      selectedEffort !== "auto" &&
      nextOptions.length > 0 &&
      !nextOptions.includes(selectedEffort)
    ) {
      onEffortChange?.(defaultEffort);
    }
    setPickerOpen(false);
  };

  const isSelectedRow = (row: ModelPickerRow) =>
    row.model === model &&
    (row.model === "auto" || !selectedEngine || row.engine === selectedEngine);

  const renderModelRow = (
    row: ModelPickerRow,
    cardSide: "left" | "right",
    options: { shortcut?: number; section?: ModelPickerSection } = {},
  ) => {
    const { shortcut, section } = options;
    const selected = isSelectedRow(row);
    const details = hasModelDetails(row.description)
      ? row.description
      : undefined;
    const cardOpen = !stacked && details && highlightedRow === row.key;
    const cardId = `${row.key}-card`;
    const item = (
      <DropdownMenuItem
        key={row.key}
        role="menuitemradio"
        aria-checked={selected}
        aria-describedby={cardOpen ? cardId : undefined}
        data-agent-composer-model-row={row.model}
        onSelect={() => selectModel(row.model, row.engine)}
        onFocus={(event) => {
          setHighlightedRow(row.key);
          // A submenu row's card goes on the far side of its submenu.
          const side = event.currentTarget
            .closest("[data-agent-composer-model-panel]")
            ?.getAttribute("data-side");
          if (side === "left" || side === "right") setMoreSide(side);
        }}
        onBlur={() =>
          setHighlightedRow((current) => (current === row.key ? null : current))
        }
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate">{row.label}</span>
          {row.recommended ? <RecommendedBadge t={t} /> : null}
        </span>
        {shortcut !== undefined ? (
          // One trailing column: the current row's check takes the place of
          // its number, at the same width, so no row shifts.
          <DropdownMenuShortcut>
            {selected ? <IconCheck aria-hidden="true" /> : shortcut}
          </DropdownMenuShortcut>
        ) : (
          <DropdownMenuTrailing>
            {selected ? <IconCheck aria-hidden="true" /> : null}
          </DropdownMenuTrailing>
        )}
      </DropdownMenuItem>
    );
    if (!details || stacked) return item;
    return (
      <Popover key={row.key} open={Boolean(cardOpen)}>
        <PopoverAnchor asChild>{item}</PopoverAnchor>
        <PopoverContent
          id={cardId}
          role="tooltip"
          side={cardSide}
          align="start"
          sideOffset={8}
          collisionPadding={8}
          // The card describes the focused row; focus stays in the menu.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          // The card is the top layer, so it receives the Escape meant for
          // the menu under it: close that menu, one level at a time.
          onEscapeKeyDown={(event) => {
            if (!section) {
              setPickerOpen(false);
              return;
            }
            event.preventDefault();
            setHighlightedRow(null);
            setOpenSection(null);
            sectionTriggerRefs.current[section]?.focus();
          }}
          data-agent-native-composer-popover="true"
          className="pointer-events-none z-[9999]"
        >
          <ModelDetailsCard
            name={row.cardName}
            description={details}
            t={t}
            formatNumber={formatNumber}
          />
        </PopoverContent>
      </Popover>
    );
  };

  const showModelList =
    !agentOnly && hasConfiguredProvider && !onlyConnectPathAvailable;
  const shortcutRows = showModelList
    ? [...(autoRow ? [autoRow] : []), ...curatedRows.main].slice(0, 9)
    : [];
  const moreRows = showModelList ? curatedRows.more : [];

  const primaryItems = (
    <>
      {connectItems}
      {hasConfiguredProvider &&
        isCodexAgent &&
        !modelListLoading &&
        !onlyConnectPathAvailable &&
        modelProviderGroups.length === 0 && (
          <DropdownMenuItem
            inset
            onSelect={openLlmSettings}
            className="text-muted-foreground"
          >
            <span className="min-w-0 flex-1 truncate">
              {t("agentChat.composer.noOpenAiModels", {
                defaultValue: "No OpenAI models configured",
              })}
            </span>
            <span className="shrink-0 agent-kit-caption-copy text-muted-foreground/70">
              Configure
            </span>
          </DropdownMenuItem>
        )}
      {shortcutRows.map((row, index) =>
        renderModelRow(row, "left", { shortcut: index + 1 }),
      )}
    </>
  );

  const moreItems =
    moreRows.length > 0 ? (
      <>
        {moreRows.map((row) =>
          renderModelRow(row, moreSide, stacked ? {} : { section: "more" }),
        )}
      </>
    ) : null;

  const imageItems =
    hasConfiguredCloudProviderReady &&
    imageModel &&
    imageModel.options.length > 0 ? (
      <DropdownMenuRadioGroup
        value={imageModel.value}
        onValueChange={(value) => {
          imageModel.onChange(value);
          setPickerOpen(false);
        }}
      >
        {imageModel.options.map((option) => (
          <DropdownMenuRadioItem
            key={option.value}
            value={option.value}
            indicator="check"
          >
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    ) : null;

  const modeItems = terminalModeControl ? (
    <DropdownMenuRadioGroup
      value={terminalModeControl.enabled ? "cli" : "ui"}
      onValueChange={(value) => {
        terminalModeControl.onChange(value === "cli");
        setPickerOpen(false);
      }}
    >
      <DropdownMenuRadioItem value="ui" indicator="check">
        {t("agentPanel.uiMode", { defaultValue: "UI" })}
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="cli" indicator="check">
        {t("agentPanel.cli", { defaultValue: "CLI" })}
      </DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  ) : null;

  const effortItems =
    effortOptions.length > 0 && showModelList
      ? effortOptions.map((level) => {
          const selected = level === effectiveEffort;
          return (
            <DropdownMenuItem
              key={level}
              role="menuitemradio"
              aria-checked={selected}
              data-agent-composer-effort-level={level}
              onSelect={() => {
                // Picking the provider's default goes back to sending none,
                // so the level follows the provider if its default changes.
                onEffortChange?.(
                  level === providerDefaultEffort ? "auto" : level,
                );
                setPickerOpen(false);
              }}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate">{effortLabel(level)}</span>
                {level === providerDefaultEffort ? (
                  <RecommendedBadge t={t} />
                ) : null}
              </span>
              <DropdownMenuTrailing>
                {selected ? <IconCheck aria-hidden="true" /> : null}
              </DropdownMenuTrailing>
            </DropdownMenuItem>
          );
        })
      : null;

  const sections: Array<{
    key: ModelPickerSection;
    label: string;
    value?: string | undefined;
    content: React.ReactNode;
  }> = [];
  if (moreItems) {
    sections.push({
      key: "more",
      label: t("agentChat.composer.moreModels", {
        defaultValue: "More models",
      }),
      content: moreItems,
    });
  }
  if (effortItems) {
    sections.push({
      key: "effort",
      label: t("agentChat.composer.effort", { defaultValue: "Effort" }),
      value: effortValueLabel,
      content: effortItems,
    });
  }
  if (imageItems && imageModel) {
    sections.push({
      key: "image",
      label:
        imageModel.label ??
        t("agentChat.composer.imageModel", { defaultValue: "Image model" }),
      value: imageModel.options.find(
        (option) => option.value === imageModel.value,
      )?.label,
      content: imageItems,
    });
  }
  if (agentItems && !agentOnly) {
    sections.push({
      key: "agent",
      label: t("agentChat.composer.agentSection", { defaultValue: "Agent" }),
      value: selectedAgentLabel,
      content: agentItems,
    });
  }
  if (modeItems && terminalModeControl) {
    sections.push({
      key: "mode",
      label: t("agentPanel.mode", { defaultValue: "Mode" }),
      value: terminalModeControl.enabled
        ? t("agentPanel.cli", { defaultValue: "CLI" })
        : t("agentPanel.uiMode", { defaultValue: "UI" }),
      content: modeItems,
    });
  }

  const moreSection = sections.find((section) => section.key === "more");
  const otherSections = sections.filter((section) => section.key !== "more");
  const renderSection = (
    section: (typeof sections)[number],
    leading: boolean,
  ) =>
    stacked ? (
      <DropdownMenuGroup
        key={section.key}
        data-agent-composer-model-group={section.key}
      >
        {leading || section !== otherSections[0] ? (
          <DropdownMenuSeparator className="my-1" />
        ) : null}
        <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
        {section.content}
      </DropdownMenuGroup>
    ) : (
      <DropdownMenuSub
        key={section.key}
        open={openSection === section.key}
        onOpenChange={(nextOpen) =>
          setOpenSection((current) =>
            nextOpen ? section.key : current === section.key ? null : current,
          )
        }
      >
        <DropdownMenuSubTrigger
          ref={(node) => {
            sectionTriggerRefs.current[section.key] = node;
          }}
          data-agent-composer-model-section={section.key}
        >
          <span className="min-w-0 flex-1 truncate">{section.label}</span>
          {section.value ? (
            <DropdownMenuShortcut>{section.value}</DropdownMenuShortcut>
          ) : null}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          sideOffset={4}
          alignOffset={-4}
          collisionPadding={8}
          data-agent-native-composer-popover="true"
          data-agent-composer-model-panel={section.key}
          // One Escape closes this submenu and returns to its row; the next
          // closes the picker.
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            setOpenSection(null);
            sectionTriggerRefs.current[section.key]?.focus();
          }}
          className={MODEL_SELECTOR_MENU_CLASS}
          style={MODEL_SELECTOR_POPOVER_STYLE}
        >
          {section.content}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );

  const hasPrimaryItems = Boolean(connectItems) || shortcutRows.length > 0;
  const showEffortInLabel =
    effortOptions.length > 0 &&
    !selectedModelNeedsConnection &&
    effectiveEffort !== undefined &&
    effectiveEffort !== "auto";

  return (
    <DropdownMenu open={open} onOpenChange={setPickerOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-agent-composer-slot="model-button"
          // Screen readers in browse mode activate with a bare click,
          // which the menu trigger ignores because it opens on pointer
          // down.
          onClick={(event) => {
            if (event.detail === 0) setPickerOpen(!open);
          }}
          aria-label={`${
            selectedAgentOption && selectedAgentOption.id !== "default"
              ? t("agentChat.composer.modelButtonWithAgent", {
                  defaultValue: "{{model}}. Agent: {{agent}}",
                  model: `${t("agentChat.composer.model", {
                    defaultValue: "Model",
                  })}: ${selectedModelButtonLabel}`,
                  agent: selectedAgentLabel,
                })
              : `${t("agentChat.composer.model", {
                  defaultValue: "Model",
                })}: ${selectedModelButtonLabel}`
          }${
            effortOptions.length > 0 && !selectedModelNeedsConnection
              ? `. ${t("agentChat.composer.effort", {
                  defaultValue: "Effort",
                })}: ${effortValueLabel}`
              : ""
          }`}
          className="agent-composer-model-button flex min-w-[var(--agentkit-composer-model-min-width,min(8rem,100%))] max-w-[var(--agentkit-composer-model-max-width,none)] shrink items-center gap-1 overflow-hidden rounded-[var(--agentkit-composer-control-radius,var(--radius-md))] px-[var(--agentkit-composer-toolbar-control-padding-inline,0.5rem)] py-1 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          <span className="agent-composer-model-name min-w-0 truncate text-foreground">
            {selectedAgentOption?.icon ? (
              <span className="me-1 inline-flex shrink-0 align-middle text-muted-foreground">
                {selectedAgentOption.icon}
              </span>
            ) : null}
            {selectedAgentOption && selectedAgentOption.id !== "default"
              ? selectedAgentLabel
              : selectedModelButtonLabel}
          </span>
          {showEffortInLabel && (
            <span className="agent-composer-model-effort shrink-0 text-muted-foreground">
              {effortLabel(effectiveEffort)}
            </span>
          )}
          <IconChevronDown
            aria-hidden="true"
            className="h-4 w-4 shrink-0 opacity-60"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        sideOffset={6}
        collisionPadding={8}
        data-agent-native-composer-popover="true"
        className={MODEL_SELECTOR_MENU_CLASS}
        style={MODEL_SELECTOR_POPOVER_STYLE}
        onKeyDown={(event) => {
          if (
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            !/^[1-9]$/.test(event.key) ||
            !event.currentTarget.contains(event.target as Node)
          ) {
            return;
          }
          const row = shortcutRows.at(Number(event.key) - 1);
          if (!row) return;
          event.preventDefault();
          selectModel(row.model, row.engine);
        }}
      >
        {agentOnly ? (
          agentItems
        ) : (
          <>
            {primaryItems}
            {moreSection ? renderSection(moreSection, true) : null}
            {otherSections.length > 0 && (hasPrimaryItems || moreSection) ? (
              <DropdownMenuSeparator className="my-1" />
            ) : null}
            {otherSections.map((section) => renderSection(section, false))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type PopoverState = {
  type: "@" | "/";
  position: { top: number; left: number; width?: number };
  startPos: number;
  query: string;
} | null;

/**
 * Held by each submit phase. Once a phase's draft has fully left the editor,
 * what is in the editor is a different message: it can be sent, and it queues
 * behind the one in flight.
 */
type ComposerSubmitLock = { draftReleased: boolean };

function composerSubmitOrder(
  locks: ReadonlySet<ComposerSubmitLock>,
): "free" | "behind" | "blocked" {
  let order: "free" | "behind" = "free";
  for (const lock of locks) {
    if (!lock.draftReleased) return "blocked";
    order = "behind";
  }
  return order;
}

const POPOVER_TOKEN_LEAF = "\ufffc";

/**
 * The typed "@" or "/" token, read from the document at pick time. The menu
 * opens a task after its key and its query trails fast typing, so neither its
 * anchor nor its query is a reliable bound on what is in the editor.
 */
function popoverTokenRange(
  editor: Pick<Editor, "state">,
  trigger: "@" | "/",
): { from: number; to: number } {
  const { state } = editor;
  const to = state.selection.from;
  const $to = state.doc.resolve(to);
  if (!$to.parent.isTextblock) return { from: to, to };
  const blockStart = $to.start();
  // One character per inline leaf keeps string offsets equal to positions.
  const before = state.doc.textBetween(
    blockStart,
    to,
    undefined,
    POPOVER_TOKEN_LEAF,
  );
  for (let index = before.length - 1; index >= 0; index -= 1) {
    if (before[index] !== trigger) continue;
    const previous = index === 0 ? undefined : before.charAt(index - 1);
    if (
      previous === undefined ||
      previous === POPOVER_TOKEN_LEAF ||
      /\s/.test(previous)
    ) {
      return { from: blockStart + index, to };
    }
  }
  return { from: to, to };
}

export function TiptapComposer(props: TiptapComposerProps) {
  // The provider sits above the composer body so the editor can follow
  // voice chat: it locks while a session owns the conversation.
  return (
    <RealtimeVoiceModeBoundary>
      <TiptapComposerSurface {...props} />
    </RealtimeVoiceModeBoundary>
  );
}

function TiptapComposerSurface({
  placeholder,
  replyPlaceholder,
  conversationStarted = false,
  ariaLabel,
  disabled = false,
  isReferenceTarget,
  contextControlsDisabled = false,
  submissionDisabled = false,
  sendButtonDisabled = false,
  sendButtonBusy = false,
  submitting = false,
  maxDocumentAttachmentBytes = MAX_DOCUMENT_ATTACHMENT_BYTES,
  documentAttachmentLimitLabel = "PDFs",
  attachmentsEnabled = true,
  onAttachmentRequest,
  contextButtonTooltipDisabled = false,
  focusRef,
  initialText,
  initialTextKey,
  initialReferences,
  onSubmit,
  onEmptySubmit,
  onBeforeSubmit,
  onSubmissionPendingChange,
  onSubmitStart,
  onOptimisticAttachmentsChange,
  getSubmitFailureDraftScope,
  clearOnSubmit = true,
  clearOnSubmitImmediately = false,
  onTextChange,
  actionButton,
  willQueue = false,
  queuesBehindSubmission = false,
  extraActionButton,
  stopButton,
  attachButton,
  modeControl,
  toolbarSlot,
  contextUsageSlot,
  headerSlot,
  layoutVariant = "default",
  slashCommands = [],
  slashSkills = [],
  includeDefaultSlashCommands = true,
  includeDefaultSlashSkills = true,
  onSlashCommand,
  planCommand = false,
  voiceEnabled = DEFAULT_VOICE_DICTATION_ENABLED,
  voiceChatEnabled = true,
  onVoiceChatStart,
  selectedModel,
  selectedEngine,
  selectedEffort,
  showAutoModelOption = true,
  modelSelectorOpen,
  availableModels,
  modelListLoading,
  onModelChange,
  onEffortChange,
  availableAgents,
  selectedAgent,
  agentOnly = false,
  hostedHarness,
  onAgentChange,
  onModelSelectorOpenChange,
  providerConnectStatusEnabled,
  onConnectProvider,
  onConnectLocalRuntime,
  setupCardVisible = false,
  onModelConnectionRequiredChange,
  imageModelMenu,
  draftScope,
  contextItems: providedContextItems,
  onRemoveContextItem,
  onRetryContextItem,
  contextMenuItems,
  plusMenuMode = "full",
  terminalModeControl,
  extensionTools = false,
  interceptBuildRequestsForBuilder = false,
  onAttachmentError,
  mentionItems: hostMentionItems = [],
  mentionItemsError,
  onRetryMentionItems,
  mentionPopoverDensity = "default",
  includeDefaultMentionSearch = true,
  onReferencesChange,
  onEscape,
  onRecallLastMessage,
  onFocus,
  onBlur,
  onSelectionChange,
}: TiptapComposerProps) {
  const contextItems = providedContextItems ?? [];
  const hasContextMenu =
    (contextMenuItems !== undefined || plusMenuMode !== "hidden") &&
    !(attachmentsEnabled && attachButton);
  const adapters = useComposerRuntimeAdapters();
  const t = adapters.translate!;
  const realtimeVoice = useRealtimeVoiceModeOptional();
  const realtimeVoiceCopy = useRealtimeVoiceModeCopy();
  const voiceChat =
    voiceEnabled && voiceChatEnabled && realtimeVoice?.active
      ? realtimeVoice
      : null;
  // The realtime session has no text input, so a typed draft would start a
  // separate run the voice agent never hears.
  const editorLocked = disabled || voiceChat !== null;
  const initialReferencesRef = useRef(initialReferences);
  initialReferencesRef.current = initialReferences;
  const textChips = useCallback(
    (references: readonly ComposerTextReference[] = []): TextChip[] =>
      references.flatMap(({ start, end, reference }) => {
        const normalized = adapters.agentChat!.normalizeReference!(
          reference,
        ) as AgentComposerReference | null;
        return normalized
          ? [{ start, end, attrs: mentionReferenceAttrs(normalized) }]
          : [];
      }),
    [adapters],
  );
  const sendButtonTooltip = t(getComposerSendTooltipKey(willQueue), {
    defaultValue: willQueue ? "Queue message" : "Send message",
  });
  const [popover, setPopover] = useState<PopoverState>(null);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextEntryRequest, setContextEntryRequest] = useState<{
    id: string;
  } | null>(null);
  const popoverRef = useRef<MentionPopoverRef>(null);
  const composerRuntime = useComposerRuntime();
  const lastComposerRuntimeSyncRef = useRef<{
    text: string;
    runConfigSignature: string;
  } | null>(null);
  const submitLocksRef = useRef(new Set<ComposerSubmitLock>());
  const attachmentCleanupPendingRef = useRef(0);
  const onSubmissionPendingChangeRef = useRef(onSubmissionPendingChange);
  onSubmissionPendingChangeRef.current = onSubmissionPendingChange;
  // Submits can overlap, so the host hears only the first start and last end.
  const pendingSubmitCountRef = useRef(0);
  const reportSubmissionPending = useCallback((pending: boolean) => {
    const count = pendingSubmitCountRef.current + (pending ? 1 : -1);
    pendingSubmitCountRef.current = count;
    if (count === (pending ? 1 : 0)) {
      onSubmissionPendingChangeRef.current?.(pending);
    }
  }, []);
  const mountedRef = useRef(false);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [editorHasText, setEditorHasText] = useState(false);
  const [referenceRevision, setReferenceRevision] = useState(0);
  const [slotReferences, setSlotReferences] = useState<
    AgentComposerReference[]
  >([]);
  const slotReferencesRef = useRef(slotReferences);
  slotReferencesRef.current = slotReferences;
  const updateSlotReferences = useCallback(
    (update: React.SetStateAction<AgentComposerReference[]>) => {
      const next =
        typeof update === "function"
          ? update(slotReferencesRef.current)
          : update;
      slotReferencesRef.current = next;
      setSlotReferences(next);
    },
    [],
  );
  const [selectedContextItemKey, setSelectedContextItemKey] = useState<
    string | null
  >(null);
  const composerText = useComposer((state) => state.text);
  const composerAttachments = useComposer((state) => state.attachments);
  const [
    failedAttachmentCleanupSnapshots,
    setFailedAttachmentCleanupSnapshots,
  ] = useState<typeof composerAttachments>([]);
  const [contextSubmissionError, setContextSubmissionError] = useState<
    string | null
  >(null);
  useEffect(() => {
    if (failedAttachmentCleanupSnapshots.length > 0) return;
    setContextSubmissionError(null);
  }, [failedAttachmentCleanupSnapshots.length, providedContextItems]);
  useEffect(() => {
    if (failedAttachmentCleanupSnapshots.length === 0) return;
    const remainingFailedAttachments = failedAttachmentCleanupSnapshots.filter(
      (submitted) =>
        composerAttachments.some((current) =>
          isSameComposerAttachment(current, submitted),
        ),
    );
    if (
      remainingFailedAttachments.length ===
      failedAttachmentCleanupSnapshots.length
    ) {
      return;
    }
    setFailedAttachmentCleanupSnapshots(remainingFailedAttachments);
    if (remainingFailedAttachments.length === 0) {
      setContextSubmissionError(null);
    }
  }, [composerAttachments, failedAttachmentCleanupSnapshots]);
  const hasDraft =
    editorHasText ||
    slotReferences.length > 0 ||
    composerAttachments.length > 0;
  const hasNonTextDraftRef = useRef(false);
  hasNonTextDraftRef.current =
    slotReferences.length > 0 || composerAttachments.length > 0;
  const canSend = canSubmitComposerContent({
    hasEditorContent: editorHasText || slotReferences.length > 0,
    attachmentCount: composerAttachments.length,
    disabled:
      disabled ||
      submissionDisabled ||
      submitting ||
      !areComposerContextItemsReady(contextItems) ||
      composerAttachments.some((current) =>
        failedAttachmentCleanupSnapshots.some((submitted) =>
          isSameComposerAttachment(current, submitted),
        ),
      ),
  });
  const stopSlotRef = useRef<HTMLDivElement>(null);
  const hasContextRows = contextItems.length > 0 || slotReferences.length > 0;
  const [composerMode, setComposerMode] = useState<ComposerMode | null>(null);
  const composerModeRef = useRef<ComposerMode | null>(null);
  // `/plan` applies to the next send only; the composer acts again after it.
  const [planNext, setPlanNext] = useState(false);
  const planNextRef = useRef(false);
  const setPlanNextState = useCallback((next: boolean) => {
    planNextRef.current = next;
    setPlanNext(next);
  }, []);
  const hasHeaderRows =
    Boolean(headerSlot) || Boolean(composerMode) || planNext || hasContextRows;
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent);

  // Refs for values accessed in handleKeyDown (ProseMirror doesn't re-bind)
  const popoverStateRef = useRef<PopoverState>(null);
  const composingRef = useRef(false);
  const voiceCapturingRef = useRef(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const onAttachmentErrorRef = useRef(onAttachmentError);
  // Many standalone prompts pass no handler; a rejected file must still say so.
  onAttachmentErrorRef.current = onAttachmentError ?? setAttachmentError;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const onSubmitStartRef = useRef(onSubmitStart);
  onSubmitStartRef.current = onSubmitStart;
  const onOptimisticAttachmentsChangeRef = useRef(
    onOptimisticAttachmentsChange,
  );
  onOptimisticAttachmentsChangeRef.current = onOptimisticAttachmentsChange;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  const onRecallLastMessageRef = useRef(onRecallLastMessage);
  onRecallLastMessageRef.current = onRecallLastMessage;

  const {
    items: mentionItems,
    isLoading: mentionsLoading,
    error: mentionsError,
    retry: retryMentions,
    settledQuery: settledMentionQuery,
  } = useMentionSearch(
    popover?.type === "@" ? popover.query : "",
    includeDefaultMentionSearch && (contextMenuOpen || popover?.type === "@"),
  );
  const mentionQuery = popover?.type === "@" ? popover.query : "";
  const filteredMentionItems = useMemo(
    () =>
      filterMentionItemsForSlots(
        [
          // Host items arrive unfiltered; the default search filters itself.
          ...hostMentionItems.filter((item) =>
            mentionItemMatchesQuery(item, mentionQuery),
          ),
          ...mentionItems,
        ].filter(
          (item, index, items) =>
            items.findIndex((candidate) => candidate.id === item.id) === index,
        ),
        slotReferences,
      ),
    [hostMentionItems, mentionItems, mentionQuery, slotReferences],
  );
  const inlineMentionItems = useMemo(() => {
    if (
      popover?.type !== "@" ||
      !hasContextMenu ||
      disabled ||
      contextControlsDisabled ||
      !contextMenuItems?.length
    )
      return filteredMentionItems;
    const addContextLabel = t("agentChat.composer.addContext", {
      defaultValue: "Add context",
    });
    return [
      ...searchComposerContextActions(contextMenuItems, mentionQuery)
        // Custom pages only render inside the + menu.
        .filter(({ action }) => !action.disabled && !action.render)
        .map(
          ({ action, categories }): MentionItem => ({
            id: `${COMPOSER_CONTEXT_ENTRY_SOURCE}:${action.id}`,
            label: action.label,
            description: action.description,
            source: COMPOSER_CONTEXT_ENTRY_SOURCE,
            refType: COMPOSER_CONTEXT_ENTRY_SOURCE,
            refId: action.id,
            section: categories[0] ?? addContextLabel,
          }),
        ),
      ...filteredMentionItems,
    ];
  }, [
    popover?.type,
    hasContextMenu,
    disabled,
    contextControlsDisabled,
    contextMenuItems,
    mentionQuery,
    filteredMentionItems,
    t,
  ]);

  const {
    skills,
    hint,
    isLoading: skillsLoading,
  } = useSkills(includeDefaultSlashSkills && popover?.type === "/");

  const allSlashCommands = useMemo(() => {
    // A command without a host callback would be deleted as an invisible
    // no-op; `/plan` is the one the composer runs itself.
    if (!onSlashCommand) return planCommand ? [planSlashCommand(t)] : [];
    return mergeSlashCommands([
      ...(includeDefaultSlashCommands
        ? builtInCommands(t, { planCommand })
        : planCommand
          ? [planSlashCommand(t)]
          : []),
      ...slashCommands,
    ]);
  }, [
    includeDefaultSlashCommands,
    onSlashCommand,
    planCommand,
    slashCommands,
    t,
  ]);

  useEffect(() => {
    if (!planCommand) setPlanNextState(false);
  }, [planCommand, setPlanNextState]);

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
  // Results for an earlier query are stale until the search for this one
  // settles, so auto-close may not treat them as final. Host mention items
  // carry no readiness signal (they may still be loading), so only a settled
  // default search can end a query as "nothing matches".
  const mentionSearchSettled =
    includeDefaultMentionSearch &&
    !mentionsLoading &&
    settledMentionQuery === mentionQuery;
  const filteredCommandsRef = useRef(filteredCommands);
  filteredCommandsRef.current = filteredCommands;
  const filteredSkillsRef = useRef(filteredSkills);
  filteredSkillsRef.current = filteredSkills;
  const launchersDisabledRef = useRef(disabled || contextControlsDisabled);
  launchersDisabledRef.current = disabled || contextControlsDisabled;
  const onSlashCommandRef = useRef(onSlashCommand);
  onSlashCommandRef.current = onSlashCommand;
  const planCommandRef = useRef(planCommand);
  planCommandRef.current = planCommand;
  const announceSlashCommand = useCallback(
    (command: SlashCommand) => {
      if (command.name === PLAN_SLASH_COMMAND && planCommandRef.current) {
        setPlanNextState(true);
        return;
      }
      const handler = onSlashCommandRef.current;
      if (!handler) return;
      handler(command.name);
      toast.success(`/${command.name}`, {
        description: command.description,
        duration: 1800,
      });
    },
    [setPlanNextState],
  );
  const onTextChangeRef = useRef(onTextChange);
  onTextChangeRef.current = onTextChange;
  const contextItemsRef = useRef(contextItems);
  contextItemsRef.current = contextItems;
  const contextItemsProvidedRef = useRef(providedContextItems !== undefined);
  contextItemsProvidedRef.current = providedContextItems !== undefined;
  const submissionDisabledRef = useRef(
    disabled || submissionDisabled || submitting,
  );
  submissionDisabledRef.current = disabled || submissionDisabled || submitting;
  const onRemoveContextItemRef = useRef(onRemoveContextItem);
  onRemoveContextItemRef.current = onRemoveContextItem;
  const selectedContextItemKeyRef = useRef<string | null>(null);
  selectedContextItemKeyRef.current = selectedContextItemKey;
  const initialTextKeyRef = useRef<string | number | undefined>(undefined);
  const hasCheckedInitialDraftRef = useRef(false);
  const seenReferenceInsertIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!hasContextMenu) setContextMenuOpen(false);
  }, [hasContextMenu]);

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

  // A query nothing matches is plain text ("@builder.io", "@3pm"), so end the
  // mention there instead of holding later keys.
  useEffect(() => {
    if (
      mentionQuery &&
      mentionSearchSettled &&
      inlineMentionItems.length === 0
    ) {
      closePopover();
    }
  }, [mentionQuery, mentionSearchSettled, inlineMentionItems, closePopover]);

  // The + menu runs a request from its own effect, which fires before this one;
  // clear it so a remounted menu cannot run the same action again.
  useEffect(() => {
    if (contextEntryRequest) setContextEntryRequest(null);
  }, [contextEntryRequest]);

  // Persist draft to localStorage so refreshes don't lose the prompt.
  const hasDraftScope = Boolean(draftScope?.trim());
  const draftKey =
    hasDraftScope || initialText === undefined
      ? getComposerDraftKey(draftScope)
      : null;
  const draftKeyRef = useRef(draftKey);
  const draftScopeGenerationRef = useRef(0);
  const attachmentCleanupRef = useRef<Promise<void>>(Promise.resolve());
  const attachmentAddQueueRef = useRef<Promise<void>>(Promise.resolve());
  const attachmentSubmissionBarrierRef = useRef<Promise<void>>(
    Promise.resolve(),
  );
  const submittingAttachmentIdsRef = useRef(new Set<string>());
  const pendingAttachmentAddsRef = useRef(
    new Map<number, Set<Promise<void>>>(),
  );
  const pendingAttachmentFilesRef = useRef(new Map<File, number>());
  const staleAttachmentFilesRef = useRef(new Set<File>());
  const staleAttachmentSnapshotsRef = useRef(
    new Set<(typeof composerAttachments)[number]>(),
  );
  const cleanStaleAttachments = useCallback(async () => {
    await attachmentCleanupRef.current;
    for (const file of staleAttachmentFilesRef.current) {
      const cleanup = attachmentCleanupRef.current.then(async () => {
        const index = composerRuntime
          .getState()
          .attachments.findIndex((attachment) => attachment.file === file);
        if (index === -1) return;
        await composerRuntime.getAttachmentByIndex(index).remove();
      });
      attachmentCleanupRef.current = cleanup.catch((error) => {
        console.error("Could not remove stale composer attachment", error);
      });
      await cleanup;
      staleAttachmentFilesRef.current.delete(file);
    }
    for (const staleAttachment of staleAttachmentSnapshotsRef.current) {
      const cleanup = attachmentCleanupRef.current.then(async () => {
        const index = composerRuntime
          .getState()
          .attachments.findIndex((attachment) =>
            isSameComposerAttachmentSnapshot(attachment, staleAttachment),
          );
        if (index === -1) return;
        await composerRuntime.getAttachmentByIndex(index).remove();
      });
      attachmentCleanupRef.current = cleanup.catch((error) => {
        console.error("Could not remove stale composer attachment", error);
      });
      await cleanup;
      staleAttachmentSnapshotsRef.current.delete(staleAttachment);
    }
  }, [composerRuntime]);
  const createAttachmentSubmissionBarrier = useCallback(() => {
    const drain = async () => {
      while (true) {
        const pendingAdds = [
          ...pendingAttachmentAddsRef.current.values(),
        ].flatMap((additions) => [...additions]);
        const addQueue = attachmentAddQueueRef.current;
        await addQueue;
        await Promise.all(pendingAdds);
        await cleanStaleAttachments();
        if (
          staleAttachmentFilesRef.current.size > 0 ||
          staleAttachmentSnapshotsRef.current.size > 0
        ) {
          throw new Error("Previous draft attachments could not be removed.");
        }
        const hasNewPendingAdds = [...pendingAttachmentAddsRef.current.values()]
          .flatMap((additions) => [...additions])
          .some((addition) => !pendingAdds.includes(addition));
        if (addQueue !== attachmentAddQueueRef.current || hasNewPendingAdds) {
          continue;
        }
        return composerRuntime.getState().attachments;
      }
    };
    return drain();
  }, [cleanStaleAttachments, composerRuntime]);
  const addAttachmentForCurrentScope = useCallback(
    (file: File) => {
      setAttachmentError(null);
      const scopeGeneration = draftScopeGenerationRef.current;
      const submissionBarrier = attachmentSubmissionBarrierRef.current;
      let resolveOperation!: () => void;
      let rejectOperation!: (error: unknown) => void;
      const operation = new Promise<void>((resolve, reject) => {
        resolveOperation = resolve;
        rejectOperation = reject;
      });
      const scopeBarrier = operation.then(
        () => undefined,
        () => undefined,
      );
      const scopeAdds =
        pendingAttachmentAddsRef.current.get(scopeGeneration) ?? new Set();
      scopeAdds.add(scopeBarrier);
      pendingAttachmentAddsRef.current.set(scopeGeneration, scopeAdds);

      const run = async () => {
        const reservation = attachmentAddQueueRef.current.then(async () => {
          await submissionBarrier;
          const priorScopeAdds = [...pendingAttachmentAddsRef.current]
            .filter(([generation]) => generation !== scopeGeneration)
            .flatMap(([, additions]) => [...additions]);
          await Promise.all(priorScopeAdds);
          await cleanStaleAttachments();
          if (draftScopeGenerationRef.current !== scopeGeneration) return false;

          const existingFiles = composerRuntime
            .getState()
            .attachments.flatMap((attachment) => {
              if (submittingAttachmentIdsRef.current.has(attachment.id))
                return [];
              return isBlob(attachment.file)
                ? [
                    {
                      file: attachment.file,
                      name: attachment.name,
                      contentType: normalizeAttachmentContentType(
                        attachment.contentType,
                      ),
                    },
                  ]
                : [];
            });
          const pendingFiles = [...pendingAttachmentFilesRef.current].flatMap(
            ([pendingFile, pendingGeneration]) =>
              pendingGeneration === scopeGeneration
                ? [
                    {
                      file: pendingFile,
                      name: pendingFile.name,
                      contentType: normalizeAttachmentContentType(
                        pendingFile.type,
                      ),
                    },
                  ]
                : [],
          );
          const filesToCompare = [...existingFiles, ...pendingFiles];
          const candidate = {
            file,
            name: file.name,
            contentType: normalizeAttachmentContentType(file.type),
          };
          const comparisonBudget = {
            remainingBytes: MAX_ATTACHMENT_COMPARISON_BYTES,
            remainingComparisons: MAX_ATTACHMENT_COMPARISONS,
          };
          for (const existingFile of filesToCompare) {
            if (comparisonBudget.remainingComparisons === 0) break;
            if (
              await haveSameAttachmentInput(
                candidate,
                existingFile,
                comparisonBudget,
              )
            ) {
              return false;
            }
          }

          pendingAttachmentFilesRef.current.set(file, scopeGeneration);
          return true;
        });
        attachmentAddQueueRef.current = reservation.then(
          () => undefined,
          () => undefined,
        );

        try {
          if (!(await reservation)) return;
          if (draftScopeGenerationRef.current !== scopeGeneration) {
            if (
              pendingAttachmentFilesRef.current.get(file) === scopeGeneration
            ) {
              pendingAttachmentFilesRef.current.delete(file);
            }
            return;
          }
          const addition = composerRuntime.addAttachment(file);
          const removeIfStale = async () => {
            if (draftScopeGenerationRef.current === scopeGeneration) return;
            staleAttachmentFilesRef.current.add(file);
            await cleanStaleAttachments();
          };
          const settledAddition = addition.then(removeIfStale, removeIfStale);
          try {
            return await addition;
          } finally {
            await settledAddition;
          }
        } finally {
          if (pendingAttachmentFilesRef.current.get(file) === scopeGeneration) {
            pendingAttachmentFilesRef.current.delete(file);
          }
        }
      };
      void run().then(resolveOperation, rejectOperation);
      void operation.then(
        () => {
          scopeAdds.delete(scopeBarrier);
          if (scopeAdds.size === 0) {
            pendingAttachmentAddsRef.current.delete(scopeGeneration);
          }
        },
        () => {
          scopeAdds.delete(scopeBarrier);
          if (scopeAdds.size === 0) {
            pendingAttachmentAddsRef.current.delete(scopeGeneration);
          }
        },
      );
      return operation;
    },
    [cleanStaleAttachments, composerRuntime],
  );
  useLayoutEffect(() => {
    if (draftKeyRef.current !== draftKey) {
      draftKeyRef.current = draftKey;
      draftScopeGenerationRef.current += 1;
      for (const attachment of composerRuntime.getState().attachments) {
        staleAttachmentSnapshotsRef.current.add(attachment);
      }
    }
  }, [composerRuntime, draftKey]);
  const draftEditorRef = useRef<ComposerDraftEditor | null>(null);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelScheduledDraftPersist = useCallback(() => {
    if (draftSaveTimerRef.current === null) return;
    clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = null;
  }, []);
  const flushComposerDraft = useCallback(() => {
    cancelScheduledDraftPersist();
    const ed = draftEditorRef.current;
    if (!ed || !isComposerEditorUsable(ed)) return;
    persistComposerDraft(draftKeyRef.current, ed, slotReferencesRef.current);
  }, [cancelScheduledDraftPersist]);
  const scheduleComposerDraftPersist = useCallback(
    (ed: ComposerDraftEditor) => {
      draftEditorRef.current = ed;
      cancelScheduledDraftPersist();
      const key = draftKeyRef.current;
      if (!key) return;
      draftSaveTimerRef.current = setTimeout(() => {
        draftSaveTimerRef.current = null;
        if (draftKeyRef.current !== key || draftEditorRef.current !== ed) {
          return;
        }
        persistComposerDraft(key, ed, slotReferencesRef.current);
      }, COMPOSER_DRAFT_SAVE_DELAY_MS);
    },
    [cancelScheduledDraftPersist],
  );
  const previousDraftKeyRef = useRef(draftKey);
  useEffect(() => {
    lastComposerRuntimeSyncRef.current = null;
  }, [composerRuntime]);
  // Tiptap reads extension config once at init; ref keeps runtime prop
  // changes visible to Placeholder's function form.
  const resolvedPlaceholder = voiceChat
    ? realtimeVoiceCopy.placeholder
    : composerMode
      ? localizedComposerModeConfig(composerMode, t).placeholder
      : conversationStarted
        ? (replyPlaceholder ??
          t("agentChat.composer.replyPlaceholder", { defaultValue: "Reply…" }))
        : (placeholder ??
          t("agentChat.composer.newChatPlaceholder", {
            defaultValue: "Ask anything",
          }));
  const placeholderRef = useRef(resolvedPlaceholder);
  placeholderRef.current = resolvedPlaceholder;

  const editor = useEditor({
    extensions: createTiptapComposerExtensions(() => placeholderRef.current),
    immediatelyRender: false,
    editable: !editorLocked,
    onUpdate: ({ editor: ed }) => {
      // Drive the send button's enabled state from the actual editor contents;
      // the composer runtime is only synced on submit, so its isEmpty lags.
      setEditorHasText(composerDocumentHasContent(ed.state.doc));
      setAttachmentError(null);
      onTextChangeRef.current?.(ed.getText({ blockSeparator: "\n" }).trim());
      setReferenceRevision((revision) => revision + 1);

      scheduleComposerDraftPersist(ed);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to, anchor, head } = ed.state.selection;
      if (ed.isFocused)
        onSelectionChange?.({
          start: from,
          end: to,
          direction:
            anchor === head ? "none" : anchor > head ? "backward" : "forward",
        });
      if (selectedContextItemKeyRef.current && (from !== to || from > 1)) {
        selectedContextItemKeyRef.current = null;
        setSelectedContextItemKey(null);
      }
    },
    onFocus,
    onBlur,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel ?? resolvedPlaceholder,
        "aria-multiline": "true",
        // Context controls can be off while the editor still takes a draft.
        "aria-disabled": String(editorLocked),
        role: "textbox",
        "data-agent-composer-variant": layoutVariant,
        "data-agent-composer-slot": "editor-input",
        class:
          "agent-composer-prosemirror flex-1 resize-none bg-transparent text-[length:var(--agentkit-composer-font-size,0.875rem)] text-foreground outline-none leading-[var(--agentkit-composer-line-height,1.625rem)] min-h-[var(--agentkit-composer-editor-min-height,3.25rem)] max-h-[var(--agentkit-composer-editor-max-height,10rem)] overflow-y-auto [&>p.is-editor-empty:first-child]:before:pointer-events-none [&>p.is-editor-empty:first-child]:before:float-start [&>p.is-editor-empty:first-child]:before:h-0 [&>p.is-editor-empty:first-child]:before:text-muted-foreground [&>p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
      },
      handleDOMEvents: {
        compositionstart: () => {
          composingRef.current = true;
          return false;
        },
        compositionend: () => {
          composingRef.current = false;
          return false;
        },
        keydown: (_view, event) => {
          if (event.key !== "Escape" || !event.defaultPrevented) return false;
          if (
            event.isComposing ||
            event.keyCode === 229 ||
            composingRef.current
          ) {
            event.stopPropagation();
            return true;
          }
          if (popoverStateRef.current) {
            closePopover();
          } else {
            onEscapeRef.current?.();
          }
          event.stopPropagation();
          return true;
        },
      },
      handlePaste: (view, event) => {
        if (disabled) {
          if (event.clipboardData?.files.length) {
            event.preventDefault();
            return true;
          }
          return false;
        }
        if (!attachmentsEnabled) {
          if (event.clipboardData?.files.length) {
            event.preventDefault();
            const pastedText = readClipboardPaste(event.clipboardData).text;
            if (pastedText) {
              view.pasteText(pastedText, new Event("paste") as ClipboardEvent);
            }
            return true;
          }
          return false;
        }
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
            attachments.map((file) => addAttachmentForCurrentScope(file)),
          ).catch((error) => {
            const msg = formatAttachmentError(
              error,
              t("agentChat.composer.pastedImageError", {
                defaultValue:
                  "Could not attach the pasted image. Try a different format.",
              }),
            );
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
          void addAttachmentForCurrentScope(
            createPastedAttachmentFile(paste),
          ).catch((error) => {
            const msg = formatAttachmentError(
              error,
              t("agentChat.composer.pastedTextError", {
                defaultValue: "Could not attach the pasted text.",
              }),
            );
            onAttachmentErrorRef.current?.(msg);
          });
          return true;
        }

        return false;
      },
      handleDrop: (_view, event) => {
        if (disabled || !attachmentsEnabled) {
          if (event.dataTransfer?.files.length) {
            event.preventDefault();
            return true;
          }
          return false;
        }
        // Drag-and-drop files (decks, images, PDFs, etc.) into the composer.
        // Mark handled drops as consumed so the chat-wide drop target does not
        // add the same file a second time.
        return handleComposerFileDrop({
          event: event as DragEvent,
          addAttachment: addAttachmentForCurrentScope,
          attachmentsEnabled,
          onError: (error, fileName) => {
            const msg = formatAttachmentError(
              error,
              t("agentChat.composer.droppedFileError", {
                defaultValue:
                  "Could not attach the dropped file. Try a different format.",
              }),
            );
            onAttachmentErrorRef.current?.(`${fileName}: ${msg}`);
          },
        });
      },
      handleKeyDown: (view, event) => {
        if (event.isComposing || event.keyCode === 229) {
          event.stopPropagation();
          return false;
        }
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
          if (
            (event.key === "Enter" ||
              (event.key === "Tab" && !event.shiftKey)) &&
            popoverRef.current?.activateRetry()
          ) {
            event.preventDefault();
            return true;
          }
          // A mention comes only from an explicit pick of a highlighted row. With
          // nothing highlighted, even while a search is pending, the "@" is
          // plain text: Enter submits it and a late result changes nothing.
          const highlighted =
            pop.type === "@" ? popoverRef.current?.getSelectedMention() : null;
          if (event.key === "Enter" && pop.type === "@" && !highlighted) {
            closePopover();
          } else if (event.key === "Tab" && !event.shiftKey && highlighted) {
            event.preventDefault();
            selectMention(view, pop, highlighted);
            return true;
          } else if (event.key === "Enter") {
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
            contextItemKeys: contextItemsRef.current
              .filter((item) => item.removable !== false)
              .map((item) => item.key),
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

        // Backspace at the start of an empty draft removes the Plan chip.
        if (
          event.key === "Backspace" &&
          planNextRef.current &&
          view.state.doc.textContent.trim() === "" &&
          from === to &&
          from <= 1
        ) {
          setPlanNextState(false);
          return true;
        }

        // ArrowUp in an empty composer edits the last sent message. Only a bare
        // press at the very start counts, so caret movement inside a draft is
        // never captured.
        if (
          event.key === "ArrowUp" &&
          !event.shiftKey &&
          !event.altKey &&
          !event.metaKey &&
          !event.ctrlKey &&
          onRecallLastMessageRef.current &&
          cursorAtStart &&
          !composerModeRef.current &&
          !hasNonTextDraftRef.current &&
          isComposerDocEmpty(view.state.doc) &&
          onRecallLastMessageRef.current()
        ) {
          event.preventDefault();
          return true;
        }

        // Submit on Enter. Shift+Enter inserts a newline and keeps the
        // composer scrolled to the caret.
        // Cmd+Enter on macOS / Ctrl+Enter elsewhere steers the active run.
        if (event.key === "Enter" && event.shiftKey) {
          event.preventDefault();
          return insertComposerHardBreakAndScrollIntoView(view);
        }

        const submitIntent = getComposerSubmitIntentForEnterKey(event, isMac);
        if (submitIntent) {
          event.preventDefault();
          void submitComposer(
            submitIntent,
            undefined,
            isMac ? event.metaKey : event.ctrlKey,
          );
          return true;
        }

        if (event.key === "Escape" && onEscapeRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onEscapeRef.current();
          return true;
        }

        if (event.key === "Escape" && !voiceCapturingRef.current) {
          const stop = stopSlotRef.current?.querySelector<HTMLButtonElement>(
            "button:not(:disabled)",
          );
          if (stop) {
            event.preventDefault();
            event.stopPropagation();
            stop.click();
            return true;
          }
        }

        // Detect @ trigger — only when preceded by start-of-text, space, or newline
        // (not after alphanumeric chars, which would indicate an email address).
        // Keep the typed "@" in the draft and focus in the editor: a focus-taking
        // menu here would swallow the rest of a literal like "@builder.io".
        if (event.key === "@") {
          if (launchersDisabledRef.current) return false;
          const { from } = view.state.selection;
          const textBefore = view.state.doc.textBetween(
            Math.max(0, from - 1),
            from,
          );
          if (from === 1 || textBefore === "" || /\s/.test(textBefore)) {
            const position = getComposerPopoverAnchorPosition(view, from);
            if (!position) return false;
            // The key inserts at `from`; later keys can land before this runs.
            const startPos = from + 1;
            setTimeout(() => {
              const state: PopoverState = {
                type: "@",
                position,
                startPos,
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
            const position = getComposerPopoverAnchorPosition(view, from);
            if (!position) return false;
            const startPos = from + 1;
            setTimeout(() => {
              const state: PopoverState = {
                type: "/",
                position,
                startPos,
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

  useEffect(() => {
    if (!isComposerEditorUsable(editor)) return;
    draftEditorRef.current = editor;
    const flush = () => {
      cancelScheduledDraftPersist();
      persistComposerDraft(draftKey, editor, slotReferencesRef.current);
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      cancelScheduledDraftPersist();
      persistComposerDraft(draftKey, editor, slotReferencesRef.current);
      if (draftEditorRef.current === editor) draftEditorRef.current = null;
    };
  }, [cancelScheduledDraftPersist, draftKey, editor]);

  // Placeholder decorations are computed by ProseMirror. Dispatching an empty
  // transaction makes a locale or composer-mode change visible immediately.
  useEffect(() => {
    if (!isComposerEditorUsable(editor)) return;
    editor.view.dispatch(editor.state.tr.setSelection(editor.state.selection));
  }, [editor, resolvedPlaceholder]);

  // A tab can stay mounted while becoming the active composer later. Publish
  // its existing draft when the host starts observing it so contextual UI is
  // correct immediately after a tab switch, not only after the next keystroke.
  useEffect(() => {
    if (!isComposerEditorUsable(editor) || !onTextChange) return;
    const currentText = editor.getText({ blockSeparator: "\n" }).trim();
    if (initialText === undefined) onTextChange(currentText);
  }, [editor, initialText, onTextChange]);

  const insertReference = useCallback(
    (ref: AgentComposerReference) => {
      const normalized = adapters.agentChat!.normalizeReference!(ref) as any;
      const ed = editor;
      if (!normalized || !isComposerEditorUsable(ed)) return;
      if (normalized.slotKey) {
        updateSlotReferences((current) =>
          applySlotReferenceChanges(current, [normalized]),
        );
        ed.commands.focus("end");
        return;
      }
      if (
        normalized.relatedReferences?.some(
          (item: AgentComposerReference) => item.slotKey,
        )
      ) {
        updateSlotReferences((current) =>
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
    [editor, updateSlotReferences],
  );

  const insertReferenceIfEmpty = useCallback(
    (payload: AgentComposerReferenceInsertPayload) => {
      const ed = editor;
      if (!isComposerEditorUsable(ed) || disabled || composerModeRef.current)
        return;
      const insertMessageId =
        typeof payload.insertMessageId === "string"
          ? payload.insertMessageId
          : "";
      if (insertMessageId) {
        if (seenReferenceInsertIdsRef.current.has(insertMessageId)) return;
        seenReferenceInsertIdsRef.current.add(insertMessageId);
      }
      const normalized = adapters.agentChat!.normalizeReference!(
        payload,
      ) as any;
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
    if (typeof window === "undefined" || isReferenceTarget === false) return;
    const acceptsReferenceEvent = (event: Event) => {
      const target = getComposerReferenceEventTarget(event);
      return (
        !target ||
        (isComposerEditorUsable(editor) && target === editor.view.dom)
      );
    };
    const handleEvent = (event: Event) => {
      if (!acceptsReferenceEvent(event)) return;
      const payload = (event as CustomEvent).detail;
      const normalized = adapters.agentChat!.normalizeReference!(
        payload,
      ) as any;
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
      if (
        !adapters.builder!.isTrustedFrameMessage!(event) &&
        !adapters.builder!.isTrustedBuilderMessage!(event)
      ) {
        return;
      }
      if (event.data?.type !== AGENT_CHAT_INSERT_REFERENCE_MESSAGE_TYPE) {
        return;
      }
      if (!acceptsReferenceEvent(event)) return;
      const payload = event.data.data;
      const normalized = adapters.agentChat!.normalizeReference!(
        payload,
      ) as any;
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
    const element = isComposerEditorUsable(editor) ? editor.view.dom : null;
    const reportUnavailable = () => {
      if (isReferenceTarget === true && element)
        window.dispatchEvent(
          new CustomEvent("agentNative:composer-reference-unavailable", {
            detail: element,
          }),
        );
    };
    if (isReferenceTarget === true) editor?.on("destroy", reportUnavailable);
    if (isReferenceTarget === true && element && !disabled) {
      window.dispatchEvent(
        new CustomEvent("agentNative:composer-reference-ready", {
          detail: element,
        }),
      );
    } else reportUnavailable();
    return () => {
      reportUnavailable();
      editor?.off("destroy", reportUnavailable);
      window.removeEventListener(
        AGENT_CHAT_INSERT_REFERENCE_EVENT,
        handleEvent,
      );
      window.removeEventListener("message", handleMessage);
    };
  }, [adapters, insertReferenceIfEmpty, isReferenceTarget]);

  // The editor is created after the first commit, so a host driving the
  // composer from its own mount effect reaches this handle before the editor
  // exists. Those calls replay once it does instead of being dropped. The
  // replay runs a microtask after the usable handle is published, so every
  // call queues behind a non-empty queue or it would land before earlier ones.
  const latestHandleRef = useRef<TiptapComposerHandle | null>(null);
  const callsBeforeEditorRef = useRef<
    ((handle: TiptapComposerHandle) => void)[]
  >([]);
  useEffect(() => {
    const calls = callsBeforeEditorRef.current;
    return () => {
      calls.length = 0;
    };
  }, []);
  useEffect(() => {
    if (!isComposerEditorUsable(editor)) return;
    if (callsBeforeEditorRef.current.length === 0) return;
    // Reference chips render through React node views, which flushSync and
    // cannot do so from inside this effect.
    queueMicrotask(() => {
      const handle = latestHandleRef.current;
      if (!handle || !isComposerEditorUsable(editor)) return;
      for (const call of callsBeforeEditorRef.current.splice(0)) call(handle);
    });
  }, [editor]);

  useImperativeHandle(focusRef, () => {
    const handle: TiptapComposerHandle = {
      focus() {
        if (
          !isComposerEditorUsable(editor) ||
          callsBeforeEditorRef.current.length > 0
        ) {
          callsBeforeEditorRef.current.push((latest) => latest.focus());
          return;
        }
        // An editor inside a hidden session shell cannot take focus, and
        // nothing re-runs this when the shell is shown. Focus on the first
        // size change.
        focusComposerEditorWhenVisible(editor);
      },
      addAttachment(file: File) {
        return addAttachmentForCurrentScope(file);
      },
      insertText(text: string) {
        if (
          !isComposerEditorUsable(editor) ||
          callsBeforeEditorRef.current.length > 0
        ) {
          callsBeforeEditorRef.current.push((latest) =>
            latest.insertText(text),
          );
          return;
        }
        editor.commands.setContent(plainTextToDoc(""), { emitUpdate: false });
        editor.commands.focus("end");
        if (!document.execCommand("insertText", false, text)) {
          editor.commands.insertContent(text);
        }
      },
      insertTextAtCursor(text: string) {
        if (
          !isComposerEditorUsable(editor) ||
          callsBeforeEditorRef.current.length > 0
        ) {
          callsBeforeEditorRef.current.push((latest) =>
            latest.insertTextAtCursor?.(text),
          );
          return;
        }
        editor.commands.focus();
        const mention = text === "@" && !launchersDisabledRef.current;
        let inserted = text;
        if (mention) {
          const { from } = editor.state.selection;
          const before = editor.state.doc.textBetween(
            Math.max(0, from - 1),
            from,
          );
          if (from > 1 && before !== "" && !/\s/.test(before)) inserted = ` @`;
        }
        // The popover anchors on the selection right after this insert, but
        // an execCommand edit reaches the editor state only once ProseMirror
        // reads the DOM back, so an @ goes through the editor directly.
        if (
          mention ||
          typeof document.execCommand !== "function" ||
          !document.execCommand("insertText", false, inserted)
        ) {
          editor.commands.insertContent(inserted);
        }
        if (!mention) return;
        const view = editor.view;
        const startPos = view.state.selection.from;
        const position = getComposerPopoverAnchorPosition(view, startPos - 1);
        if (!position) return;
        const state: PopoverState = {
          type: "@",
          position,
          startPos,
          query: "",
        };
        popoverStateRef.current = state;
        setPopover(state);
      },
      setText(text: string, references?: readonly ComposerTextReference[]) {
        if (
          !isComposerEditorUsable(editor) ||
          callsBeforeEditorRef.current.length > 0
        ) {
          callsBeforeEditorRef.current.push((latest) =>
            latest.setText(text, references),
          );
          return;
        }
        editor.commands.setContent(plainTextToDoc(text, textChips(references)));
        editor.commands.focus("end");
        const trimmed = editor.getText({ blockSeparator: "\n" }).trim();
        setEditorHasText(trimmed.length > 0);
        updateSlotReferences([]);
        composerRuntime.setText(trimmed);
        onTextChangeRef.current?.(trimmed);
        flushComposerDraft();
      },
      submitWithText: (text: string) => submitComposer("immediate", text),
      submit: () => submitComposer("immediate"),
      getDraftSnapshot: () => {
        const { text, references } = extractComposerPayload();
        return composerDraftSnapshot(
          text,
          references,
          composerRuntime.getState().attachments,
        );
      },
      insertReference(ref) {
        if (
          !isComposerEditorUsable(editor) ||
          callsBeforeEditorRef.current.length > 0
        ) {
          callsBeforeEditorRef.current.push((latest) =>
            latest.insertReference(ref),
          );
          return;
        }
        insertReference(ref);
      },
      replaceReference(refType, ref) {
        if (
          !isComposerEditorUsable(editor) ||
          callsBeforeEditorRef.current.length > 0
        ) {
          callsBeforeEditorRef.current.push((latest) =>
            latest.replaceReference(refType, ref),
          );
          return;
        }
        const positions: number[] = [];
        editor.state.doc.descendants((node, pos) => {
          if (
            node.type.name === "mentionReference" &&
            node.attrs.refType === refType
          ) {
            positions.push(pos);
          }
        });
        const referencePosition = positions.at(0);
        if (referencePosition === undefined) {
          if (ref) insertReference(ref);
          return;
        }
        const node = editor.state.doc.nodeAt(referencePosition);
        if (!node) return;
        const normalized = ref
          ? (adapters.agentChat.normalizeReference(
              ref,
            ) as AgentComposerReference)
          : null;
        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            for (const duplicatePosition of positions.slice(1).reverse()) {
              const duplicate = tr.doc.nodeAt(duplicatePosition);
              if (duplicate) {
                tr.delete(
                  duplicatePosition,
                  duplicatePosition + duplicate.nodeSize,
                );
              }
            }
            if (normalized) {
              tr.setNodeMarkup(
                referencePosition,
                undefined,
                mentionReferenceAttrs(normalized),
              );
            } else {
              tr.delete(referencePosition, referencePosition + node.nodeSize);
            }
            return true;
          })
          .run();
      },
      getSelection() {
        if (!isComposerEditorUsable(editor)) return null;
        const { from, to, anchor, head } = editor.state.selection;
        return {
          start: from,
          end: to,
          direction:
            anchor === head ? "none" : anchor > head ? "backward" : "forward",
        };
      },
      setSelection(start, end = start, direction = "none") {
        if (
          !isComposerEditorUsable(editor) ||
          callsBeforeEditorRef.current.length > 0
        ) {
          callsBeforeEditorRef.current.push((latest) =>
            latest.setSelection(start, end, direction),
          );
          return;
        }
        const maxPosition = editor.state.doc.content.size;
        const boundedStart = Math.max(1, Math.min(start, maxPosition));
        const boundedEnd = Math.max(1, Math.min(end, maxPosition));
        const anchor = direction === "backward" ? boundedEnd : boundedStart;
        const head = direction === "backward" ? boundedStart : boundedEnd;
        editor.commands.focus();
        editor.view.dispatch(
          editor.state.tr.setSelection(
            TextSelection.create(editor.state.doc, anchor, head),
          ),
        );
      },
      dismissPopover() {
        if (!popoverStateRef.current) return false;
        closePopover();
        return true;
      },
    };
    latestHandleRef.current = handle;
    return handle;
  });

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
      const formattedText = formatVoiceTranscriptForComposer(text);

      const anchor = voiceAnchorRef.current;
      if (anchor != null) {
        const prevLen = prevVoiceInsertRef.current.length;
        if (formattedText) {
          ed.chain()
            .focus()
            .deleteRange({ from: anchor, to: anchor + prevLen })
            .insertContentAt(anchor, formattedText)
            .run();
        } else if (prevLen > 0) {
          ed.chain()
            .deleteRange({ from: anchor, to: anchor + prevLen })
            .run();
        }
        voiceAnchorRef.current = null;
        prevVoiceInsertRef.current = "";
      } else if (formattedText) {
        const { from } = ed.state.selection;
        const prevChar =
          from > 1 ? ed.state.doc.textBetween(from - 1, from) : "";
        const needsLead = prevChar && !/\s/.test(prevChar);
        ed.chain()
          .focus()
          .insertContent((needsLead ? " " : "") + formattedText)
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
      adapters.agentChat!.formatContextItems!(contextItems) ||
        formatPromptContextItems(contextItems),
      3200,
    );
    if (activeContext) {
      snippets.push({
        label: t("agentChat.composer.activeAppContext", {
          defaultValue: "Active app context",
        }),
        value: activeContext,
      });
    }

    const selectedReferences = trimVoiceContextValue(
      slotReferences.map((ref) => slotReferenceTitle(ref)).join(", "),
      1200,
    );
    if (selectedReferences) {
      snippets.push({
        label: t("agentChat.composer.selectedReferences", {
          defaultValue: "Selected references",
        }),
        value: selectedReferences,
      });
    }

    const draft = isComposerEditorUsable(editor)
      ? trimVoiceContextValue(editor.state.doc.textContent, 1200)
      : null;
    if (draft) {
      snippets.push({
        label: t("agentChat.composer.currentDraft", {
          defaultValue: "Current draft",
        }),
        value: draft,
      });
    }

    if (typeof document !== "undefined") {
      const title = trimVoiceContextValue(document.title, 160);
      if (title) {
        snippets.push({
          label: t("agentChat.composer.pageTitle", {
            defaultValue: "Page title",
          }),
          value: title,
        });
      }
    }

    if (typeof window !== "undefined") {
      const route = trimVoiceContextValue(window.location.pathname, 240);
      if (route) {
        snippets.push({
          label: t("agentChat.composer.route", { defaultValue: "Route" }),
          value: route,
        });
      }
    }

    if (snippets.length === 0) return undefined;
    return {
      surface: "agent-composer",
      mode: "dictation",
      snippets,
    };
  }, [adapters, contextItems, editor, slotReferences, t]);

  const voice = useVoiceDictation({
    onTranscript: insertTranscript,
    onLiveUpdate: handleLiveUpdate,
    contextPack: buildVoiceContextPack,
  });
  const voiceCancelRef = useRef(voice.cancel);
  voiceCancelRef.current = voice.cancel;
  // Escape cancels dictation through the window listener below; it must not
  // also stop the run.
  voiceCapturingRef.current =
    voice.state === "recording" || voice.state === "starting";

  // Clean up live text if voice session ends without a final transcript (cancel/error)
  useEffect(() => {
    if (voice.state === "idle" && voiceAnchorRef.current != null) {
      const anchor = voiceAnchorRef.current;
      const prevLen = prevVoiceInsertRef.current.length;
      if (isComposerEditorUsable(editor) && prevLen > 0) {
        const documentSize = editor.state.doc.content.size;
        const currentText =
          anchor >= 1 && anchor + prevLen <= documentSize
            ? editor.state.doc.textBetween(anchor, anchor + prevLen, "", "\n")
            : "";
        if (
          canRemoveVoicePreview({
            documentSize,
            anchor,
            previewText: prevVoiceInsertRef.current,
            currentText,
          })
        ) {
          editor
            .chain()
            .deleteRange({ from: anchor, to: anchor + prevLen })
            .run();
        }
      }
      voiceAnchorRef.current = null;
      prevVoiceInsertRef.current = "";
    }
  }, [voice.state, editor]);

  const voiceChatActiveRef = useRef(false);
  voiceChatActiveRef.current = voiceChat !== null;

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
        if (voiceChatActiveRef.current) return;
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
    const currentSlotReferences = slotReferencesRef.current;
    const ed = editor;
    if (!isComposerEditorUsable(ed)) {
      return {
        text: currentSlotReferences
          .map((ref) => slotReferenceTitle(ref))
          .join(", "),
        references: currentSlotReferences.map(referenceFromComposerReference),
      };
    }

    const references: Reference[] = currentSlotReferences.map(
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
      currentSlotReferences.map((ref) => slotReferenceTitle(ref)).join(", ");

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
  }, [editor]);

  const referencesSignatureRef = useRef("");
  useEffect(() => {
    if (!onReferencesChange) return;
    const references = extractComposerPayload().references;
    const signature = JSON.stringify(references);
    if (signature === referencesSignatureRef.current) return;
    referencesSignatureRef.current = signature;
    onReferencesChange(references);
  }, [
    referenceRevision,
    slotReferences,
    extractComposerPayload,
    onReferencesChange,
  ]);

  const syncComposerRuntimeState = useCallback(
    (text: string, references: Reference[]) => {
      const requestMode = planNextRef.current ? "plan" : undefined;
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
    [composerRuntime],
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

  const clearEditorAfterSubmit = useCallback(
    (
      expectedDraftSnapshot?: string | null,
      submittedSlotReferences?: AgentComposerReference[],
      clearText = true,
    ) => {
      const remainingSlotReferences =
        submittedSlotReferences === undefined
          ? []
          : slotReferencesRef.current.filter(
              (reference) => !submittedSlotReferences.includes(reference),
            );
      updateSlotReferences(remainingSlotReferences);
      if (!clearText) return;

      // A caller may close/unmount the host popover as soon as submit starts
      // (before awaiting the round trip), which destroys this editor instance
      // while the submit promise is still in flight. The persisted draft has
      // no dependency on the live editor, so it must be cleared unconditionally
      // here — gating it behind `isComposerEditorUsable` left the old prompt
      // stuck in localStorage forever, ready to resurface on the next mount.
      // `expectedDraftSnapshot` guards a narrower race: a fresh composer
      // instance may reuse this exact scope and persist its own draft before
      // this stale submit settles, so only clear when localStorage still
      // holds what this submit actually wrote.
      cancelScheduledDraftPersist();
      clearComposerDraft(draftKey, expectedDraftSnapshot);
      const ed = editor;
      if (isComposerEditorUsable(ed)) {
        ed.commands.clearContent();
        ed.commands.focus("end");
        setEditorHasText(false);
        resetComposerRuntimeState();
      }
      closePopover();
    },
    [
      cancelScheduledDraftPersist,
      closePopover,
      draftKey,
      editor,
      resetComposerRuntimeState,
      updateSlotReferences,
    ],
  );

  const submitComposerOnce = useCallback(
    async (
      intent: ComposerSubmitIntent = "immediate",
      textOverride: string | undefined,
      steer: boolean,
      optimistic: { handle?: ComposerSubmitStartHandle },
    ): Promise<boolean> => {
      let order = composerSubmitOrder(submitLocksRef.current);
      if (order === "behind" && !queuesBehindSubmission) order = "blocked";
      const submitIntent = steer
        ? "immediate"
        : willQueue || order === "behind"
          ? "queued"
          : intent;
      const ed = editor;
      if (!isComposerEditorUsable(ed)) return false;
      if (order === "blocked" || attachmentCleanupPendingRef.current > 0)
        return false;
      if (
        submissionDisabledRef.current ||
        !areComposerContextItemsReady(contextItemsRef.current)
      )
        return false;

      const attachmentScopeGeneration = draftScopeGenerationRef.current;
      const barrierLock: ComposerSubmitLock = { draftReleased: false };
      submitLocksRef.current.add(barrierLock);
      if (!onBeforeSubmit) reportSubmissionPending(true);
      const attachmentSubmissionBarrier = createAttachmentSubmissionBarrier();
      let attachmentSnapshot: typeof composerAttachments;
      try {
        attachmentSnapshot = await attachmentSubmissionBarrier;
      } catch (error) {
        if (
          mountedRef.current &&
          draftScopeGenerationRef.current === attachmentScopeGeneration
        ) {
          setContextSubmissionError(
            formatAttachmentError(
              error,
              t("agentChat.composer.submitFailed", {
                defaultValue: "Could not submit. Try again.",
              }),
            ),
          );
        }
        return false;
      } finally {
        submitLocksRef.current.delete(barrierLock);
        if (!onBeforeSubmit) reportSubmissionPending(false);
      }
      if (
        !isComposerEditorUsable(ed) ||
        draftScopeGenerationRef.current !== attachmentScopeGeneration ||
        draftKeyRef.current !== draftKey ||
        submissionDisabledRef.current ||
        !areComposerContextItemsReady(contextItemsRef.current)
      ) {
        return false;
      }
      if (
        composerRuntime
          .getState()
          .attachments.some((current) =>
            failedAttachmentCleanupSnapshots.some((submitted) =>
              isSameComposerAttachment(current, submitted),
            ),
          )
      ) {
        setContextSubmissionError(
          t("agentChat.composer.attachmentsRemainAfterSubmit", {
            defaultValue:
              "The message was sent, but some attachments remain. Remove them before sending again.",
          }),
        );
        return false;
      }
      setContextSubmissionError(null);
      let contextSnapshot: ComposerContextSnapshot | undefined;

      draftEditorRef.current = ed;
      flushComposerDraft();
      const submittingDraftKey = draftKeyRef.current;
      const submittingDraftGeneration = draftScopeGenerationRef.current;
      // Snapshot exactly what flushComposerDraft just persisted so a
      // same-scope draft written by a later, unrelated composer instance
      // (see clearComposerDraft) is never mistaken for this submission's.
      let submittingDraftSnapshot = submittingDraftKey
        ? (() => {
            try {
              return localStorage.getItem(submittingDraftKey);
            } catch {
              // coercion-ok: browser storage is optional and can be unavailable or full; treat as "nothing to compare against" like the rest of this file's draft helpers.
              return null;
            }
          })()
        : null;
      const isCurrentDraftScope = () =>
        draftKeyRef.current === submittingDraftKey &&
        draftScopeGenerationRef.current === submittingDraftGeneration;
      let { text: draftText, references } = syncComposerState();
      let text = textOverride ?? draftText;
      const submittedAsPlan = planNextRef.current;
      let submittedPlanCleared = false;
      // Once: after the draft leaves, the chip belongs to the next draft.
      const clearSubmittedPlan = () => {
        if (submittedPlanCleared) return;
        submittedPlanCleared = true;
        if (submittedAsPlan && mountedRef.current && isCurrentDraftScope()) {
          setPlanNextState(false);
        }
      };
      let attachments = attachmentSnapshot;
      let submittedSlotReferences = slotReferencesRef.current;
      let submittedEditorDocument = ed.state.doc;
      let submittedDraftHtml = ed.getHTML();
      if (!text.trim() && references.length === 0 && attachments.length === 0) {
        if (!onEmptySubmit) return false;
        try {
          await onEmptySubmit();
          return true;
        } catch (error) {
          setContextSubmissionError(
            formatAttachmentError(
              error,
              t("agentChat.composer.submitFailed", {
                defaultValue: "Could not submit. Try again.",
              }),
            ),
          );
          return false;
        }
      }
      const oversizedDocumentError = getOversizedDocumentAttachmentError(
        attachments,
        {
          maxBytes: maxDocumentAttachmentBytes,
          label: documentAttachmentLimitLabel,
          translate: t,
        },
      );
      if (oversizedDocumentError) {
        onAttachmentErrorRef.current?.(oversizedDocumentError);
        return false;
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
      let trimmed = text.trim();
      const handleLocalSubmission = () => {
        if (trimmed.startsWith("/") && references.length === 0) {
          const cmdName = normalizeSlashCommandName(trimmed);
          const matched = allSlashCommands.find((c) => c.name === cmdName);
          if (matched) {
            clearEditorAfterSubmit();
            announceSlashCommand(matched);
            return true;
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
          adapters.builder!.tryDelegateBuildRequest!(trimmed)
        ) {
          cancelActiveVoice();
          clearEditorAfterSubmit();
          return true;
        }
        return false;
      };

      const clearSubmittedDraft = () => {
        if (
          !isComposerEditorUsable(ed) ||
          ed.state.doc.eq(submittedEditorDocument)
        ) {
          clearEditorAfterSubmit(
            submittingDraftSnapshot,
            submittedSlotReferences,
          );
          return true;
        }

        clearEditorAfterSubmit(
          submittingDraftSnapshot,
          submittedSlotReferences,
          false,
        );
        const currentDocument = ed.state.doc;
        const submittedDocumentSize = submittedEditorDocument.content.size;
        const sameBlockCount =
          currentDocument.content.childCount ===
          submittedEditorDocument.content.childCount;
        const submittedPrefixSize =
          submittedDocumentSize - (sameBlockCount ? 1 : 0);
        const currentText = extractComposerPayload().text;
        if (
          textOverride === undefined &&
          text.length > 0 &&
          currentText.startsWith(text) &&
          currentText.length > text.length &&
          isCurrentDraftScope() &&
          submittedPrefixSize <= currentDocument.content.size &&
          currentDocument.content
            .cut(0, submittedPrefixSize)
            .eq(submittedEditorDocument.content)
        ) {
          const followUpDocument =
            currentDocument.content.cut(submittedPrefixSize);
          ed.commands.setContent({
            type: "doc",
            content: followUpDocument.toJSON(),
          });
          const current = syncComposerState();
          if (!current.text && current.references.length === 0) {
            clearEditorAfterSubmit(submittingDraftSnapshot, [], true);
          } else {
            flushComposerDraft();
          }
          return true;
        }

        return false;
      };

      const clearImmediately = clearOnSubmitImmediately && clearOnSubmit;
      const clearedBeforePreflight =
        clearImmediately && Boolean(onBeforeSubmit);
      const restoreSubmittedDraft = (preserveFollowUp = false) => {
        const forkScope = getSubmitFailureDraftScope?.();
        if (!clearImmediately && !forkScope) return;
        const recoveryKey = forkScope
          ? getComposerDraftKey(forkScope)
          : submittingDraftKey;
        const isForkRecovery = recoveryKey !== submittingDraftKey;
        if (isForkRecovery) {
          clearComposerDraft(submittingDraftKey, submittingDraftSnapshot);
        }
        let currentDraft: string | null = null;
        try {
          currentDraft = recoveryKey ? localStorage.getItem(recoveryKey) : null;
        } catch {
          // coercion-ok: Browser storage is optional and can be unavailable or full.
        }
        const editorIsCurrentScope =
          isComposerEditorUsable(ed) && draftKeyRef.current === recoveryKey;
        const hasFollowUp =
          editorIsCurrentScope &&
          (composerDocumentHasContent(ed.state.doc) ||
            slotReferencesRef.current.length > 0);
        const canPreserveFollowUp =
          preserveFollowUp &&
          !isForkRecovery &&
          hasFollowUp &&
          (currentDraft === null ||
            currentDraft === submittingDraftSnapshot ||
            (() => {
              try {
                const savedDraft = readComposerDraft(currentDraft);
                return (
                  savedDraft.html === ed.getHTML() &&
                  JSON.stringify(savedDraft.slotReferences) ===
                    JSON.stringify(slotReferencesRef.current)
                );
              } catch {
                // coercion-ok: Never overwrite an unreadable stored draft.
                return false;
              }
            })());
        if (
          currentDraft !== null &&
          (isForkRecovery || currentDraft !== submittingDraftSnapshot) &&
          !canPreserveFollowUp
        ) {
          return;
        }

        if (editorIsCurrentScope) {
          if (hasFollowUp && !canPreserveFollowUp) {
            return;
          }
          if (canPreserveFollowUp) {
            ed.commands.setContent({
              type: "doc",
              content: [
                ...(composerDocumentHasContent(submittedEditorDocument)
                  ? submittedEditorDocument.content.content.map((node) =>
                      node.toJSON(),
                    )
                  : []),
                ...(composerDocumentHasContent(ed.state.doc)
                  ? ed.state.doc.content.content.map((node) => node.toJSON())
                  : []),
              ],
            });
            updateSlotReferences(
              applySlotReferenceChanges(
                submittedSlotReferences,
                slotReferencesRef.current,
              ),
            );
          } else {
            ed.commands.setContent(submittedEditorDocument.toJSON());
            updateSlotReferences(submittedSlotReferences);
          }
          const restored = syncComposerState();
          setEditorHasText(
            restored.text.trim().length > 0 || restored.references.length > 0,
          );
          onTextChangeRef.current?.(restored.text);
          flushComposerDraft();
          return;
        }

        if (
          composerDocumentHasContent(submittedEditorDocument) ||
          submittedSlotReferences.length > 0
        ) {
          writeComposerDraft(
            recoveryKey,
            submittedDraftHtml,
            submittedSlotReferences,
          );
        }
      };

      if (handleLocalSubmission()) return true;

      const startOptimisticSubmission = () => {
        const start = onSubmitStartRef.current;
        if (!start || optimistic.handle) return;
        const startMode = composerMode
          ? localizedComposerModeConfig(composerMode, t)
          : undefined;
        const handle = start({
          text: startMode
            ? displayableComposerModeMessage({
                messagePrefix: startMode.messagePrefix,
                trimmedText: trimmed,
                attachmentCount: attachments.length,
                attachedContextFallback: t(
                  "agentChat.composer.useAttachedContext",
                  { defaultValue: "Use the attached context." },
                ),
              })
            : text,
          references,
          attachments: attachments.map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            ...(attachment.contentType
              ? { contentType: attachment.contentType }
              : {}),
            ...(isBlob(attachment.file) ? { file: attachment.file } : {}),
          })),
          intent: submitIntent,
        });
        if (!handle) return;
        optimistic.handle = handle;
        if (attachments.length) {
          onOptimisticAttachmentsChangeRef.current?.(
            attachments.map((attachment) => attachment.id),
          );
        }
      };
      // A preflight that rereads the editor can still change the text, so the
      // optimistic copy waits for it; a cleared editor has nothing to reread.
      if (!onBeforeSubmit || clearedBeforePreflight) {
        startOptimisticSubmission();
      }

      if (clearedBeforePreflight) {
        cancelActiveVoice();
        clearEditorAfterSubmit(
          submittingDraftSnapshot,
          submittedSlotReferences,
        );
      }

      if (onBeforeSubmit) {
        const preflightLock: ComposerSubmitLock = {
          draftReleased: clearedBeforePreflight,
        };
        submitLocksRef.current.add(preflightLock);
        try {
          const shouldSubmit = await onBeforeSubmit(
            composerDraftSnapshot(text, references, attachments),
          );
          if (!shouldSubmit) {
            restoreSubmittedDraft(true);
            return false;
          }
        } catch (error) {
          restoreSubmittedDraft(true);
          if (mountedRef.current && isCurrentDraftScope()) {
            setContextSubmissionError(
              formatAttachmentError(
                error,
                t("agentChat.composer.submitFailed", {
                  defaultValue: "Could not submit. Try again.",
                }),
              ),
            );
          }
          return false;
        } finally {
          submitLocksRef.current.delete(preflightLock);
        }
      }
      if (
        !isComposerEditorUsable(ed) ||
        !isCurrentDraftScope() ||
        submissionDisabledRef.current ||
        !areComposerContextItemsReady(contextItemsRef.current)
      ) {
        restoreSubmittedDraft(true);
        return false;
      }

      if (onBeforeSubmit && !clearedBeforePreflight) {
        const preflightLock: ComposerSubmitLock = { draftReleased: false };
        submitLocksRef.current.add(preflightLock);
        reportSubmissionPending(true);
        let preflightAttachmentSnapshot: typeof composerAttachments;
        try {
          preflightAttachmentSnapshot =
            await createAttachmentSubmissionBarrier();
        } catch (error) {
          restoreSubmittedDraft(true);
          if (mountedRef.current && isCurrentDraftScope()) {
            setContextSubmissionError(
              formatAttachmentError(
                error,
                t("agentChat.composer.submitFailed", {
                  defaultValue: "Could not submit. Try again.",
                }),
              ),
            );
          }
          return false;
        } finally {
          submitLocksRef.current.delete(preflightLock);
          reportSubmissionPending(false);
        }

        const current = syncComposerState();
        if (textOverride === undefined) {
          text = current.text;
          submittedEditorDocument = ed.state.doc;
          submittedDraftHtml = ed.getHTML();
        }
        references = current.references;
        submittedSlotReferences = slotReferencesRef.current;
        attachments = preflightAttachmentSnapshot;
        trimmed = text.trim();
        if (
          !text.trim() &&
          references.length === 0 &&
          attachments.length === 0
        ) {
          return false;
        }
        const currentOversizedDocumentError =
          getOversizedDocumentAttachmentError(attachments, {
            maxBytes: maxDocumentAttachmentBytes,
            label: documentAttachmentLimitLabel,
            translate: t,
          });
        if (currentOversizedDocumentError) {
          onAttachmentErrorRef.current?.(currentOversizedDocumentError);
          return false;
        }
        flushComposerDraft();
        submittingDraftSnapshot = submittingDraftKey
          ? (() => {
              try {
                return localStorage.getItem(submittingDraftKey);
              } catch {
                // coercion-ok: browser storage is optional and can be unavailable or full; treat as "nothing to compare against" like the rest of this file's draft helpers.
                return null;
              }
            })()
          : null;
        if (textOverride === undefined && handleLocalSubmission()) return true;
        startOptimisticSubmission();
      }

      try {
        contextSnapshot = snapshotComposerContextItems(
          contextItemsProvidedRef.current ? contextItemsRef.current : undefined,
        );
      } catch (error) {
        if (!(error instanceof ComposerContextError)) {
          restoreSubmittedDraft(true);
          throw error;
        }
        if (error.code === "not-ready") {
          restoreSubmittedDraft(true);
          return false;
        }
        setContextSubmissionError(
          t("agentChat.composer.contextLimitExceeded", {
            defaultValue:
              "Context is too large. Remove an item or attach a smaller selection.",
          }),
        );
        restoreSubmittedDraft(true);
        return false;
      }

      const modeConfig = composerMode
        ? localizedComposerModeConfig(composerMode, t)
        : undefined;
      const modePrompt =
        trimmed ||
        (attachments.length > 0
          ? t("agentChat.composer.useAttachedContext", {
              defaultValue: "Use the attached context.",
            })
          : "");
      const composerModeContext = modeConfig?.getContext(modePrompt);
      const submissionText = modeConfig
        ? displayableComposerModeMessage({
            messagePrefix: modeConfig.messagePrefix,
            trimmedText: trimmed,
            attachmentCount: attachments.length,
            attachedContextFallback: t(
              "agentChat.composer.useAttachedContext",
              {
                defaultValue: "Use the attached context.",
              },
            ),
          })
        : text;

      // Raw Tiptap hosts without a submit handler retain the legacy bridge.
      if (modeConfig && !onSubmit) {
        modeConfig.beforeSend?.();
        const contextItemsText = contextSnapshot?.length
          ? formatPromptContextItems(contextSnapshot)
          : "";
        const context = contextItemsText
          ? `${composerModeContext}\n\n${contextItemsText}`
          : composerModeContext;
        if (attachments.length > 0) {
          composerRuntime.setText(
            `${submissionText}\n\n<context>\n${context}\n</context>`,
          );
          composerRuntime.send();
        } else {
          adapters.agentChat!.sendToAgentChat!({
            message: submissionText,
            context,
            ...(contextSnapshot === undefined
              ? {}
              : { contextItems: contextSnapshot }),
            ...(submittedAsPlan ? { mode: "plan" as const } : {}),
            submit: true,
          });
        }
        cancelActiveVoice();
        if (clearedBeforePreflight || clearSubmittedDraft()) {
          setComposerMode(null);
          composerModeRef.current = null;
        }
        clearSubmittedPlan();
        return true;
      }

      const currentOnSubmit = onSubmitRef.current;
      if (currentOnSubmit) {
        if (composerSubmitOrder(submitLocksRef.current) === "blocked")
          return false;
        const submittedAttachments = [...attachments];
        const submittedScopeGeneration = draftScopeGenerationRef.current;
        submittingAttachmentIdsRef.current = new Set([
          ...submittingAttachmentIdsRef.current,
          ...submittedAttachments.map((attachment) => attachment.id),
        ]);
        const submitLock: ComposerSubmitLock = { draftReleased: false };
        submitLocksRef.current.add(submitLock);
        let textReleased = clearedBeforePreflight;
        let attachmentsReleased = submittedAttachments.length === 0;
        const releaseDraft = () => {
          if (!textReleased || !attachmentsReleased) return;
          submitLock.draftReleased = true;
          clearSubmittedPlan();
        };
        releaseDraft();
        let locallySubmitted = false;
        let settled = false;
        let submittedAttachmentCleanup = Promise.resolve();
        const clearSubmittedAttachmentIds = () => {
          const remaining = new Set(submittingAttachmentIdsRef.current);
          for (const attachment of submittedAttachments) {
            remaining.delete(attachment.id);
          }
          submittingAttachmentIdsRef.current = remaining;
        };
        const recordFailedAttachmentCleanup = () => {
          const remainingAttachments = composerRuntime.getState().attachments;
          setFailedAttachmentCleanupSnapshots((failed) => [
            ...failed,
            ...submittedAttachments.filter((submitted) =>
              remainingAttachments.some((current) =>
                isSameComposerAttachment(current, submitted),
              ),
            ),
          ]);
          setContextSubmissionError(
            t("agentChat.composer.attachmentsRemainAfterSubmit", {
              defaultValue:
                "The message was sent, but some attachments remain. Remove them before sending again.",
            }),
          );
        };
        const reconcileFailedSubmissionAttachments = async () => {
          let releaseBarrier!: () => void;
          const submissionBarrier = new Promise<void>((resolve) => {
            releaseBarrier = resolve;
          });
          const pendingAddQueue = attachmentAddQueueRef.current;
          const pendingScopeAdds = [
            ...(pendingAttachmentAddsRef.current.get(
              submittedScopeGeneration,
            ) ?? []),
          ];
          const failedDuplicateAttachments: (typeof composerAttachments)[number][] =
            [];
          attachmentSubmissionBarrierRef.current = submissionBarrier;
          try {
            await pendingAddQueue;
            await Promise.all(pendingScopeAdds);
            if (
              !mountedRef.current ||
              !isCurrentDraftScope() ||
              draftScopeGenerationRef.current !== submittedScopeGeneration
            )
              return;

            const retainedSubmittedAttachments = submittedAttachments.filter(
              (submitted) =>
                composerRuntime
                  .getState()
                  .attachments.some((current) =>
                    isSameComposerAttachment(current, submitted),
                  ),
            );
            const submittedFileInputs = retainedSubmittedAttachments.flatMap(
              (attachment) =>
                isBlob(attachment.file)
                  ? [
                      {
                        file: attachment.file,
                        name: attachment.name,
                        contentType: normalizeAttachmentContentType(
                          attachment.contentType,
                        ),
                      },
                    ]
                  : [],
            );
            const comparisonBudget = {
              remainingBytes: MAX_ATTACHMENT_COMPARISON_BYTES,
              remainingComparisons: MAX_ATTACHMENT_COMPARISONS,
            };
            let cleanupFailed = false;
            let cleanupError: unknown;
            for (const attachment of composerRuntime.getState().attachments) {
              if (
                submittedAttachments.some((submitted) =>
                  isSameComposerAttachment(attachment, submitted),
                ) ||
                !isBlob(attachment.file)
              )
                continue;
              const candidate = {
                file: attachment.file,
                name: attachment.name,
                contentType: normalizeAttachmentContentType(
                  attachment.contentType,
                ),
              };
              let duplicatesSubmittedAttachment = false;
              for (const submittedFile of submittedFileInputs) {
                if (comparisonBudget.remainingComparisons === 0) break;
                if (
                  await haveSameAttachmentInput(
                    candidate,
                    submittedFile,
                    comparisonBudget,
                  )
                ) {
                  duplicatesSubmittedAttachment = true;
                  break;
                }
              }
              if (!duplicatesSubmittedAttachment) continue;
              try {
                const index = composerRuntime
                  .getState()
                  .attachments.findIndex((item) =>
                    isSameComposerAttachment(item, attachment),
                  );
                if (index >= 0) {
                  await composerRuntime.getAttachmentByIndex(index).remove();
                }
              } catch (error) {
                cleanupFailed = true;
                cleanupError ??= error;
                failedDuplicateAttachments.push(attachment);
              }
            }
            if (cleanupFailed) throw cleanupError;
          } catch (error) {
            if (mountedRef.current && isCurrentDraftScope()) {
              const remainingFailedDuplicates =
                failedDuplicateAttachments.filter((failedDuplicate) =>
                  composerRuntime
                    .getState()
                    .attachments.some((current) =>
                      isSameComposerAttachment(current, failedDuplicate),
                    ),
                );
              if (remainingFailedDuplicates.length > 0) {
                setFailedAttachmentCleanupSnapshots((failed) => [
                  ...failed,
                  ...remainingFailedDuplicates.filter(
                    (candidate) =>
                      !failed.some((current) =>
                        isSameComposerAttachment(current, candidate),
                      ),
                  ),
                ]);
              }
              onAttachmentErrorRef.current?.(
                error instanceof Error ? error.message : String(error),
              );
            }
            console.error(
              "Could not reconcile submitted composer attachments",
              error,
            );
          } finally {
            clearSubmittedAttachmentIds();
            if (attachmentSubmissionBarrierRef.current === submissionBarrier) {
              attachmentSubmissionBarrierRef.current = Promise.resolve();
            }
            releaseBarrier();
          }
        };
        reportSubmissionPending(true);
        const clearSubmittedComposer = () => {
          if (clearOnSubmit) {
            clearComposerDraft(submittingDraftKey, submittingDraftSnapshot);
          }
          if (!mountedRef.current || !isCurrentDraftScope()) return;
          // Remove by captured identity; later uploads belong to the next draft.
          attachmentCleanupPendingRef.current += 1;
          const cleanup = attachmentCleanupRef.current.then(async () => {
            const results = await Promise.allSettled(
              submittedAttachments.map(async (attachment) => {
                const index = composerRuntime
                  .getState()
                  .attachments.findIndex((item) =>
                    isSameComposerAttachment(item, attachment),
                  );
                return index < 0
                  ? undefined
                  : composerRuntime.getAttachmentByIndex(index).remove();
              }),
            );
            const failedRemoval = results.find(
              (result) => result.status === "rejected",
            );
            if (failedRemoval?.status === "rejected") {
              throw failedRemoval.reason;
            }
          });
          submittedAttachmentCleanup = cleanup
            .then(() => {
              attachmentsReleased = true;
              releaseDraft();
            })
            .catch((error) => {
              if (mountedRef.current && isCurrentDraftScope()) {
                onAttachmentErrorRef.current?.(
                  error instanceof Error ? error.message : String(error),
                );
                recordFailedAttachmentCleanup();
              }
              console.error("Could not clear submitted attachments", error);
            })
            .finally(() => {
              attachmentCleanupPendingRef.current -= 1;
            });
          if (!isComposerEditorUsable(ed)) return;
          if (!clearOnSubmit) {
            closePopover();
            return;
          }
          if (ed.state.doc !== submittedEditorDocument) {
            flushComposerDraft();
            return;
          }
          cancelActiveVoice();
          cancelScheduledDraftPersist();
          ed.commands.clearContent();
          ed.commands.focus("end");
          setEditorHasText(false);
          setSlotReferences((current) =>
            current.filter(
              (reference) => !submittedSlotReferences.includes(reference),
            ),
          );
          if (composerModeRef.current === composerMode) {
            setComposerMode(null);
            composerModeRef.current = null;
          }
          clearSubmittedPlan();
          resetComposerRuntimeState();
          closePopover();
          textReleased = true;
          releaseDraft();
        };
        const onLocalSubmit = () => {
          if (settled || locallySubmitted || !clearOnSubmit) return;
          // A suggested prompt does not transfer ownership of an unrelated draft.
          if (draftText && text !== draftText) return;
          locallySubmitted = true;
          clearSubmittedComposer();
        };
        try {
          setContextSubmissionError(null);
          if (clearImmediately && !clearedBeforePreflight) {
            cancelActiveVoice();
            textReleased = clearSubmittedDraft();
            releaseDraft();
          }
          await currentOnSubmit(
            submissionText,
            references,
            submittedAttachments,
            {
              intent: submitIntent,
              ...(steer ? { steer: true } : {}),
              onLocalSubmit,
              ...(optimistic.handle
                ? { submissionId: optimistic.handle.id }
                : {}),
              ...(composerModeContext === undefined
                ? {}
                : { composerModeContext }),
              ...(contextSnapshot === undefined
                ? {}
                : { contextItems: contextSnapshot }),
              ...(submittedAsPlan ? { requestMode: "plan" as const } : {}),
            },
          );
        } catch (error) {
          if (locallySubmitted) {
            restoreSubmittedDraft(true);
            if (submittedAsPlan && mountedRef.current && isCurrentDraftScope())
              setPlanNextState(true);
            await submittedAttachmentCleanup;
            clearSubmittedAttachmentIds();
            return true;
          }
          restoreSubmittedDraft(true);
          if (submittedAsPlan && mountedRef.current && isCurrentDraftScope())
            setPlanNextState(true);
          if (
            mountedRef.current &&
            isCurrentDraftScope() &&
            !optimistic.handle
          ) {
            setContextSubmissionError(
              formatAttachmentError(
                error,
                t("agentChat.composer.submitFailed", {
                  defaultValue: "Could not submit. Try again.",
                }),
              ),
            );
          }
          await reconcileFailedSubmissionAttachments();
          return false;
        } finally {
          settled = true;
          submitLocksRef.current.delete(submitLock);
          reportSubmissionPending(false);
        }
        clearSubmittedPlan();

        if (!isCurrentDraftScope()) {
          clearComposerDraft(submittingDraftKey, submittingDraftSnapshot);
          if (locallySubmitted) await submittedAttachmentCleanup;
          clearSubmittedAttachmentIds();
          return true;
        }
        if (!locallySubmitted) {
          const clearSubmittedAttachments = attachmentCleanupRef.current.then(
            async () => {
              for (const attachment of submittedAttachments) {
                const index = composerRuntime
                  .getState()
                  .attachments.findIndex((item) =>
                    isSameComposerAttachment(item, attachment),
                  );
                if (index === -1) continue;
                await composerRuntime.getAttachmentByIndex(index).remove();
              }
            },
          );
          attachmentCleanupRef.current = clearSubmittedAttachments.then(
            () => undefined,
            () => undefined,
          );
          if (clearOnSubmit && !clearOnSubmitImmediately) {
            cancelActiveVoice();
            if (
              clearSubmittedDraft() &&
              composerModeRef.current === composerMode
            ) {
              setComposerMode(null);
              composerModeRef.current = null;
            }
          }
          attachmentCleanupPendingRef.current += 1;
          try {
            await clearSubmittedAttachments;
          } catch {
            recordFailedAttachmentCleanup();
            return true;
          } finally {
            attachmentCleanupPendingRef.current -= 1;
            clearSubmittedAttachmentIds();
          }
        }
        await submittedAttachmentCleanup;
        clearSubmittedAttachmentIds();
        if (!clearOnSubmit) {
          closePopover();
          return true;
        }
        if (mountedRef.current && isCurrentDraftScope())
          modeConfig?.beforeSend?.();
        return true;
      } else {
        if (textOverride !== undefined) composerRuntime.setText(text);
        composerRuntime.send();
      }
      cancelActiveVoice();
      if (!clearedBeforePreflight) clearSubmittedDraft();
      clearSubmittedPlan();
      return true;
    },
    [
      closePopover,
      clearEditorAfterSubmit,
      cancelScheduledDraftPersist,
      composerMode,
      composerRuntime,
      draftKey,
      editor,
      failedAttachmentCleanupSnapshots,
      cleanStaleAttachments,
      createAttachmentSubmissionBarrier,
      flushComposerDraft,
      interceptBuildRequestsForBuilder,
      clearOnSubmit,
      clearOnSubmitImmediately,
      getSubmitFailureDraftScope,
      onBeforeSubmit,
      onEmptySubmit,
      reportSubmissionPending,
      extractComposerPayload,
      syncComposerState,
      updateSlotReferences,
      slotReferences,
      resetComposerRuntimeState,
      setPlanNextState,
      voice,
      allSlashCommands,
      announceSlashCommand,
      willQueue,
      queuesBehindSubmission,
      t,
    ],
  );
  const submitComposer = useCallback(
    async (
      intent?: ComposerSubmitIntent,
      textOverride?: string,
      steer = false,
    ): Promise<boolean> => {
      const optimistic: { handle?: ComposerSubmitStartHandle } = {};
      try {
        return await submitComposerOnce(
          intent,
          textOverride,
          steer,
          optimistic,
        );
      } finally {
        if (optimistic.handle) {
          onOptimisticAttachmentsChangeRef.current?.([]);
          optimistic.handle.end();
        }
      }
    },
    [submitComposerOnce],
  );

  // Helper functions that operate on the editor view directly
  // These are called from handleKeyDown which can't use React state
  function insertSelectedMention(
    pop: NonNullable<PopoverState>,
    item: MentionItem,
  ) {
    const ed = editor;
    if (!isComposerEditorUsable(ed)) return;
    const { from: deleteFrom, to: currentPos } = popoverTokenRange(
      ed,
      pop.type,
    );
    if (item.source === COMPOSER_CONTEXT_ENTRY_SOURCE && item.refId) {
      ed.chain()
        .focus()
        .deleteRange({ from: deleteFrom, to: currentPos })
        .run();
      setContextEntryRequest({ id: item.refId });
      return;
    }
    const normalized = adapters.agentChat!.normalizeReference!(
      composerReferenceFromMentionItem(item),
    ) as AgentComposerReference | null;
    if (!normalized) return;
    if (normalized.slotKey) {
      ed.chain()
        .focus()
        .deleteRange({ from: deleteFrom, to: currentPos })
        .run();
      insertReference(normalized);
      return;
    }
    if (normalized.relatedReferences?.some((reference) => reference.slotKey)) {
      updateSlotReferences((current) =>
        applySlotReferenceChanges(current, normalized.relatedReferences ?? []),
      );
    }
    if (item.replaceExisting) {
      let existingPosition: number | null = null;
      ed.state.doc.descendants((node: any, pos: number) => {
        if (
          existingPosition === null &&
          node.type.name === "mentionReference" &&
          node.attrs.refType === normalized.refType
        ) {
          existingPosition = pos;
          return false;
        }
      });
      if (existingPosition !== null) {
        const position = existingPosition;
        ed.chain()
          .focus()
          .command(({ tr }) => {
            tr.delete(deleteFrom, currentPos);
            tr.setNodeMarkup(
              tr.mapping.map(position),
              undefined,
              mentionReferenceAttrs(normalized),
            );
            tr.insertText(" ", tr.selection.from);
            return true;
          })
          .run();
        setEditorHasText(true);
        return;
      }
    }
    ed.chain()
      .focus()
      .deleteRange({ from: deleteFrom, to: currentPos })
      .insertContent({
        type: "mentionReference",
        attrs: mentionReferenceAttrs(normalized),
      })
      .insertContent(" ")
      .run();
    setEditorHasText(true);
  }

  function selectMention(
    _view: any,
    pop: NonNullable<PopoverState>,
    item: MentionItem,
  ) {
    insertSelectedMention(pop, item);
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
    ed.chain().focus().deleteRange(popoverTokenRange(ed, pop.type)).run();
    popoverStateRef.current = null;
    setPopover(null);
    announceSlashCommand(command);
  }

  function selectSkill(
    _view: any,
    pop: NonNullable<PopoverState>,
    skill: SkillResult,
  ) {
    const ed = editor;
    if (!isComposerEditorUsable(ed)) return;
    ed.chain()
      .focus()
      .deleteRange(popoverTokenRange(ed, pop.type))
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
      if (!popover) return;
      insertSelectedMention(popover, item);
      closePopover();
    },
    [popover, closePopover, insertReference],
  );

  const handleSelectCommand = useCallback(
    (command: SlashCommand) => {
      if (!isComposerEditorUsable(editor) || !popover) return;
      editor
        .chain()
        .focus()
        .deleteRange(popoverTokenRange(editor, popover.type))
        .run();
      closePopover();
      announceSlashCommand(command);
    },
    [editor, popover, closePopover, announceSlashCommand],
  );

  const handleSelectSkill = useCallback(
    (skill: SkillResult) => {
      if (!isComposerEditorUsable(editor) || !popover) return;
      editor
        .chain()
        .focus()
        .deleteRange(popoverTokenRange(editor, popover.type))
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

  const popoverOpen = popover !== null;
  useLayoutEffect(() => {
    if (!popoverOpen || !isComposerEditorUsable(editor)) return;
    const frame =
      editor.view.dom.closest<HTMLElement>(
        '[data-agent-composer-slot="root"]',
      ) ?? editor.view.dom;
    const measure = () => {
      const current = popoverStateRef.current;
      if (!current || !isComposerEditorUsable(editor)) return;
      const position = getComposerPopoverAnchorPosition(
        editor.view,
        editor.state.selection.from,
      );
      if (!position) return;
      const updated = { ...current, position };
      popoverStateRef.current = updated;
      setPopover(updated);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [editor, popoverOpen]);

  // Track query text as user types after trigger
  useEffect(() => {
    if (!isComposerEditorUsable(editor) || !popover) return;

    const updateHandler = () => {
      if (composingRef.current) return;
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

    // Keys typed before the menu opened never reached this listener.
    updateHandler();
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
    if (initialText !== undefined) return;
    if (previousDraftKeyRef.current !== draftKey) return;
    if (composerText !== "") return;
    if (editor.isEmpty) return;
    editor.commands.clearContent();
  }, [composerText, draftKey, editor, initialText]);

  useEffect(() => {
    if (!isComposerEditorUsable(editor)) return;
    const draftKeyChanged = previousDraftKeyRef.current !== draftKey;
    previousDraftKeyRef.current = draftKey;
    if (draftKeyChanged) {
      voiceAnchorRef.current = null;
      prevVoiceInsertRef.current = "";
      voiceCancelRef.current();
      editor.commands.clearContent(false);
      initialTextKeyRef.current = undefined;
      hasCheckedInitialDraftRef.current = false;
      setEditorHasText(false);
      updateSlotReferences([]);
      setComposerMode(null);
      composerModeRef.current = null;
      setPlanNextState(false);
      lastComposerRuntimeSyncRef.current = null;
      composerRuntime.setText("");
      const cleanupGeneration = draftScopeGenerationRef.current;
      attachmentCleanupRef.current = attachmentCleanupRef.current
        .then(() => composerRuntime.clearAttachments())
        .catch((error) => {
          if (draftScopeGenerationRef.current === cleanupGeneration) {
            console.error(
              "Could not clear attachments while changing composer scope",
              error,
            );
          }
        });
      onTextChangeRef.current?.("");
    }
    const key = initialTextKey ?? initialText;
    let saved: string | null = null;
    if (draftKey) {
      try {
        saved = localStorage.getItem(draftKey);
      } catch {
        // coercion-ok: browser storage is optional and can be unavailable or full.
      }
    }
    const shouldRestoreSavedDraft = !hasCheckedInitialDraftRef.current;
    hasCheckedInitialDraftRef.current = true;
    const savedDraft = saved ? readComposerDraft(saved) : null;

    try {
      if (savedDraft && editor.isEmpty && shouldRestoreSavedDraft) {
        editor.commands.setContent(savedDraft.html);
        updateSlotReferences(savedDraft.slotReferences);
        editor.commands.focus("end");
        if (initialText !== undefined) initialTextKeyRef.current = key;
      } else if (initialText === undefined) {
        onTextChangeRef.current?.(
          editor.getText({ blockSeparator: "\n" }).trim(),
        );
        return;
      } else if (initialTextKeyRef.current !== key) {
        initialTextKeyRef.current = key;
        editor.commands.setContent(
          plainTextToDoc(initialText, textChips(initialReferencesRef.current)),
        );
      } else {
        return;
      }
      const trimmed = editor.getText({ blockSeparator: "\n" }).trim();
      setEditorHasText(
        composerDocumentHasContent(editor.state.doc) ||
          slotReferencesRef.current.length > 0,
      );
      composerRuntime.setText(trimmed);
      onTextChangeRef.current?.(trimmed);
      scheduleComposerDraftPersist(editor);
    } catch {
      // coercion-ok: a stale editor during unmount should not block the refresh path.
    }
  }, [
    composerRuntime,
    draftKey,
    editor,
    initialText,
    initialTextKey,
    scheduleComposerDraftPersist,
    setPlanNextState,
    textChips,
    updateSlotReferences,
  ]);

  // Tiptap only reads `editable` at init; prop changes need setEditable.
  useEffect(() => {
    if (!isComposerEditorUsable(editor)) return;
    editor.setEditable(!editorLocked);
    if (!editorLocked) return;
    editor.commands.blur();
    closePopover();
  }, [editor, editorLocked, closePopover]);

  useEffect(() => {
    if (!isComposerEditorUsable(editor)) return;
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: {
          ...(editor.options.editorProps?.attributes as
            | Record<string, string>
            | undefined),
          "aria-disabled": String(editorLocked),
        },
      },
    });
  }, [editor, editorLocked]);

  const launchersDisabled = disabled || contextControlsDisabled;

  const contextLauncherItems = useMemo(() => {
    const sections = new Map<string, ComposerContextMenuItem[]>();
    for (const item of filteredMentionItems) {
      const section = item.section || "Other";
      const entries = sections.get(section) ?? [];
      entries.push({
        id: `mention:${item.id}`,
        label: item.label,
        description: item.description,
        onSelect: () => insertReference(composerReferenceFromMentionItem(item)),
      });
      sections.set(section, entries);
    }
    const sectionKeys: Record<string, string> = {
      Agents: "agents",
      "Connected Agents": "connectedAgents",
      Files: "files",
      Other: "other",
    };
    return [
      ...(contextMenuItems ?? []),
      ...Array.from(sections)
        .sort(([left], [right]) => {
          const order = (section: string) =>
            section === "Agents"
              ? 0
              : section === "Connected Agents"
                ? 1
                : section === "Files"
                  ? 3
                  : section === "Other"
                    ? 4
                    : 2;
          return order(left) - order(right) || left.localeCompare(right);
        })
        .map(([section, children]) => ({
          id: `mentions:${section}`,
          label: sectionKeys[section]
            ? t(`agentChat.mentions.sections.${sectionKeys[section]}`, {
                defaultValue: section,
              })
            : section,
          children,
        })),
    ];
  }, [contextMenuItems, filteredMentionItems, insertReference, t]);

  const sendButton = (
    <ComposerSendButton
      onSend={(event) =>
        void submitComposer(
          "immediate",
          undefined,
          event.metaKey || event.ctrlKey,
        )
      }
      sendDisabled={!canSend || sendButtonDisabled}
      sendLabel={sendButtonTooltip}
      busy={sendButtonBusy}
      voiceEnabled={voiceEnabled && voiceChatEnabled}
      onVoiceChatStart={onVoiceChatStart}
      voiceChatEligible={
        !hasDraft &&
        !planNext &&
        !composerMode &&
        !stopButton &&
        !isVoiceRecordingActive(voice.state)
      }
      disabled={disabled}
    />
  );
  return (
    <>
      {headerSlot ? (
        <div
          data-agent-composer-variant={layoutVariant}
          data-agent-composer-slot="header-row"
          className="agent-composer-header-row px-[var(--agentkit-composer-inset,0.75rem)] pt-2"
        >
          {headerSlot}
        </div>
      ) : null}
      {(composerMode || planNext) && (
        <div
          data-agent-composer-variant={layoutVariant}
          data-agent-composer-slot="mode-row"
          className="agent-composer-mode-row flex flex-wrap gap-1.5 px-[var(--agentkit-composer-inset,0.75rem)] pt-2"
        >
          {planNext ? (
            <ComposerChip
              slot="plan-chip"
              icon={IconClipboardList}
              label={t("agentChat.composer.plan", { defaultValue: "Plan" })}
              removeLabel={t("agentChat.composer.removePlan", {
                defaultValue: "Remove plan",
              })}
              onRemove={() => {
                setPlanNextState(false);
                if (isComposerEditorUsable(editor)) {
                  editor.commands.focus("end");
                }
              }}
            />
          ) : null}
          {composerMode ? (
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
          ) : null}
        </div>
      )}
      {hasContextRows && (
        <div
          data-agent-composer-variant={layoutVariant}
          data-agent-composer-slot="context-row"
          className="agent-composer-context-row flex flex-wrap gap-1.5 px-[var(--agentkit-composer-inset,0.75rem)] pt-2"
        >
          {slotReferences.map((ref) => (
            <span
              key={ref.slotKey}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-0.5 agent-kit-caption-copy font-medium text-foreground shadow-sm"
            >
              <MentionItemMedia
                media={ref.media}
                size="sm"
                fallbackIcon="clipboard"
              />
              {ref.slotLabel && (
                <span className="shrink-0 text-muted-foreground">
                  {ref.slotLabel}
                </span>
              )}
              <span className="min-w-0 truncate">{ref.label}</span>
              <button
                type="button"
                onClick={() => {
                  updateSlotReferences((current) =>
                    removeSlotReference(current, ref),
                  );
                  if (isComposerEditorUsable(editor)) {
                    editor.commands.focus("end");
                  }
                }}
                aria-label={t("agentChat.composer.removeReference", {
                  defaultValue: "Remove {{name}} reference",
                  name: slotReferenceTitle(ref),
                })}
                className="-my-1 -me-1.5 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <IconX aria-hidden="true" className="h-3 w-3" />
              </button>
            </span>
          ))}
          {contextItems.map((item) => (
            <React.Fragment key={item.key}>
              <span
                data-context-key={item.key}
                data-context-status={item.status ?? "ready"}
                title={item.statusMessage}
                data-state={
                  selectedContextItemKey === item.key ? "selected" : undefined
                }
                className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 agent-kit-caption-copy font-medium text-foreground ${
                  selectedContextItemKey === item.key
                    ? "border-ring bg-accent ring-2 ring-ring/40"
                    : "border-border bg-muted/50"
                }`}
              >
                {item.status === "pending" ? (
                  <IconLoader2
                    aria-label={t("agentChat.composer.contextPending", {
                      defaultValue: "Context pending",
                    })}
                    className="size-3 shrink-0 animate-spin motion-reduce:animate-none text-muted-foreground"
                  />
                ) : item.status === "error" ? (
                  <IconAlertCircle
                    aria-label={t("agentChat.composer.contextError", {
                      defaultValue: "Context failed",
                    })}
                    className="size-3 shrink-0 text-destructive"
                  />
                ) : (
                  <IconClipboardList className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 truncate">{item.title}</span>
                {onRemoveContextItem && item.removable !== false ? (
                  <button
                    type="button"
                    onClick={() => {
                      selectedContextItemKeyRef.current = null;
                      setSelectedContextItemKey(null);
                      onRemoveContextItem?.(item.key);
                    }}
                    aria-label={t("agentChat.composer.removeContext", {
                      defaultValue: "Remove {{name}} context",
                      name: item.title,
                    })}
                    className="-my-1 -me-1.5 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <IconX aria-hidden="true" className="h-3 w-3" />
                  </button>
                ) : null}
              </span>
              {item.status === "error" && onRetryContextItem ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => onRetryContextItem(item.key)}
                      aria-label={t("agentChat.composer.retryContext", {
                        defaultValue: "Retry {{name}} context",
                        name: item.title,
                      })}
                      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <IconRefresh aria-hidden="true" className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("agentChat.composer.retryContext", {
                      defaultValue: "Retry {{name}} context",
                      name: item.title,
                    })}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </React.Fragment>
          ))}
        </div>
      )}
      {contextSubmissionError ? (
        <ComposerNotice
          noticeId="context-submission"
          role="alert"
          onDismiss={() => setContextSubmissionError(null)}
          dismissLabel={t("agentChat.common.dismiss")}
        >
          {contextSubmissionError}
        </ComposerNotice>
      ) : null}
      {attachmentError ? (
        <ComposerNotice
          noticeId="attachment"
          role="alert"
          onDismiss={() => setAttachmentError(null)}
          dismissLabel={t("agentChat.common.dismiss")}
        >
          {attachmentError}
        </ComposerNotice>
      ) : null}
      <div
        data-agent-composer-variant={layoutVariant}
        data-agent-composer-slot="editor-wrap"
        className={`agent-composer-editor-wrap px-[var(--agentkit-composer-inset,0.75rem)] pb-1 ${
          hasHeaderRows
            ? "pt-[var(--agentkit-composer-editor-padding-top,0.25rem)]"
            : "pt-[var(--agentkit-composer-editor-padding-top,0.5rem)]"
        }`}
      >
        <EditorContent
          editor={editor}
          data-agent-composer-variant={layoutVariant}
          data-agent-composer-slot="editor"
          className="agent-composer-editor aui-composer flex-1 min-w-0 [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:m-0"
        >
          {editor ? null : (
            // The editor mounts after hydration; hold its geometry until then.
            <div
              aria-hidden="true"
              data-agent-composer-variant={layoutVariant}
              data-agent-composer-slot="editor-input"
              className="agent-composer-prosemirror min-h-[var(--agentkit-composer-editor-min-height,3.25rem)] text-[length:var(--agentkit-composer-font-size,0.875rem)] leading-[var(--agentkit-composer-line-height,1.625rem)] text-muted-foreground"
            >
              <p className="m-0">{resolvedPlaceholder}</p>
            </div>
          )}
        </EditorContent>
      </div>
      {voiceEnabled && <VoiceRecordingOverlay voice={voice} />}
      {voiceChat?.state === "error" && voiceChat.errorMessage ? (
        <ComposerNotice
          noticeId="voice-chat"
          role="alert"
          onDismiss={voiceChat.dismissError}
          dismissLabel={t("agentChat.common.dismiss")}
          actions={
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                voiceChat.dismissError();
                void voiceChat.start();
              }}
            >
              {t("agentChat.common.retry", { defaultValue: "Try again" })}
            </Button>
          }
        >
          {voiceChat.errorMessage}
        </ComposerNotice>
      ) : null}
      <div
        data-agent-composer-variant={layoutVariant}
        data-agent-composer-slot="toolbar"
        className="agent-composer-toolbar flex items-center gap-[var(--agentkit-composer-toolbar-control-gap,0.25rem)] px-[calc(var(--agentkit-composer-inset,0.75rem)-0.25rem)] pt-[var(--agentkit-composer-toolbar-padding-top,0.375rem)] pb-[var(--agentkit-composer-toolbar-padding-bottom,0.375rem)]"
      >
        {!launchersDisabled && attachmentsEnabled && attachButton ? (
          attachButton
        ) : hasContextMenu ? (
          <ComposerPlusMenu
            contextMenuItems={launchersDisabled ? [] : contextLauncherItems}
            openEntry={contextEntryRequest}
            mode={
              launchersDisabled || plusMenuMode === "hidden"
                ? "upload-only"
                : plusMenuMode
            }
            onSelectMode={handleSelectMode}
            terminalModeControl={terminalModeControl}
            extensionTools={extensionTools}
            attachmentsEnabled={attachmentsEnabled}
            open={contextMenuOpen}
            onOpenChange={setContextMenuOpen}
            loading={mentionsLoading}
            error={
              mentionsError
                ? t("agentChat.composer.contextLoadFailed", {
                    defaultValue: "Could not load context.",
                  })
                : undefined
            }
            onRetry={retryMentions}
            onRestoreFocus={
              launchersDisabled
                ? undefined
                : () => {
                    if (isComposerEditorUsable(editor)) editor.commands.focus();
                  }
            }
            addAttachment={
              attachmentsEnabled ? addAttachmentForCurrentScope : undefined
            }
            onAttachmentRequest={onAttachmentRequest}
            contextButtonTooltipDisabled={contextButtonTooltipDisabled}
            attachmentAccept={composerRuntime.getState().attachmentAccept}
            onAttachmentError={onAttachmentError}
            onDisabledFocus={() => {
              const root = editor?.view.dom.closest<HTMLElement>(
                '[data-agent-composer-slot="root"]',
              );
              const localTarget = Array.from(
                root?.querySelectorAll<HTMLElement>(
                  '[data-agent-composer-slot="stop-button"]:not(:disabled), button:not(:disabled)',
                ) ?? [],
              ).find((element) => !element.closest("[hidden]"));
              if (localTarget) {
                localTarget.focus();
                return;
              }
              const pageTarget = Array.from(
                document.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), a[href], input:not([type="hidden"]):not(:disabled), textarea:not(:disabled)',
                ),
              ).find(
                (element) =>
                  !root?.contains(element) && !element.closest("[hidden]"),
              );
              pageTarget?.focus();
            }}
            disabled={launchersDisabled}
          />
        ) : null}
        {toolbarSlot ?? modeControl}
        <div data-agent-composer-slot="toolbar-spacer" className="flex-1" />
        {contextUsageSlot}
        {shouldRenderModelSelector(availableModels, onModelChange) && (
          <ModelSelector
            model={selectedModel ?? ""}
            selectedEngine={selectedEngine}
            open={modelSelectorOpen}
            effort={selectedEffort}
            engines={availableModels!}
            agents={availableAgents}
            selectedAgent={selectedAgent}
            agentOnly={agentOnly}
            hostedHarness={hostedHarness}
            showAutoModelOption={showAutoModelOption}
            modelListLoading={modelListLoading}
            onChange={onModelChange!}
            onEffortChange={onEffortChange}
            onAgentChange={onAgentChange}
            onModelSelectorOpenChange={onModelSelectorOpenChange}
            providerConnectStatusEnabled={providerConnectStatusEnabled}
            onConnectProvider={onConnectProvider}
            onConnectLocalRuntime={onConnectLocalRuntime}
            terminalModeControl={terminalModeControl}
            imageModel={imageModelMenu}
            setupCardVisible={setupCardVisible}
            onConnectionRequiredChange={onModelConnectionRequiredChange}
          />
        )}
        {actionButton ?? (
          <>
            {extraActionButton}
            {/* Dictation keeps its own slot beside Send, so typing never
                hides it; while recording it grows into the recording pill. */}
            {voiceEnabled && (
              <VoiceButton
                voice={voice}
                isMac={isMac}
                disabled={disabled}
                voiceChat={voiceChatEnabled}
              />
            )}
            {stopButton ? (
              // Stop takes Send's place while the composer is empty, and Send
              // joins it once a draft exists so a draft never hides Stop. The
              // slot grows from zero width, gap included, so the controls to
              // its left slide rather than jump.
              <div
                ref={stopSlotRef}
                data-agent-composer-slot="stop-slot"
                className={`grid shrink-0 grid-cols-[1fr] justify-items-end transition-[grid-template-columns,margin-inline-start,margin-inline-end] duration-150 ease-out starting:-ms-[var(--agentkit-composer-toolbar-control-gap,0.25rem)] starting:me-0 starting:grid-cols-[0fr] motion-reduce:transition-none ${
                  hasDraft ? "me-1" : ""
                }`}
              >
                <div className="flex min-w-0 transition-[opacity,scale] duration-150 ease-out starting:scale-75 starting:opacity-0 motion-reduce:transition-none">
                  {stopButton}
                </div>
              </div>
            ) : null}
            {stopButton && !hasDraft && !voiceChat ? null : sendButton}
          </>
        )}
      </div>
      <MentionPopover
        ref={popoverRef}
        density={mentionPopoverDensity}
        type={popover?.type ?? "@"}
        position={popover?.position ?? null}
        mentionItems={inlineMentionItems}
        skills={filteredSkills}
        commands={filteredCommands}
        hint={hint}
        isLoading={popover?.type === "@" ? mentionsLoading : skillsLoading}
        error={mentionItemsError}
        onRetry={onRetryMentionItems}
        query={popover?.query ?? ""}
        onSelectMention={handleSelectMention}
        onSelectSkill={handleSelectSkill}
        onSelectCommand={handleSelectCommand}
        onClose={closePopover}
      />
    </>
  );
}
