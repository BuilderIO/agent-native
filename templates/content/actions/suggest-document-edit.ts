import { ActionContractError } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import { defineAction } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import {
  ensureSuggestionTables,
  getSuggestionByCreationKey,
  suggestionActorKind,
  suggestionActorKindMatchesReceipt,
} from "@agent-native/core/review";
import createResourceSuggestionProposal from "@agent-native/core/review/suggestions/actions/create-resource-suggestion-proposal";
import getResourceSuggestionProposalByCreationKey from "@agent-native/core/review/suggestions/actions/get-resource-suggestion-proposal-by-creation-key";
import { roleSatisfies } from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import { isLiveBodyWriterPage } from "../server/lib/live-body-writer.js";
import {
  resolveDocumentTextEdits,
  type DocumentTextEdit,
} from "../shared/document-text-edits.js";
import { canonicalizeNfm, nfmToDoc } from "../shared/nfm.js";
import { markdownSuggestionOperationsForFindReplace } from "../shared/suggestion-diff.js";
import { contentSuggestionPath } from "../shared/suggestion-link.js";
import { resolveDocumentAccess } from "./_document-access.js";
import { documentRevisionToken } from "./_document-edit-mutation.js";

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
  proposalId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Existing proposal ID for another edit in the same review pass. Reuse its summary.",
    ),
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

// Text between edge whitespace, as a stored body would spell it on its own:
// a candidate that resolveOnStoredForm checks in place. An edge newline
// separates blocks, which the stored form spells differently.
function inStoredForm(text: string): string | undefined {
  const core = text.trim();
  if (!core) return text;
  const start = text.indexOf(core);
  const lead = text.slice(0, start);
  const trail = text.slice(start + core.length);
  if (lead.includes("\n") || trail.includes("\n")) return undefined;
  return `${lead}${canonicalizeNfm(core)}${trail}`;
}

