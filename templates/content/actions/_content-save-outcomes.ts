import { AsyncLocalStorage } from "node:async_hooks";

import type { ActionRunContext } from "@agent-native/core/action";
import { ForbiddenError } from "@agent-native/core/sharing";
import { countOutcome } from "@agent-native/core/tracking";

export type ContentSaveOutcome =
  | "written"
  | "unchanged"
  | "replayed"
  | "superseded"
  | "conflict"
  | "preserved_to_history"
  | "merged"
  | "merged_with_displaced_text"
  | "refused"
  | "applied"
  | "displaced_preserved"
  | "preservation_required"
  | "replay"
  | "refusal";

export type ContentSaveOperation =
  | "update_document"
  | "edit_document"
  | "create_document";

export interface ContentSaveOutcomeDimensions {
  outcome: ContentSaveOutcome;
  origin: "browser" | "recovery" | "agent";
  stale_base: "true" | "false" | "unknown";
  history_effect:
    | "none"
    | "transition"
    | "preservation"
    | "transition_and_preservation";
  reason_code?: string;
}

const reasons = new Set([
  "INVALID_EDITOR_EDIT_IDENTITY",
  "INVALID_EDITOR_SNAPSHOT",
  "INVALID_AUTHORED_BODY_INTENT",
  "INVALID_AUTHORED_BODY_BASE",
  "FAVORITE_UPDATE_MUST_BE_SEPARATE",
  "BASE_TITLE_REQUIRED",
  "INVALID_BROWSER_SAVE_ATTEMPT",
  "DOCUMENT_EDIT_PROTOCOL_REQUIRED",
  "BROWSER_SAVE_ACTOR_REQUIRED",
  "EDITOR_BODY_INTENT_REUSED",
  "INVALID_BASE_REVISION",
  "BROWSER_SAVE_ATTEMPT_REUSED",
  "BROWSER_SAVE_RECEIPT_INVALID",
  "DOCUMENT_NOT_FOUND",
  "DOCUMENT_ID_CONFLICT",
  "CALLER_SCOPE_REQUIRED",
  "DOCUMENT_EDIT_MODE_REQUIRED",
  "DOCUMENT_INITIALIZATION_CONTENT_REQUIRED",
  "IDEMPOTENCY_KEY_REUSED",
  "DOCUMENT_REVISION_CONFLICT",
  "structure",
  "provenance",
  "stale_empty_body",
  "stale_builder_image",
  "recovery_base_changed",
  "title_base_changed",
  "body_base_changed",
  "body_revision_cas_conflict",
  "timestamp_cas_conflict",
  "source_persisted_history_pending",
  "source_persisted_history_reconciled",
  "local_source_unavailable",
  "local_source_refused",
  "local_source_readback_pending",
  "STALE_BASE_REVISION",
  "EDIT_MATCH_MISSING",
  "EDIT_MATCH_AMBIGUOUS",
  "EDIT_RANGES_OVERLAP",
  "DOCUMENT_BODY_NOT_EMPTY",
  "DOCUMENT_EDIT_MODE_CONFLICT",
  "LINKED_LOCAL_REVISION_PROTOCOL_UNAVAILABLE",
  "RECEIPT_MISMATCH",
  "DOCUMENT_ACTOR_REQUIRED",
  "FORBIDDEN",
  "UNAUTHORIZED",
  "SPACE_NOT_FOUND",
  "SPACE_TARGET_CONFLICT",
]);

export function boundedContentSaveReason(error: unknown): string {
  if (error instanceof ForbiddenError) return "FORBIDDEN";
  const code =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "errorCode" in error
        ? error.errorCode
        : undefined;
  return typeof code === "string" && reasons.has(code) ? code : "untyped";
}

export function recordContentSaveOutcome(
  operation: ContentSaveOperation,
  dimensions: ContentSaveOutcomeDimensions,
): void {
  const bounded = {
    operation,
    outcome: dimensions.outcome,
    origin: dimensions.origin,
    stale_base: dimensions.stale_base,
    history_effect: dimensions.history_effect,
    ...(dimensions.reason_code
      ? { reason_code: boundedContentSaveReason(dimensions.reason_code) }
      : {}),
  };
  // Providers must never run in the save's settlement or acknowledgement turn.
  try {
    setTimeout(() => {
      try {
        const delivery: unknown = countOutcome(
          "content_save_outcome_counts",
          bounded,
        );
        // coercion-ok: telemetry delivery never changes the save's outcome.
        void Promise.resolve(delivery).catch(() => {});
      } catch {
        // coercion-ok: a failed provider cannot invalidate a persisted save.
      }
    }, 0);
  } catch {
    // coercion-ok: an unavailable telemetry scheduler cannot invalidate a save.
  }
}

