import { z } from "zod";

import { composerWebsiteUrlSchema } from "../../shared/composer-source.js";

const ASSISTANT_CHAT_COMPOSER_DRAFT_PREFIX = "agent-chat-composer-text:";
const ASSISTANT_CHAT_COMPOSER_CONTEXT_PREFIX = "agent-chat-composer-context:";

/**
 * A stored agent-composer draft belongs to the browser-tab session that typed it.
 * localStorage keeps it across a reload; sessionStorage survives a reload and
 * not a new tab, a later session or another account on the same profile. Without
 * that boundary a draft typed once reappeared as somebody else's text in a fresh
 * panel (a previous QA run's prompt showed up on first open).
 */
const ASSISTANT_CHAT_COMPOSER_SESSION_PREFIX = "agent-chat-composer-session:";

function composerSessionMarker(storageKey: string): string {
  return `${ASSISTANT_CHAT_COMPOSER_SESSION_PREFIX}${storageKey}`;
}

function markComposerSession(storageKey: string): void {
  try {
    window.sessionStorage.setItem(composerSessionMarker(storageKey), "1");
  } catch {
    // coercion-ok: without sessionStorage the draft still restores (below).
  }
}

function forgetComposerSession(storageKey: string): void {
  try {
    window.sessionStorage.removeItem(composerSessionMarker(storageKey));
  } catch {
    // coercion-ok: nothing to forget when sessionStorage is unavailable.
  }
}

function composerBelongsToThisSession(storageKey: string): boolean {
  try {
    return (
      window.sessionStorage.getItem(composerSessionMarker(storageKey)) === "1"
    );
  } catch {
    // coercion-ok: a browser without sessionStorage keeps the previous restore.
    return true;
  }
}

const COMPOSER_CONTEXT_DRAFT_PREFIX = ASSISTANT_CHAT_COMPOSER_CONTEXT_PREFIX;
const MAX_CONTEXT_DRAFT_BYTES = 64 * 1024;

const composerContextDraftSchema = z.object({
  designSystemId: z.string().min(1).max(200).nullable(),
  references: z
    .array(
      z.object({
        source: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/i),
        id: z.string().min(1).max(2048),
        title: z.string().max(2048),
        url: composerWebsiteUrlSchema.optional(),
        figmaUrl: composerWebsiteUrlSchema.optional(),
        nodeId: z.string().max(200).optional(),
      }),
    )
    .max(20),
});

export type AssistantChatComposerContextDraft = z.infer<
  typeof composerContextDraftSchema
>;

export function readAssistantChatComposerContextDraft(
  scope: string,
): AssistantChatComposerContextDraft | null {
  if (!scope.trim())
    throw new Error("Composer context draft scope is required");
  const key = `${COMPOSER_CONTEXT_DRAFT_PREFIX}${encodeURIComponent(scope)}`;
  if (!composerBelongsToThisSession(key)) return null;
  const stored = window.localStorage.getItem(key);
  if (stored === null) return null;
  if (new TextEncoder().encode(stored).length > MAX_CONTEXT_DRAFT_BYTES)
    throw new Error("Composer context draft exceeds the size limit");
  const envelope = z
    .object({ version: z.literal(1), selection: composerContextDraftSchema })
    .parse(JSON.parse(stored));
  return envelope.selection;
}

export function writeAssistantChatComposerContextDraft(
  scope: string,
  selection: AssistantChatComposerContextDraft,
): void {
  if (!scope.trim())
    throw new Error("Composer context draft scope is required");
  const bounded = composerContextDraftSchema.parse(selection);
  const key = `${COMPOSER_CONTEXT_DRAFT_PREFIX}${encodeURIComponent(scope)}`;
  if (!bounded.designSystemId && bounded.references.length === 0) {
    window.localStorage.removeItem(key);
    forgetComposerSession(key);
    return;
  }
  const serialized = JSON.stringify({ version: 1, selection: bounded });
  if (new TextEncoder().encode(serialized).length > MAX_CONTEXT_DRAFT_BYTES)
    throw new Error("Composer context draft exceeds the size limit");
  window.localStorage.setItem(key, serialized);
  markComposerSession(key);
}

export function assistantChatComposerDraftKey(
  scope?: string | null,
): string | null {
  const normalizedScope = scope?.trim();
  return normalizedScope
    ? `${ASSISTANT_CHAT_COMPOSER_DRAFT_PREFIX}${encodeURIComponent(normalizedScope)}`
    : null;
}

function getComposerDraftStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // coercion-ok: browser storage may be unavailable; treat it as absent.
    return null;
  }
}

export function readAssistantChatComposerDraft(
  scope?: string | null,
): string | null {
  const key = assistantChatComposerDraftKey(scope);
  const storage = getComposerDraftStorage();
  if (!key || !storage) return null;
  if (!composerBelongsToThisSession(key)) return null;
  try {
    const draft = storage.getItem(key);
    return draft && draft.trim().length > 0 ? draft : null;
  } catch {
    // coercion-ok: browser storage may be unavailable; treat it as absent.
    return null;
  }
}

export function writeAssistantChatComposerDraft(
  scope: string | null | undefined,
  text: string,
): void {
  const key = assistantChatComposerDraftKey(scope);
  const storage = getComposerDraftStorage();
  if (!key || !storage) return;
  try {
    if (text.trim().length > 0) {
      storage.setItem(key, text);
      markComposerSession(key);
    } else {
      storage.removeItem(key);
      forgetComposerSession(key);
    }
  } catch {
    // coercion-ok: browser storage may be unavailable; keep the live editor authoritative.
    // The live editor remains the source of truth when browser storage is unavailable.
  }
}

export function clearAssistantChatComposerDraft(scope?: string | null): void {
  const key = assistantChatComposerDraftKey(scope);
  const storage = getComposerDraftStorage();
  if (!key || !storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // coercion-ok: browser storage may be unavailable; keep the live editor authoritative.
    // The live editor remains the source of truth when browser storage is unavailable.
  }
}