const ESCAPABLE = /[!-/:-@[-`{-~]/;

/** A character `text` doesn't use, so the parse shows it only where it's put. */
function unusedCharacter(text: string) {
  const used = new Set(text.match(/[\uE000-\uF8FF]/g));
  for (let code = 0xe000; code <= 0xf8ff; code += 1) {
    const character = String.fromCharCode(code);
    if (!used.has(character)) return character;
  }
  return undefined;
}

/** What follows `probe` each place the parse shows it, in text or an attribute. */
function shownAfter(value: unknown, probe: string, after: string[] = []) {
  if (typeof value === "string")
    for (const shown of value.split(probe).slice(1)) after.push(shown[0] ?? "");
  else if (value && typeof value === "object")
    for (const child of Object.values(value)) shownAfter(child, probe, after);
  return after;
}

/**
 * Whether the backslashes before `index` escape the character there. Code
 * keeps a backslash as written, and so does a link's destination except
 * before a parenthesis: only the parse can tell. A character the page
 * doesn't use, put just before the backslash, changes no escape, and the
 * parse shows the backslash after it wherever it kept the backslash.
 */
function escapedAt(text: string, index: number) {
  let slashes = 0;
  while (text[index - slashes - 1] === "\\") slashes += 1;
  if (slashes % 2 === 0 || !ESCAPABLE.test(text[index] ?? "")) return false;
  const probe = unusedCharacter(text);
  const shown =
    probe === undefined
      ? []
      : shownAfter(
          nfmToDoc(
            `${text.slice(0, index - 1)}${probe}${text.slice(index - 1)}`,
          ),
          probe,
        );
  // Taking a kept backslash for an escape only refuses the match.
  return !shown.length || shown.some((next) => next !== "\\");
}

/**
 * Where an agent's edit lands on a Page written through its live copy. Its
 * body is stored in canonical form, so the agent's find can be its own
 * spelling of stored text, such as `$60` for the stored `\$60`. A spelling
 * means what it means in its place on the page, not on its own: a range
 * qualifies only when the page with the agent's find put back there still
 * spells the stored page, and the replacement is the canonical form of the
 * page with the agent's replace there. A range never splits an escape.
 */
function resolveOnStoredForm(content: string, edit: DocumentTextEdit) {
  const exact = resolveDocumentTextEdits(content, [edit]);
  if (canonicalizeNfm(content) !== content) return exact;
  const missing = {
    ok: false as const,
    error: { kind: "missing" as const, editIndex: 0, find: edit.find },
  };
  let found = exact;
  if (!exact.ok && exact.error.kind === "missing") {
    const find = inStoredForm(edit.find);
    if (find === undefined || find === edit.find) return exact;
    found = resolveDocumentTextEdits(content, [{ find, replace: "" }]);
    if (!found.ok && found.error.kind === "missing") return exact;
  }
  if (!found.ok) return found;
  let { start, end } = found.ranges[0]!;
  if (escapedAt(content, start)) start -= 1;
  if (end > start && content[end - 1] === "\\" && escapedAt(content, end))
    return missing;
  const placed = (text: string) =>
    `${content.slice(0, start)}${text}${content.slice(end)}`;
  if (canonicalizeNfm(placed(edit.find)) !== content) return missing;
  const after = canonicalizeNfm(placed(edit.replace));
  // Canonicalizing can respell text next to the replacement, so the range
  // widens to every byte the change touches.
  let prefix = 0;
  while (
    prefix < Math.min(content.length, after.length) &&
    content[prefix] === after[prefix]
  )
    prefix += 1;
  let suffix = 0;
  while (
    suffix < Math.min(content.length, after.length) - prefix &&
    content[content.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix += 1;
  const from = Math.min(start, prefix);
  const to = Math.max(end, content.length - suffix);
  return {
    ok: true as const,
    content: after,
    ranges: [
      {
        find: content.slice(from, to),
        replace: after.slice(from, after.length - (content.length - to)),
        start: from,
        end: to,
      },
    ],
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
    if (args.proposalId && !args.summary?.trim()) {
      throw new ActionContractError(
        "Appending to a proposal requires the same summary returned by its first suggested edit.",
        { errorCode: "SUGGESTION_PROPOSAL_SUMMARY_REQUIRED", statusCode: 400 },
      );
    }
    if (args.find === (args.replace ?? "")) {
      throw new ActionContractError(
        "The proposed replacement does not change the page.",
        {
          errorCode: "SUGGESTION_EDIT_NO_CHANGE",
          statusCode: 400,
        },
      );
    }

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

    const access = await resolveDocumentAccess(id);
    if (!access) {
      throw Object.assign(new Error(`Document "${id}" not found`), {
        statusCode: 404,
      });
    }
    if (
      !roleSatisfies(
        access.role as Parameters<typeof roleSatisfies>[0],
        "commenter",
      )
    ) {
      throw new ActionContractError(
        "Commenter access is required to suggest edits on this page.",
        { errorCode: "SUGGESTION_EDIT_ACCESS_REQUIRED", statusCode: 403 },
      );
    }
    const existing = access.resource;
    const content = existing.content ?? "";
    const suggestionContext = {
      ...(ctx as ActionRunContext),
      orgId:
        access.authority?.orgId ?? existing.orgId ?? ctx?.orgId ?? undefined,
    };

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
          throw new ActionContractError(
            "This idempotencyKey was already used for a suggestion on a different page; use a fresh key.",
            {
              errorCode: "SUGGESTION_EDIT_PROTOCOL_KEY_MISMATCH",
              statusCode: 409,
            },
          );
        }
        const sameEdit =
          !args.proposalId &&
          receipt.suggestion.adapterKind === "content.document-markdown" &&
          (receipt.suggestion.operations?.length ?? 0) === 1 &&
          first?.targetId === "body" &&
          first?.schemaVersion === 1 &&
          receipt.suggestion.summary === effectiveSummary &&
          first?.kind === "replace_text" &&
          before?.changedText === args.find &&
          after?.changedText === (args.replace ?? "") &&
          (receipt.authorEmail ?? null) === callerEmail &&
          suggestionActorKindMatchesReceipt(
            receipt.actorKind ?? null,
            callerKind,
            receipt.receiptVersion ?? 1,
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
      const groupedReceipt =
        await getResourceSuggestionProposalByCreationKey.run(
          { idempotencyKey: args.idempotencyKey },
          suggestionContext,
        );
      if (groupedReceipt) {
        const first = groupedReceipt.suggestions[0];
        const sameEdit =
          groupedReceipt.proposal.resourceType === "document" &&
          groupedReceipt.proposal.resourceId === id &&
          groupedReceipt.proposal.adapterKind === "content.document-markdown" &&
          groupedReceipt.proposal.summary === effectiveSummary &&
          (first?.metadata?.sourceProposalId ?? null) ===
            (args.proposalId ?? null) &&
          (!args.baseRevision || first?.baseRevision === args.baseRevision) &&
          first?.metadata?.sourceFind === args.find &&
          first?.metadata?.sourceReplace === (args.replace ?? "");
        if (!first || !sameEdit) {
          throw new ActionContractError(
            "This idempotencyKey already created a different suggested edit; use a fresh key.",
            {
              errorCode: "SUGGESTION_EDIT_PROTOCOL_KEY_MISMATCH",
              statusCode: 409,
            },
          );
        }
        return {
          suggestionId: first.id,
          suggestionIds: groupedReceipt.suggestions.map((item) => item.id),
          proposalId: groupedReceipt.proposal.id,
          status: first.status,
          revision: first.revision,
          threadId: first.threadId,
          url: contentSuggestionPath(id, first.id),
        };
      }
    }

    const edit = { find: args.find, replace: args.replace ?? "" };
    const resolved = (await isLiveBodyWriterPage(id))
      ? resolveOnStoredForm(content, edit)
      : resolveDocumentTextEdits(content, [edit]);
    if (!resolved.ok) rejectedFind(resolved.error);
    const range = resolved.ranges[0]!;

    const operations = markdownSuggestionOperationsForFindReplace({
      before: content,
      find: range.find,
      replace: range.replace,
      start: range.start,
    });
    if (operations.length === 0) {
      throw new ActionContractError(
        "The proposed replacement does not change the page.",
        {
          errorCode: "SUGGESTION_EDIT_NO_CHANGE",
          statusCode: 400,
        },
      );
    }

    const summary = effectiveSummary;

    const grouped = await createResourceSuggestionProposal.run(
      {
        resourceType: "document",
        resourceId: id,
        adapterKind: "content.document-markdown",
        baseRevision:
          args.baseRevision ||
          documentRevisionToken(existing.bodyRevision, content),
        summary,
        proposalId: args.proposalId,
        idempotencyKey: args.idempotencyKey ?? crypto.randomUUID(),
        suggestions: operations.map((operation, index) => ({
          summary:
            operation.before.changedText && operation.after.changedText
              ? `Replace "${operation.before.changedText.slice(0, 80)}" with "${operation.after.changedText.slice(0, 80)}"`
              : operation.before.changedText
                ? `Delete "${operation.before.changedText.slice(0, 80)}"`
                : `Insert "${operation.after.changedText.slice(0, 80)}"`,
          operations: [{ ...operation, ordinal: 0 }],
          metadata:
            index === 0
              ? {
                  sourceFind: args.find,
                  sourceReplace: args.replace ?? "",
                  sourceProposalId: args.proposalId ?? null,
                }
              : undefined,
        })),
      },
      suggestionContext,
    );
    const first = grouped.suggestions[0]!;

    if (isExternalCaller) {
      track(
        "ai_refine_used",
        {
          app_name: "content",
          template_name: "content",
          output_id: id,
          output_type: "document",
          edit_count: operations.length,
          refine_type: "suggested_edit",
        },
        ctx,
      );
    }

    return {
      suggestionId: first.id,
      suggestionIds: grouped.suggestions.map((item) => item.id),
      proposalId: grouped.proposal.id,
      status: first.status,
      revision: first.revision,
      threadId: first.threadId,
      url: contentSuggestionPath(id, first.id),
    };
  },
});
