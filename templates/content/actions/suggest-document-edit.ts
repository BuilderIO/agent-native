import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import {
  ensureSuggestionTables,
  getSuggestionByCreationKey,
  suggestionActorKind,
  suggestionActorKindMatchesReceipt,
} from "@agent-native/core/review";
import createResourceSuggestion from "@agent-native/core/review/suggestions/actions/create-resource-suggestion";
import { assertAccess } from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import { resolveDocumentTextEdits } from "../shared/document-text-edits.js";
import { contentSuggestionPath } from "../shared/suggestion-link.js";
import { documentRevisionToken } from "./_document-edit-mutation.js";

// The editor's suggestion anchors carry 32 characters of context on each side
// so a rebased proposal can still find its place after unrelated edits.
const ANCHOR_CONTEXT_CHARS = 32;

const suggestDocumentEditSchema = z.object({
  id: z
    .string()
    .optional()
    .describe("Stable ID of the document to suggest an edit for (required)."),
  baseRevision: z
    .string()
    .optional()
    .describe(
      "Opaque revision returned by get-document for the exact body the suggestion is based on.",
    ),
  idempotencyKey: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Caller-generated stable key for one logical suggested edit."),
  find: z
    .string()
    .optional()
    .describe(
      "Exact non-empty current text to replace. Must appear exactly once in the page; expand the surrounding text when it is ambiguous.",
    ),
  replace: z
    .string()
    .optional()
    .describe(
      'Replacement Markdown text; omit or pass "" to suggest deleting the matched text.',
    ),
  summary: z
    .string()
    .max(500)
    .optional()
    .describe(
      "One-line description of the proposed change shown to the reviewer.",
    ),
});

const externalSuggestDocumentEditSchema = suggestDocumentEditSchema.extend({
  id: z
    .string()
    .min(1)
    .describe("Stable ID of the document to suggest an edit for."),
  baseRevision: z
    .string()
    .min(1)
    .describe(
      "Required. Opaque revision returned by get-document for the exact body the suggestion is based on.",
    ),
  idempotencyKey: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "Required. Caller-generated stable key for one logical suggested edit.",
    ),
  find: z
    .string()
    .min(1)
    .describe(
      "Exact current text to replace. Must appear exactly once in the page; expand the surrounding text when it is ambiguous.",
    ),
  summary: z.string().max(500).optional(),
});

export function buildMarkdownSuggestionOperation(args: {
  content: string;
  find: string;
  replace: string;
  start: number;
}) {
  const { content, find, replace, start } = args;
  const before = content;
  const after = `${content.slice(0, start)}${replace}${content.slice(start + find.length)}`;
  return {
    ordinal: 0,
    kind: "replace_text",
    targetId: "body",
    schemaVersion: 1,
    before: { markdown: before, changedText: find },
    after: { markdown: after, changedText: replace },
    anchor: {
      from: start,
      to: start + find.length,
      prefix: content.slice(Math.max(0, start - ANCHOR_CONTEXT_CHARS), start),
      suffix: content.slice(
        start + find.length,
        start + find.length + ANCHOR_CONTEXT_CHARS,
      ),
    },
  };
}

function rejectedFind(
  error:
    | { kind: "missing"; editIndex: number; find: string }
    | { kind: "ambiguous"; editIndex: number; find: string; matches: number }
    | { kind: "overlapping"; editIndexes: [number, number] },
): never {
  if (error.kind === "missing") {
    throw new ActionContractError(
      `The find text does not appear on the page. Read the page with get-document and use its exact current text, including Markdown punctuation.`,
      {
        errorCode: "SUGGESTION_FIND_NOT_FOUND",
        statusCode: 400,
        details: { find: error.find },
      },
    );
  }
  if (error.kind === "ambiguous") {
    throw new ActionContractError(
      `The find text appears ${error.matches} times on the page. Include more surrounding text so it matches exactly once.`,
      {
        errorCode: "SUGGESTION_FIND_AMBIGUOUS",
        statusCode: 400,
        details: { find: error.find, matches: error.matches },
      },
    );
  }
  throw new ActionContractError(
    "A single suggested edit cannot use overlapping text ranges.",
    { errorCode: "SUGGESTION_FIND_OVERLAPPING", statusCode: 400 },
  );
}

