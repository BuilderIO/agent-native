import type {
  ResourceSuggestion,
  SuggestionOperation,
} from "@agent-native/core/review";
import {
  SuggestionFormattingMappingError,
  suggestionSourceAlignment,
} from "@shared/suggestion-formatting";

import {
  draftSuggestionAnchors,
  markdownSuggestionOperation,
  markdownSuggestionOperationsForEditorRevision,
} from "./markdown-operation";

export function canonicalSuggestionRevision(
  document: { revision?: string; updatedAt: string },
  suggestion?: Pick<ResourceSuggestion, "baseRevision">,
): string {
  if (suggestion?.baseRevision === document.updatedAt)
    return document.updatedAt;
  return document.revision ?? document.updatedAt;
}

export type SuggestionDraftSession = {
  id: string;
  baseContent: string;
  baseRevision: string;
  startedAt: string;
  initialContent?: string;
  replacementIntents?: Array<{
    from: number;
    to: number;
    beforeText: string;
  }>;
  existingSuggestion?: {
    id: string;
    threadId: string;
    revision: number;
    baseRevision: string;
  };
};

export type SuggestionDraftCaret = {
  from: number;
  prefix: string;
  suffix: string;
};

export type EditableSuggestionDraft = {
  session: SuggestionDraftSession;
  content: string;
  caret: SuggestionDraftCaret;
};

export type DraftSuggestion = {
  durability: "draft";
  id: string;
  threadId: string;
  authorEmail: string | null;
  createdAt: string;
  operations: SuggestionOperation[];
  anchor: {
    from: number;
    to: number;
    prefix: string;
    suffix: string;
  };
};

export type SuggestionPersistenceEntry = {
  idempotencyKey: string;
  operation: SuggestionOperation;
  suggestion: ResourceSuggestion;
};

export type SuggestionDraftPersistencePlan<
  Operation extends SuggestionOperation = SuggestionOperation,
> = {
  unchanged: Map<string, ResourceSuggestion>;
  amend: Array<{
    key: string;
    previousKey: string;
    operation: Operation;
    suggestion: ResourceSuggestion;
  }>;
  create: Array<{ key: string; operation: Operation }>;
  withdraw: Array<{ key: string; suggestion: ResourceSuggestion }>;
};

// Ordinals, sibling ranges, and anchor context are cut at neighboring edits, so
// they change when another hunk does; the key must not.
export function suggestionOperationKey(operation: SuggestionOperation) {
  const { ordinal: _ordinal, ...stableOperation } = operation;
  if (!stableOperation.anchor || typeof stableOperation.anchor !== "object")
    return JSON.stringify(stableOperation);
  const {
    siblingRanges: _siblingRanges,
    prefix: _prefix,
    suffix: _suffix,
    ...stableAnchor
  } = stableOperation.anchor as Record<string, unknown>;
  return JSON.stringify({ ...stableOperation, anchor: stableAnchor });
}

export function freshestSavedSuggestions(
  local: ResourceSuggestion[],
  remote: ResourceSuggestion[],
) {
  const byId = new Map(local.map((suggestion) => [suggestion.id, suggestion]));
  for (const suggestion of remote) {
    const current = byId.get(suggestion.id);
    if (!current || suggestion.revision >= current.revision) {
      byId.set(suggestion.id, suggestion);
    }
  }
  return [...byId.values()];
}

export type SuggestionSaveOutcome<Result> =
  | { status: "saved"; result: Result }
  // Accepted, or amended elsewhere: the draft's base no longer describes the
  // suggestion, so saving the draft over it would discard that change.
  | { status: "changed" }
  // Rejected, withdrawn, stale, superseded, or gone: the Page never took it.
  | { status: "closed" };

