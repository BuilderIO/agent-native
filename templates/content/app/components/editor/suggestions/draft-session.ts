import type {
  ResourceSuggestion,
  SuggestionOperation,
} from "@agent-native/core/review";
import { SuggestionFormattingMappingError } from "@shared/suggestion-formatting";

import {
  draftSuggestionAnchors,
  markdownSuggestionOperationsForReplacements,
} from "./markdown-operation";

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
  suggestion?: ResourceSuggestion;
};

export function suggestionOperationKey(operation: SuggestionOperation) {
  const { ordinal: _ordinal, ...stableOperation } = operation;
  return JSON.stringify(stableOperation);
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
  const operations = markdownSuggestionOperationsForReplacements({
    before: session.baseContent,
    after: draftContent,
    replacements: session.replacementIntents ?? [],
  });
  if (!session.existingSuggestion || operations.length < 2) return operations;
  // An amendment retains the saved proposal's single-operation identity.
  return markdownSuggestionOperationsForReplacements({
    before: session.baseContent,
    after: draftContent,
    replacements: [
      {
        from: operations[0]!.anchor.from,
        to: operations[operations.length - 1]!.anchor.to,
      },
    ],
  });
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
  const baseOffset = (position: number, side: "start" | "end") => {
    let delta = 0;
    for (const operation of operations) {
      const start = operation.anchor.from + delta;
      const end = start + operation.after.changedText.length;
      if (position < start) return position - delta;
      if (position === start) return operation.anchor.from;
      if (position < end)
        return side === "start" ? operation.anchor.from : operation.anchor.to;
      delta +=
        operation.after.changedText.length -
        (operation.anchor.to - operation.anchor.from);
    }
    return position - delta;
  };
  const start = baseOffset(candidates[0]!, "start");
  const end = baseOffset(candidates[0]! + input.beforeText.length, "end");
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

export function unpersistedDraftSuggestions(
  suggestions: DraftSuggestion[],
  entries: Map<string, SuggestionPersistenceEntry>,
) {
  return suggestions.filter(
    (suggestion) =>
      !entries.get(suggestionOperationKey(suggestion.operations[0]!))
        ?.suggestion,
  );
}

export function suggestionSessionVisuals(
  suggestions: DraftSuggestion[],
  entries: Map<string, SuggestionPersistenceEntry>,
) {
  return suggestions.map((draft) => {
    const entry = entries.get(suggestionOperationKey(draft.operations[0]!));
    return {
      ...draft,
      id: entry?.suggestion?.id ?? draft.id,
      threadId: entry?.suggestion?.threadId ?? draft.threadId,
    };
  });
}

export async function persistSuggestionDraftOperations(
  operations: SuggestionOperation[],
  entries: Map<string, SuggestionPersistenceEntry>,
  create: (
    operation: SuggestionOperation,
    idempotencyKey: string,
  ) => Promise<ResourceSuggestion>,
) {
  const persisted = new Map<string, ResourceSuggestion>();
  for (const operation of operations) {
    const operationKey = suggestionOperationKey(operation);
    const existing = entries.get(operationKey);
    if (existing?.suggestion) {
      persisted.set(operationKey, existing.suggestion);
      continue;
    }
    const idempotencyKey =
      existing?.idempotencyKey ?? globalThis.crypto.randomUUID();
    const persistedOperation = existing?.operation ?? operation;
    entries.set(operationKey, {
      idempotencyKey,
      operation: persistedOperation,
    });
    const suggestion = await create(persistedOperation, idempotencyKey);
    entries.set(operationKey, {
      idempotencyKey,
      operation: persistedOperation,
      suggestion,
    });
    persisted.set(operationKey, suggestion);
  }
  return persisted;
}
