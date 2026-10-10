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

const ASSISTANT_CHAT_HIDDEN_CONTEXT_PREFIX =
  "agent-chat-composer-hidden-context:";

// Bounds stay off the stored shape: the writer persists whatever the caller
// staged, so a length cap here would make a saved entry unreadable on mount.
const hiddenContextEnvelopeSchema = z.object({
  version: z.literal(1),
  items: z.array(
    z.object({
      key: z.string().min(1),
      title: z.string(),
      context: z.string().min(1),
      hidden: z.boolean().optional(),
      stagedAt: z.number().optional(),
    }),
  ),
});

export interface AssistantChatHiddenContextItem {
  key: string;
  title: string;
  context: string;
  hidden?: boolean;
  composerOnly: true;
  stagedAt?: number;
}

type HiddenContextWrite = {
  key: string;
  title: string;
  context: string;
  hidden?: boolean;
  stagedAt?: number;
};

function assistantChatHiddenContextKey(scope?: string | null): string | null {
  const normalizedScope = scope?.trim();
  return normalizedScope
    ? `${ASSISTANT_CHAT_HIDDEN_CONTEXT_PREFIX}${encodeURIComponent(normalizedScope)}`
    : null;
}

function serializeAssistantChatHiddenContext(
  items: readonly HiddenContextWrite[],
): string {
  return JSON.stringify({
    version: 1,
    items: items.map(({ key, title, context, hidden, stagedAt }) => ({
      key,
      title,
      context,
      ...(hidden ? { hidden } : {}),
      ...(stagedAt !== undefined ? { stagedAt } : {}),
    })),
  });
}

// Hidden prefill context is kept per composer scope, with the draft text, and
// never in the shared context store: that store reaches every open composer.
export function readAssistantChatHiddenContext(
  scope?: string | null,
): AssistantChatHiddenContextItem[] {
  const key = assistantChatHiddenContextKey(scope);
  const storage = getComposerDraftStorage();
  if (!key || !storage) return [];
  let stored: string | null;
  try {
    stored = storage.getItem(key);
  } catch {
    // coercion-ok: browser storage could not be read. Logged, so it is not mistaken for an empty scope.
    console.error(
      "Prefill context could not be read from browser storage; it is not restored.",
    );
    return [];
  }
  if (stored === null) return [];
  const items = parseHiddenContextEnvelope(stored);
  if (items)
    return items.map((item) => ({ ...item, composerOnly: true as const }));
  // Discard the unreadable entry so it cannot fail every later mount. The draft text is stored separately and still restores.
  console.error(
    "Stored prefill context was unreadable and has been discarded; the restored draft has no context.",
  );
  try {
    storage.removeItem(key);
  } catch {
    // coercion-ok: browser storage may be unavailable; the bad entry is then ignored on each read.
  }
  return [];
}

function parseHiddenContextEnvelope(
  stored: string,
): z.infer<typeof hiddenContextEnvelopeSchema>["items"] | null {
  let json: unknown;
  try {
    json = JSON.parse(stored);
  } catch {
    // coercion-ok: a corrupt entry is unreadable; the caller discards it.
    return null;
  }
  const result = hiddenContextEnvelopeSchema.safeParse(json);
  return result.success ? result.data.items : null;
}

// Returns false when items that should survive a reload could not be saved. The
// draft text is stored separately, so the caller must not treat the prefill as persisted.
export function writeAssistantChatHiddenContext(
  scope: string | null | undefined,
  items: readonly HiddenContextWrite[],
): boolean {
  const key = assistantChatHiddenContextKey(scope);
  const storage = getComposerDraftStorage();
  if (!key || !storage) return items.length === 0;
  try {
    if (items.length === 0) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, serializeAssistantChatHiddenContext(items));
    }
    return true;
  } catch {
    // coercion-ok: browser storage may be unavailable or full. A failed write can leave the
    // previous entry in place, so drop it rather than let an older context restore beside a newer draft.
    try {
      storage.removeItem(key);
    } catch {
      // coercion-ok: storage is already unusable; there is nothing more to drop.
    }
    return false;
  }
}

// Whether these items can be saved now, counting the entry they replace. The probe
// writes the scope's own key and puts the previous value back, so a replacement that
// fits in place is not refused and the stored context is left as it was.
export function canWriteAssistantChatHiddenContext(
  scope: string | null | undefined,
  items: readonly HiddenContextWrite[],
): boolean {
  if (items.length === 0) return true;
  const key = assistantChatHiddenContextKey(scope);
  const storage = getComposerDraftStorage();
  if (!key || !storage) return false;
  let previous: string | null;
  try {
    previous = storage.getItem(key);
    storage.setItem(key, serializeAssistantChatHiddenContext(items));
  } catch {
    // coercion-ok: storage refused the write; the previous entry is untouched.
    return false;
  }
  // Restoring the previous value only swaps back what the probe wrote, so it fits. A
  // failure here means another tab filled the origin mid-probe; it throws rather than
  // leave the probe's payload in place of the saved context.
  if (previous === null) storage.removeItem(key);
  else storage.setItem(key, previous);
  return true;
}