// A conflict means the suggestion moved on without this save: a reviewer
// decided it, or someone amended it elsewhere, which is the only way its
// revision advances.
export async function saveUnlessSuggestionChanged<Result>(
  suggestion: Pick<ResourceSuggestion, "id">,
  attempt: () => Promise<Result>,
  options: {
    isConflict: (error: unknown) => boolean;
    latest: (id: string) => Promise<ResourceSuggestion | undefined>;
  },
): Promise<SuggestionSaveOutcome<Result>> {
  try {
    return { status: "saved", result: await attempt() };
  } catch (error) {
    if (!options.isConflict(error)) throw error;
  }
  const latest = await options.latest(suggestion.id);
  if (!latest) return { status: "closed" };
  switch (latest.status) {
    case "pending":
    case "accepted":
      return { status: "changed" };
    case "rejected":
    case "stale":
    case "superseded":
    case "withdrawn":
      return { status: "closed" };
  }
}

// The server fingerprints an amendment with the revision it observed, so a
// key repeats only for a retry of the same request. Undoing back to text an
// earlier save already sent amends a newer revision and needs a new key.
export function suggestionAmendmentIdempotencyKey(
  keys: Map<string, string>,
  suggestion: Pick<ResourceSuggestion, "id" | "revision">,
  operationsKey: string,
) {
  const requestKey = JSON.stringify([
    suggestion.id,
    suggestion.revision,
    operationsKey,
  ]);
  const key = keys.get(requestKey) ?? globalThis.crypto.randomUUID();
  keys.set(requestKey, key);
  return key;
}

export function createSuggestionDraftSession(input: {
  id: string;
  baseContent: string;
  baseRevision: string;
  startedAt: string;
  initialContent?: string;
  replacementIntents?: SuggestionDraftSession["replacementIntents"];
  existingSuggestion?: SuggestionDraftSession["existingSuggestion"];
}): SuggestionDraftSession {
  return input;
}

export function editableSuggestionDraft(input: {
  suggestion: ResourceSuggestion;
  currentUserEmail: string | null | undefined;
  canonicalContent: string;
  canonicalRevision: string;
}): EditableSuggestionDraft | null {
  const { suggestion, currentUserEmail, canonicalContent, canonicalRevision } =
    input;
  if (
    !currentUserEmail ||
    suggestion.actorKind !== "human" ||
    suggestion.adapterKind !== "content.document-markdown" ||
    suggestion.adapterVersion !== 1 ||
    suggestion.status !== "pending" ||
    suggestion.authorEmail !== currentUserEmail ||
    suggestion.baseRevision !== canonicalRevision ||
    suggestion.operations.length !== 1
  ) {
    return null;
  }
  const operation = suggestion.operations[0]!;
  const before = operation.before as {
    markdown?: unknown;
    changedText?: unknown;
  } | null;
  const after = operation.after as {
    markdown?: unknown;
    changedText?: unknown;
  } | null;
  const anchor = operation.anchor as { from?: unknown } | null;
  const supportedKinds = new Set([
    "insert_text",
    "delete_text",
    "replace_text",
    "add_text_block",
    "set_inline_mark",
  ]);
  if (
    operation.schemaVersion !== 1 ||
    !supportedKinds.has(operation.kind) ||
    typeof before?.markdown !== "string" ||
    typeof before.changedText !== "string" ||
    typeof after?.markdown !== "string" ||
    typeof after.changedText !== "string" ||
    typeof anchor?.from !== "number" ||
    before.markdown !== canonicalContent
  ) {
    return null;
  }
  const caretOffset = Math.max(
    0,
    Math.min(anchor.from + after.changedText.length, after.markdown.length),
  );
  return {
    session: createSuggestionDraftSession({
      id: globalThis.crypto.randomUUID(),
      baseContent: canonicalContent,
      baseRevision: canonicalRevision,
      startedAt: suggestion.createdAt,
      initialContent: after.markdown,
      replacementIntents:
        operation.kind === "replace_text" || operation.kind === "delete_text"
          ? [
              {
                from: anchor.from,
                to: anchor.from + before.changedText.length,
                beforeText: before.changedText,
              },
            ]
          : undefined,
      existingSuggestion: {
        id: suggestion.id,
        threadId: suggestion.threadId,
        revision: suggestion.revision,
        baseRevision: suggestion.baseRevision,
      },
    }),
    content: after.markdown,
    caret: {
      from: caretOffset,
      prefix: after.markdown.slice(Math.max(0, caretOffset - 32), caretOffset),
      suffix: after.markdown.slice(caretOffset, caretOffset + 32),
    },
  };
}

