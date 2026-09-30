import { z } from "zod";

import { composerWebsiteUrlSchema } from "../../shared/composer-source.js";

const ASSISTANT_CHAT_COMPOSER_DRAFT_PREFIX = "agent-chat-composer-text:";
const COMPOSER_CONTEXT_DRAFT_PREFIX = "agent-chat-composer-context:";
const MAX_CONTEXT_DRAFT_BYTES = 64 * 1024;

const composerContextDraftSchema = z.object({
  designSystemId: z.string().min(1).max(200).nullable(),
  references: z
    .array(
      z.object({
        source: z.enum(["design", "slides", "figma", "website", "integration"]),
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
  const stored = window.localStorage.getItem(
    `${COMPOSER_CONTEXT_DRAFT_PREFIX}${encodeURIComponent(scope)}`,
  );
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
    return;
  }
  const serialized = JSON.stringify({ version: 1, selection: bounded });
  if (new TextEncoder().encode(serialized).length > MAX_CONTEXT_DRAFT_BYTES)
    throw new Error("Composer context draft exceeds the size limit");
  window.localStorage.setItem(key, serialized);
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
    } else {
      storage.removeItem(key);
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
