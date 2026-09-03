import { createHash } from "node:crypto";

export type SuggestedEditOperation =
  | "add"
  | "delete"
  | "replace"
  | "new-text-block"
  | "format";

export interface SuggestedEdit {
  operation: SuggestedEditOperation;
  before: string;
  after: string;
  anchor?: string;
}

export interface SuggestedEditTarget {
  body: string;
  source?: "database" | "local-file" | "provider" | "canonical";
  locked?: boolean;
  unsupported?: boolean;
}

export interface SuggestedEditApplyResult {
  state: "applied" | "stale" | "conflict";
  body: string;
  reason?: string;
}

const unsupportedSources = new Set(["database", "local-file", "provider"]);

export function suggestedEditDigest(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function assertSuggestedEditTarget(target: SuggestedEditTarget): void {
  if (target.locked) throw new Error("Suggested edits are unavailable on a locked page.");
  if (target.unsupported || (target.source && unsupportedSources.has(target.source))) {
    throw new Error("Suggested edits are unavailable for this document source or content.");
  }
}

export function applySuggestedEdit(
  target: SuggestedEditTarget,
  edit: SuggestedEdit,
  baseDigest: string,
): SuggestedEditApplyResult {
  assertSuggestedEditTarget(target);
  if (suggestedEditDigest(target.body) === baseDigest) {
    return { state: "applied", body: applyExact(target.body, edit) };
  }

  const context = edit.before || edit.anchor;
  if (!context) return { state: "stale", body: target.body, reason: "The page changed since this suggestion was created." };
  const first = target.body.indexOf(context);
  if (first < 0) return { state: "stale", body: target.body, reason: "The suggested material is no longer present." };
  if (first !== target.body.lastIndexOf(context)) {
    return { state: "conflict", body: target.body, reason: "The suggested context occurs more than once." };
  }
  return {
    state: "applied",
    body: applyAtContext(target.body, edit, first, context),
  };
}

function applyExact(body: string, edit: SuggestedEdit): string {
  if (edit.operation === "new-text-block") return body ? `${body}\n\n${edit.after}` : edit.after;
  const index = edit.before ? body.indexOf(edit.before) : -1;
  if (index < 0 && edit.operation !== "add") throw new Error("Suggested material is not present in the canonical page.");
  if (index < 0) return body ? `${body}\n\n${edit.after}` : edit.after;
  return applyAtContext(body, edit, index, edit.before);
}

function applyAtContext(body: string, edit: SuggestedEdit, index: number, context: string): string {
  const end = index + context.length;
  if (edit.operation === "delete") return body.slice(0, index) + body.slice(end);
  if (edit.operation === "add" || edit.operation === "new-text-block") {
    return body.slice(0, end) + edit.after + body.slice(end);
  }
  return body.slice(0, index) + edit.after + body.slice(end);
}