export function suggestionDraftOperations(
  session: SuggestionDraftSession,
  draftContent: string,
) {
  const operations = markdownSuggestionOperationsForEditorRevision({
    before: session.baseContent,
    after: draftContent,
    replacements: session.replacementIntents ?? [],
  });
  if (!session.existingSuggestion || operations.length < 2) return operations;
  const amendment = markdownSuggestionOperation(
    session.baseContent,
    draftContent,
  );
  return amendment ? [amendment] : [];
}

export function recordSuggestionReplacementIntent(
  session: SuggestionDraftSession,
  input: { beforeText: string; startOffset: number },
  currentContent = session.baseContent,
) {
  if (!input.beforeText) return false;
  const candidates: number[] = [];
  let from = currentContent.indexOf(input.beforeText);
  while (from !== -1) {
    candidates.push(from);
    from = currentContent.indexOf(input.beforeText, from + 1);
  }
  if (candidates.length === 0) return false;
  candidates.sort(
    (left, right) =>
      Math.abs(left - input.startOffset) - Math.abs(right - input.startOffset),
  );
  if (
    candidates.length > 1 &&
    Math.abs(candidates[0]! - input.startOffset) ===
      Math.abs(candidates[1]! - input.startOffset)
  ) {
    return false;
  }
  const operations = suggestionDraftOperations(session, currentContent);
  // Intents are stored-base offsets; the draft is the base's canonical form.
  const alignment = suggestionSourceAlignment(session.baseContent);
  if (!alignment) return false;
  const baseOffset = (position: number, side: "start" | "end") => {
    let delta = 0;
    for (const operation of operations) {
      const from = alignment.map(operation.anchor.from, "stored");
      const to = alignment.map(operation.anchor.to, "stored");
      if (from === null || to === null) return null;
      const start = from + delta;
      const end = start + operation.after.changedText.length;
      if (position < start) return alignment.map(position - delta, "canonical");
      if (position === start) return operation.anchor.from;
      if (position < end)
        return side === "start" ? operation.anchor.from : operation.anchor.to;
      delta += operation.after.changedText.length - (to - from);
    }
    return alignment.map(position - delta, "canonical");
  };
  const start = baseOffset(candidates[0]!, "start");
  const end = baseOffset(candidates[0]! + input.beforeText.length, "end");
  if (start === null || end === null) return false;
  if (start === end) return true;
  const intents = session.replacementIntents ?? [];
  if (!intents.some((intent) => intent.from <= start && intent.to >= end)) {
    session.replacementIntents = [
      ...intents,
      {
        from: start,
        to: end,
        beforeText: session.baseContent.slice(start, end),
      },
    ];
  }
  return true;
}

export function draftSuggestionsForSession(
  session: SuggestionDraftSession,
  draftContent: string,
  authorEmail: string | null,
): DraftSuggestion[] {
  const operations = suggestionDraftOperations(session, draftContent);
  const anchors = draftSuggestionAnchors(operations, draftContent);
  return operations.map((operation, index) => {
    const existing = index === 0 ? session.existingSuggestion : undefined;
    const id = existing?.id ?? `draft-${session.id}-${operation.ordinal}`;
    return {
      durability: "draft",
      id,
      threadId: existing?.threadId ?? id,
      authorEmail,
      createdAt: session.startedAt,
      operations: [operation],
      anchor: anchors[index]!,
    };
  });
}

export function previewSuggestionDraft(
  session: SuggestionDraftSession,
  content: string,
  authorEmail: string | null,
):
  | { status: "ready"; suggestions: DraftSuggestion[] }
  | { status: "unsupported-formatting"; content: string } {
  try {
    return {
      status: "ready",
      suggestions: draftSuggestionsForSession(session, content, authorEmail),
    };
  } catch (error) {
    if (!(error instanceof SuggestionFormattingMappingError)) throw error;
    return { status: "unsupported-formatting", content };
  }
}