const outcomeSymbol = Symbol("contentSaveOutcome");
const auditOutcomes = new AsyncLocalStorage<{ outcome?: ContentSaveOutcome }>();
const recoverySaveContexts = new WeakSet<ActionRunContext>();

export function withContentRecoverySaveContext(
  ctx: ActionRunContext,
): ActionRunContext {
  const recoveryContext = { ...ctx };
  recoverySaveContexts.add(recoveryContext);
  return recoveryContext;
}

export function contentSaveAuditOutcome(): ContentSaveOutcome | undefined {
  return auditOutcomes.getStore()?.outcome;
}

export function scopeContentSaveAudit<Args, Result>(
  run: (args: Args, ctx?: ActionRunContext) => Result,
): (args: Args, ctx?: ActionRunContext) => Result {
  // Scope begins before action validation, and lasts through its audit recorder.
  return (args, ctx) => auditOutcomes.run({}, () => run(args, ctx));
}

export function scopeContentSaveOutcome<T extends object>(
  result: T,
  outcome: ContentSaveOutcome,
): T {
  Object.defineProperty(result, outcomeSymbol, { value: outcome });
  return result;
}

export function contentSaveOutcome(
  result: unknown,
): ContentSaveOutcome | undefined {
  return result && typeof result === "object"
    ? (result as { [outcomeSymbol]?: ContentSaveOutcome })[outcomeSymbol]
    : undefined;
}

export function observeDocumentUpdateOutcome<Args, Result extends object>(
  save: (
    args: Args,
    ctx: ActionRunContext | undefined,
    measurement: ContentSaveOutcomeDimensions & {
      settled?: boolean;
      record?: boolean;
    },
  ) => Promise<Result>,
): (args: Args, ctx?: ActionRunContext) => Promise<Result> {
  return observeContentSaveOutcome("update_document", save);
}

export function observeRecoveryDocumentCreate<Args, Result extends object>(
  save: (
    args: Args,
    ctx: ActionRunContext | undefined,
    measurement: ContentSaveOutcomeDimensions & {
      settled?: boolean;
      record?: boolean;
    },
  ) => Promise<Result>,
): (args: Args, ctx?: ActionRunContext) => Promise<Result> {
  return observeContentSaveOutcome("create_document", save);
}

export function observeDocumentEditOutcome<Args, Result>(
  save: (
    args: Args,
    ctx: ActionRunContext | undefined,
    measurement: { settled?: boolean },
  ) => Promise<Result>,
): (args: Args, ctx?: ActionRunContext) => Promise<Result> {
  return async (args, ctx) => {
    const measurement: { settled?: boolean } = {};
    try {
      return await save(args, ctx, measurement);
    } catch (error) {
      if (!measurement.settled) {
        recordContentSaveOutcome("edit_document", {
          outcome: "refusal",
          origin: "agent",
          stale_base: "unknown",
          history_effect: "none",
          reason_code: boundedContentSaveReason(error),
        });
      }
      throw error;
    }
  };
}

function observeContentSaveOutcome<Args, Result extends object>(
  operation: ContentSaveOperation,
  save: (
    args: Args,
    ctx: ActionRunContext | undefined,
    measurement: ContentSaveOutcomeDimensions & {
      settled?: boolean;
      record?: boolean;
    },
  ) => Promise<Result>,
): (args: Args, ctx?: ActionRunContext) => Promise<Result> {
  return async (args, ctx) => {
    const measurement: ContentSaveOutcomeDimensions & {
      settled?: boolean;
      record?: boolean;
    } = {
      outcome: "unchanged",
      origin:
        ctx && recoverySaveContexts.has(ctx)
          ? "recovery"
          : ctx?.caller === "frontend"
            ? ctx.requestHeaders?.get("x-content-save-origin") === "recovery"
              ? "recovery"
              : "browser"
            : "agent",
      stale_base: "unknown",
      history_effect: "none",
    };
    if (operation === "create_document" && measurement.origin !== "recovery") {
      return save(args, ctx, measurement);
    }
    try {
      return scopeContentSaveOutcome(
        await save(args, ctx, measurement),
        measurement.outcome,
      );
    } catch (error) {
      if (!measurement.settled) {
        measurement.outcome = "refused";
        measurement.history_effect = "none";
        measurement.reason_code = boundedContentSaveReason(error);
      }
      throw error;
    } finally {
      if (measurement.outcome === "replayed") {
        measurement.history_effect = "none";
        measurement.stale_base = "unknown";
      }
      const audit = auditOutcomes.getStore();
      if (operation === "update_document" && audit)
        audit.outcome = measurement.outcome;
      if (measurement.record !== false)
        recordContentSaveOutcome(operation, measurement);
    }
  };
}
