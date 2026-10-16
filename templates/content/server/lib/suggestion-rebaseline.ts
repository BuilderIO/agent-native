import type { DbExec } from "@agent-native/core/db";
import {
  listSuggestions,
  rebaseSuggestion,
  type SuggestionOperation,
} from "@agent-native/core/review";

import { ACTIVE_COMMENT_AI_STATUSES } from "../../shared/comment-ai.js";
import {
  commentAnchorText,
  rebaselinedCommentQuote,
  type CommentQuoteAnchor,
} from "../../shared/comment-reanchor.js";
import { rebaselineSuggestions } from "../../shared/suggestion-rebaseline.js";
import { CONTENT_DOCUMENT_SUGGESTION_ADAPTER } from "./suggested-edits.js";

// Converting a page's stored body to its canonical form rewrites the text
// every pending suggestion and comment quote is anchored to. This moves them
// onto the canonical text in the conversion's own transaction, or refuses
// the conversion when one of them would lose its target.

export type PageRebaselineInput = {
  documentId: string;
  /** The stored body the conversion replaces. */
  stored: string;
  /** canonicalizeNfm(stored), the body the conversion writes. */
  canonical: string;
  /** The revision token of the stored body. */
  storedRevision: string;
  /** The revision token the conversion gives the canonical body. */
  canonicalRevision: string;
  /**
   * The text the page's live copy showed before the conversion reseeds it,
   * `commentAnchorTextOf` its tree, or null when it had none. Comment quotes
   * were captured from that tree; parsing its Markdown again can read it
   * differently.
   */
  previousLiveText: string | null;
  now: string;
};

export type PageRebaselineReport =
  | {
      status: "rebaselined";
      suggestions: {
        id: string;
        outcome: "unchanged" | "rebased" | "stale";
      }[];
      comments: { id: string; outcome: "unchanged" | "rebased" | "orphaned" }[];
    }
  | {
      /** Nothing was written. Convert the page later, or never. */
      status: "blocked";
      reason:
        | "comment_ai_active"
        | "suggestion_change_vanishes"
        | "suggestion_structure_unsupported"
        | "comment_quote_changes";
      ids: string[];
    };

/**
 * Moves the pending suggestions and comment quotes of one page onto its
 * canonical body. Run it inside the conversion's transaction, holding the
 * page row, after the canonical body and its revision are known. When the
 * report is `blocked` it wrote nothing, and the conversion must roll back.
 */