export default defineAction({
  description:
    "Propose a reviewable suggested edit (track changes) to a document without changing the page. First call get-document, then pass its baseRevision and a caller-generated idempotencyKey. Content builds the tracked change from find/replace against the page's current text; the page stays unchanged until a reviewer accepts the pending suggestion.",
  deferLoading: false,
  mcpTool: true,
  agentInputSchema: externalSuggestDocumentEditSchema,
  schema: suggestDocumentEditSchema,
  http: false,
  link: ({ args, result }) => {
    const suggestion = result as { suggestionId?: string };
    const resourceId =
      args.id ?? (result as { resourceId?: string }).resourceId;
    if (!suggestion.suggestionId || !resourceId) return null;
    return {
      url: contentSuggestionPath(resourceId, suggestion.suggestionId),
      label: "Open suggestion",
    };
  },
  run: async (args, ctx) => {
    const id = args.id;
    if (!id) throw new Error("--id is required");
    if (!args.find) throw new Error("--find is required");

    const isExternalCaller =
      ctx?.caller === "tool" ||
      ctx?.caller === "mcp" ||
      ctx?.caller === "webmcp" ||
      ctx?.caller === "a2a";
    if (isExternalCaller && (!args.baseRevision || !args.idempotencyKey)) {
      throw new ActionContractError(
        "External suggested edits require baseRevision and idempotencyKey from get-document.",
        { errorCode: "SUGGESTION_EDIT_PROTOCOL_REQUIRED", statusCode: 400 },
      );
    }

    const access = await assertAccess("document", id, "commenter");
    const existing = access.resource;
    const content = existing.content ?? "";

    // A retried call with the same key must return the first receipt even when
    // the page moved underneath it: rebuilding from current content would
    // produce a different request hash and mask the original result. Only an
    // identical find/replace edit counts as the same logical request.
    const effectiveSummary =
      args.summary?.trim() ||
      (args.replace
        ? `Replace "${args.find.slice(0, 80)}" with "${args.replace.slice(0, 80)}"`
        : `Delete "${args.find.slice(0, 80)}"`);
    if (args.idempotencyKey) {
      await ensureSuggestionTables();
      const receipt = await getSuggestionByCreationKey(
        getDbExec(),
        args.idempotencyKey,
      );
      if (receipt) {
        const callerEmail = ctx?.userEmail ?? null;
        const callerKind = suggestionActorKind(ctx);
        const [first] = receipt.suggestion.operations ?? [];
        const before = first?.before as { changedText?: unknown } | undefined;
        const after = first?.after as { changedText?: unknown } | undefined;
        if (
          receipt.suggestion.resourceType !== "document" ||
          receipt.suggestion.resourceId !== id
        ) {
          // The receipt may belong to a document this caller cannot read;
          // never disclose its identity through a mismatch error.
          throw new ActionContractError(
            "This idempotencyKey was already used for a suggestion on a different page; use a fresh key.",
            {
              errorCode: "SUGGESTION_EDIT_PROTOCOL_KEY_MISMATCH",
              statusCode: 409,
            },
          );
        }
        const sameEdit =
          receipt.suggestion.summary === effectiveSummary &&
          first?.kind === "replace_text" &&
          before?.changedText === args.find &&
          after?.changedText === (args.replace ?? "") &&
          (receipt.authorEmail ?? null) === callerEmail &&
          suggestionActorKindMatchesReceipt(
            receipt.actorKind ?? null,
            callerKind,
            receipt.suggestion.createdAt ?? null,
          );
        if (!sameEdit) {
          throw new ActionContractError(
            `This idempotencyKey already created suggestion ${receipt.suggestion.id} with a different edit; use a fresh key for a different change.`,
            {
              errorCode: "SUGGESTION_EDIT_PROTOCOL_KEY_MISMATCH",
              statusCode: 409,
              details: { suggestionId: receipt.suggestion.id },
            },
          );
        }
        return {
          suggestionId: receipt.suggestion.id,
          status: receipt.suggestion.status,
          revision: receipt.suggestion.revision,
          threadId: receipt.suggestion.threadId,
          url: contentSuggestionPath(id, receipt.suggestion.id),
        };
      }
    }

    const resolved = resolveDocumentTextEdits(content, [
      { find: args.find, replace: args.replace ?? "" },
    ]);
    if (!resolved.ok) rejectedFind(resolved.error);
    const range = resolved.ranges[0]!;

    const operation = buildMarkdownSuggestionOperation({
      content,
      find: args.find,
      replace: args.replace ?? "",
      start: range.start,
    });

    const summary = effectiveSummary;

    const result = await createResourceSuggestion.run(
      {
        resourceType: "document",
        resourceId: id,
        adapterKind: "content.document-markdown",
        // External callers pin the exact body they read; internal callers anchor
        // to the body this action just resolved so the base is never stale-empty.
        baseRevision:
          args.baseRevision ||
          documentRevisionToken(existing.bodyRevision, content),
        summary,
        idempotencyKey: args.idempotencyKey ?? crypto.randomUUID(),
        operations: [operation],
      },
      ctx,
    );

    if (isExternalCaller) {
      track(
        "ai_refine_used",
        {
          app_name: "content",
          template_name: "content",
          output_id: id,
          output_type: "document",
          edit_count: 1,
          refine_type: "suggested_edit",
        },
        ctx,
      );
    }

    const suggestion = result as {
      id: string;
      status: string;
      revision: number;
      threadId: string;
    };
    return {
      suggestionId: suggestion.id,
      status: suggestion.status,
      revision: suggestion.revision,
      threadId: suggestion.threadId,
      url: contentSuggestionPath(id, suggestion.id),
    };
  },
});