function operationBaseRange(operation: SuggestionOperation) {
  return operation.anchor as { from: number; to: number };
}

// Typing on after a save changes an operation's key, so a saved suggestion is
// matched to whichever current operation overlaps its base range; matching by
// key alone would save every continued keystroke run as a duplicate.
function matchSessionOperations<Operation extends SuggestionOperation>(
  operations: Operation[],
  entries: ReadonlyMap<string, SuggestionPersistenceEntry>,
) {
  const claimed = new Set<string>();
  const matches = operations.map((operation) => {
    const key = suggestionOperationKey(operation);
    const exact = entries.has(key);
    if (exact) claimed.add(key);
    return { operation, key, persistedKey: exact ? key : null };
  });
  for (const match of matches) {
    if (match.persistedKey) continue;
    const range = operationBaseRange(match.operation);
    let best: { key: string; from: number } | null = null;
    for (const [key, entry] of entries) {
      if (claimed.has(key)) continue;
      const saved = operationBaseRange(entry.operation);
      if (saved.from > range.to || range.from > saved.to) continue;
      if (!best || saved.from < best.from) best = { key, from: saved.from };
    }
    if (best) {
      claimed.add(best.key);
      match.persistedKey = best.key;
    }
  }
  const orphaned = [...entries.keys()].filter((key) => !claimed.has(key));
  return { matches, orphaned };
}

export function planSuggestionDraftPersistence<
  Operation extends SuggestionOperation,
>(
  operations: Operation[],
  entries: ReadonlyMap<string, SuggestionPersistenceEntry>,
): SuggestionDraftPersistencePlan<Operation> {
  const { matches, orphaned } = matchSessionOperations(operations, entries);
  const plan: SuggestionDraftPersistencePlan<Operation> = {
    unchanged: new Map(),
    amend: [],
    create: [],
    withdraw: orphaned.map((key) => ({
      key,
      suggestion: entries.get(key)!.suggestion,
    })),
  };
  for (const { operation, key, persistedKey } of matches) {
    if (!persistedKey) plan.create.push({ key, operation });
    else if (persistedKey === key)
      plan.unchanged.set(key, entries.get(key)!.suggestion);
    else
      plan.amend.push({
        key,
        previousKey: persistedKey,
        operation,
        suggestion: entries.get(persistedKey)!.suggestion,
      });
  }
  return plan;
}

function savedSuggestionsForDrafts(
  suggestions: DraftSuggestion[],
  entries: ReadonlyMap<string, SuggestionPersistenceEntry>,
) {
  const { matches, orphaned } = matchSessionOperations(
    suggestions.map((suggestion) => suggestion.operations[0]!),
    entries,
  );
  return {
    saved: matches.map((match) =>
      match.persistedKey ? entries.get(match.persistedKey)!.suggestion : null,
    ),
    withdrawnIds: new Set(
      orphaned.map((key) => entries.get(key)!.suggestion.id),
    ),
  };
}

export function unpersistedDraftSuggestions(
  suggestions: DraftSuggestion[],
  entries: ReadonlyMap<string, SuggestionPersistenceEntry>,
) {
  const { saved } = savedSuggestionsForDrafts(suggestions, entries);
  return suggestions.filter((_suggestion, index) => !saved[index]);
}

export function suggestionSessionVisuals(
  suggestions: DraftSuggestion[],
  entries: ReadonlyMap<string, SuggestionPersistenceEntry>,
) {
  const { saved } = savedSuggestionsForDrafts(suggestions, entries);
  return suggestions.map((draft, index) => ({
    ...draft,
    id: saved[index]?.id ?? draft.id,
    threadId: saved[index]?.threadId ?? draft.threadId,
  }));
}

export function withdrawnSessionSuggestionIds(
  suggestions: DraftSuggestion[],
  entries: ReadonlyMap<string, SuggestionPersistenceEntry>,
) {
  return savedSuggestionsForDrafts(suggestions, entries).withdrawnIds;
}