export async function rebaselinePageForCanonicalBody(
  tx: DbExec,
  input: PageRebaselineInput,
): Promise<PageRebaselineReport> {
  // A Comment AI run holds the thread's digest and the page's revision, and
  // would submit a suggestion built on the stored body.
  const activeRequests = (
    await tx.execute({
      sql: `SELECT id FROM comment_ai_requests WHERE document_id = ? AND status IN (${ACTIVE_COMMENT_AI_STATUSES.map(() => "?").join(",")}) ORDER BY id`,
      args: [input.documentId, ...ACTIVE_COMMENT_AI_STATUSES],
    })
  ).rows.map((row) => String(row.id));
  if (activeRequests.length)
    return {
      status: "blocked",
      reason: "comment_ai_active",
      ids: activeRequests,
    };

  const pending = (
    await listSuggestions("document", input.documentId, ["pending"], tx)
  ).filter(
    (suggestion) =>
      suggestion.adapterKind === CONTENT_DOCUMENT_SUGGESTION_ADAPTER,
  );
  for (const suggestion of pending) {
    if (suggestion.operations.length !== 1)
      throw new Error(
        `Content suggestion ${suggestion.id} has ${suggestion.operations.length} operations; it can't be re-baselined`,
      );
  }
  const outcomes = rebaselineSuggestions(
    pending.map((suggestion) => ({
      id: suggestion.id,
      group: suggestion.proposalId ?? suggestion.id,
      operation: suggestion.operations[0]!,
    })),
    input.stored,
    input.canonical,
  );
  for (const reason of ["change_vanishes", "structure_unsupported"] as const) {
    const blocked = pending
      .filter((suggestion) => {
        const outcome = outcomes.get(suggestion.id);
        return outcome?.kind === "blocked" && outcome.reason === reason;
      })
      .map((suggestion) => suggestion.id);
    if (blocked.length)
      return {
        status: "blocked",
        reason: `suggestion_${reason}`,
        ids: blocked,
      };
  }

  const comments = (
    await tx.execute({
      sql: `SELECT id,quoted_text,anchor_prefix,anchor_suffix,anchor_start_offset FROM document_comments
            WHERE document_id = ? AND quoted_text IS NOT NULL AND quoted_text <> ''
            ORDER BY id FOR UPDATE`,
      args: [input.documentId],
    })
  ).rows;
  const previousText =
    input.previousLiveText ?? commentAnchorText(input.stored);
  const nextText = commentAnchorText(input.canonical);
  const quoteOutcomes = comments.map((row) => {
    const quote: CommentQuoteAnchor = {
      quotedText: String(row.quoted_text),
      prefix: row.anchor_prefix == null ? null : String(row.anchor_prefix),
      suffix: row.anchor_suffix == null ? null : String(row.anchor_suffix),
      startOffset:
        row.anchor_start_offset == null
          ? null
          : Number(row.anchor_start_offset),
    };
    return {
      id: String(row.id),
      outcome: rebaselinedCommentQuote(quote, previousText, nextText),
    };
  });
  const blockedQuotes = quoteOutcomes
    .filter(({ outcome }) => outcome.kind === "blocked")
    .map(({ id }) => id);
  if (blockedQuotes.length)
    return {
      status: "blocked",
      reason: "comment_quote_changes",
      ids: blockedQuotes,
    };

  const suggestionReport: Extract<
    PageRebaselineReport,
    { status: "rebaselined" }
  >["suggestions"] = [];
  for (const suggestion of pending) {
    const outcome = outcomes.get(suggestion.id);
    if (!outcome || outcome.kind === "blocked")
      throw new Error(`Suggestion ${suggestion.id} has no re-baseline outcome`);
    if (outcome.kind === "stale") {
      suggestionReport.push({ id: suggestion.id, outcome: "stale" });
      continue;
    }
    // A suggestion already on the canonical text keeps its operation, but a
    // base that was current stays current.
    if (
      outcome.kind === "unchanged" &&
      suggestion.baseRevision !== input.storedRevision
    ) {
      suggestionReport.push({ id: suggestion.id, outcome: "unchanged" });
      continue;
    }
    const rebased = await rebaseSuggestion(tx, suggestion, {
      operations:
        outcome.kind === "rebased"
          ? [outcome.operation as SuggestionOperation]
          : suggestion.operations,
      baseRevision: input.canonicalRevision,
      idempotencyKey: `content-canonical-rebaseline:${suggestion.id}:${suggestion.revision}:${input.canonicalRevision}`,
      reason: "content-canonical-body",
    });
    if (!rebased)
      throw new Error(
        `Suggestion ${suggestion.id} changed while its page was converted`,
      );
    suggestionReport.push({ id: suggestion.id, outcome: outcome.kind });
  }

  for (const { id, outcome } of quoteOutcomes) {
    if (outcome.kind !== "rebased") continue;
    await tx.execute({
      sql: "UPDATE document_comments SET quoted_text = ?, anchor_prefix = ?, anchor_suffix = ?, anchor_start_offset = ?, updated_at = ? WHERE id = ?",
      args: [
        outcome.quote.quotedText,
        outcome.quote.prefix,
        outcome.quote.suffix,
        outcome.quote.startOffset,
        input.now,
        id,
      ],
    });
  }

  return {
    status: "rebaselined",
    suggestions: suggestionReport,
    comments: quoteOutcomes.map(({ id, outcome }) => ({
      id,
      outcome: outcome.kind as "unchanged" | "rebased" | "orphaned",
    })),
  };
}
