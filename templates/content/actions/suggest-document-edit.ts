import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
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
    const suggestion = result as { id?: string };
    if (!suggestion.id) return null;
    return {
      url: contentSuggestionPath(
        args.id ?? (result as { resourceId?: string }).resourceId ?? "",
        suggestion.id,
      ),
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

    const summary =
      args.summary?.trim() ||
      (args.replace
        ? `Replace "${args.find.slice(0, 80)}" with "${args.replace.slice(0, 80)}"`
        : `Delete "${args.find.slice(0, 80)}"`);

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
