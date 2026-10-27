import type { WriteReceipt } from "../action.js";
import { clipHead } from "./clip-text.js";
import type { AgentLoopFinalResponseGuardResult } from "./production-agent.js";

export type ToolWriteReceipt = WriteReceipt & { tool: string };

export interface WriteReceiptGuard {
  retryMessage: string;
  fallbackMessage: string;
  exhaustedDraftPrefix: string;
  maxRetries: number;
}

const MAX_SUMMARY_CHARS = 200;
const MAX_SUBJECT_CHARS = 200;
const MAX_DETAIL_CHARS = 160;
const MAX_CHECKS = 8;
const MAX_WARNINGS = 5;
// About 120 tokens per receipt in the retry block.
const MAX_RECEIPT_LINE_CHARS = 480;
const MAX_RECEIPT_LINES = 6;

const clip = (text: string, max: number) =>
  text.length > max ? `${clipHead(text, max - 1)}…` : text;

// Bidi overrides and isolates reorder the line the user reads, and zero-width
// space, word joiner, BOM and tag characters hide text. ZWJ, ZWNJ and the
// directional marks stay: they change the meaning of Persian, Indic and emoji
// text.
const HIDING_CHARS =
  /[\u200b\u2060\ufeff\u202a-\u202e\u2066-\u2069\u{E0000}-\u{E007F}]/gu;

/**
 * Receipt text can carry strings an author of the written record controls
 * (panel titles, column aliases). It reaches a user-role retry message and
 * a user-visible block, so it is one line with no control characters and no
 * angle brackets that could close the `<write-receipts>` tag.
 */
function sanitizeText(text: string, max: number): string {
  return clip(
    text
      .replace(/[\p{Cc}\u2028\u2029]/gu, " ")
      .replace(HIDING_CHARS, "")
      .replace(/</g, "‹")
      .replace(/>/g, "›")
      .replace(/\s+/g, " ")
      .trim(),
    max,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseReceipt(raw: unknown): WriteReceipt | null {
  if (!isRecord(raw)) return null;
  const { changed, verified, summary, subject, checks, warnings } = raw;
  if (typeof changed !== "boolean" || typeof summary !== "string") return null;
  if (subject !== undefined && typeof subject !== "string") return null;
  if (verified !== true && verified !== false && verified !== "unverified") {
    return null;
  }
  let parsedChecks: NonNullable<WriteReceipt["checks"]> | undefined;
  if (checks !== undefined) {
    if (!Array.isArray(checks)) return null;
    parsedChecks = [];
    for (const check of checks.slice(0, MAX_CHECKS)) {
      if (
        !isRecord(check) ||
        typeof check.id !== "string" ||
        typeof check.ok !== "boolean" ||
        (check.detail !== undefined && typeof check.detail !== "string")
      ) {
        return null;
      }
      parsedChecks.push({
        id: check.id,
        ok: check.ok,
        ...(check.detail === undefined
          ? {}
          : { detail: clip(check.detail, MAX_DETAIL_CHARS) }),
      });
    }
  }
  if (
    warnings !== undefined &&
    (!Array.isArray(warnings) ||
      !warnings.every((warning) => typeof warning === "string"))
  ) {
    return null;
  }
  return {
    changed,
    verified,
    summary: clip(summary, MAX_SUMMARY_CHARS),
    ...(subject?.trim()
      ? { subject: clip(subject.trim(), MAX_SUBJECT_CHARS) }
      : {}),
    ...(parsedChecks ? { checks: parsedChecks } : {}),
    ...(warnings
      ? {
          warnings: (warnings as string[])
            .slice(0, MAX_WARNINGS)
            .map((warning) => clip(warning, MAX_DETAIL_CHARS)),
        }
      : {}),
  };
}

/**
 * Reads the reserved `_receipt` off an action's raw result. A receipt that is
 * present but unreadable is `unverified`, never silently clean.
 */
export function readWriteReceipt(result: unknown): WriteReceipt | undefined {
  if (!isRecord(result) || result._receipt === undefined) return undefined;
  return (
    parseReceipt(result._receipt) ?? {
      changed: true,
      verified: "unverified",
      summary: "malformed receipt",
    }
  );
}

function receiptLine(receipt: ToolWriteReceipt): string {
  const failed = (receipt.checks ?? [])
    .filter((check) => !check.ok)
    .map((check) =>
      check.detail
        ? `${sanitizeText(check.id, MAX_DETAIL_CHARS)} (${sanitizeText(check.detail, MAX_DETAIL_CHARS)})`
        : sanitizeText(check.id, MAX_DETAIL_CHARS),
    );
  return clip(
    `- ${receipt.tool}: changed=${receipt.changed} verified=${receipt.verified}. ${sanitizeText(receipt.summary, MAX_SUMMARY_CHARS)}${
      failed.length > 0 ? ` Failed checks: ${failed.join("; ")}.` : ""
    }`,
    MAX_RECEIPT_LINE_CHARS,
  );
}

/**
 * A flagged receipt is dropped once later verified changes to the same subject
 * re-checked everything it failed on. A verified receipt speaks only for the
 * parts it checked, so one with no matching `ok` checks (an edit that touched
 * nothing the failure was about) supersedes nothing that carried a failing
 * check. A later receipt from another tool counts only against a failing
 * check, because that check id is what ties the two tools' receipts to the
 * same fault; a flagged receipt with no failing checks is dropped only by a
 * later change from its own tool. A receipt with no subject is never
 * superseded.
 */
function stillFlaggedReceipts(
  receipts: readonly ToolWriteReceipt[],
): ToolWriteReceipt[] {
  return receipts.filter((receipt, index) => {
    if (receipt.verified === true && receipt.changed) return false;
    const { subject } = receipt;
    if (!subject) return true;
    const failing = (receipt.checks ?? []).filter((check) => !check.ok);
    const verifiedLater = receipts
      .slice(index + 1)
      .filter(
        (later) =>
          (later.tool === receipt.tool || failing.length > 0) &&
          later.subject === subject &&
          later.changed &&
          later.verified === true,
      );
    if (verifiedLater.length === 0) return true;
    const rechecked = new Set(
      verifiedLater.flatMap((later) =>
        (later.checks ?? []).filter((check) => check.ok).map(({ id }) => id),
      ),
    );
    return failing.some((check) => !rechecked.has(check.id));
  });
}

/**
 * A receipt that says nothing was written, or that the effect did not hold,
 * forces one retry per turn. `unverified` alone only annotates the answer.
 */
export function writeReceiptGuard(
  receipts: readonly ToolWriteReceipt[],
  alreadyRetried: boolean,
): WriteReceiptGuard | null {
  const flagged = stillFlaggedReceipts(receipts);
  if (flagged.length === 0) return null;
  const lines = flagged.slice(0, MAX_RECEIPT_LINES).map(receiptLine);
  if (flagged.length > MAX_RECEIPT_LINES) {
    lines.push(`- (+${flagged.length - MAX_RECEIPT_LINES} more)`);
  }
  const block = lines.join("\n");
  const needsRetry = flagged.some(
    (receipt) => receipt.verified === false || !receipt.changed,
  );
  return {
    retryMessage: `<write-receipts>\n${block}\n</write-receipts>\nState what these receipts show. Do not say a change is visible or working unless verified=true.`,
    fallbackMessage: `Write check:\n${block}`,
    exhaustedDraftPrefix: `Write check:\n${block}`,
    maxRetries: needsRetry && !alreadyRetried ? 1 : 0,
  };
}

/**
 * One guard result from the receipt guard and the app's guard. The retry
 * counter is shared, so the larger budget wins and both messages are sent in
 * the same retry.
 */
export function mergeFinalResponseGuards(
  receipt: WriteReceiptGuard,
  app: AgentLoopFinalResponseGuardResult,
): AgentLoopFinalResponseGuardResult {
  const appGuard: Exclude<AgentLoopFinalResponseGuardResult, string> =
    typeof app === "string" ? { retryMessage: app, fallbackMessage: app } : app;
  return {
    retryMessage: `${receipt.retryMessage}\n\n${appGuard.retryMessage}`,
    maxRetries: Math.max(receipt.maxRetries, appGuard.maxRetries ?? 1),
    ...(appGuard.expandToolSurface ? { expandToolSurface: true } : {}),
    ...(appGuard.exhaustedDraftPrefix
      ? {
          exhaustedDraftPrefix: `${receipt.exhaustedDraftPrefix}\n\n${appGuard.exhaustedDraftPrefix}`,
          fallbackMessage: appGuard.fallbackMessage ?? receipt.fallbackMessage,
        }
      : {
          fallbackMessage: `${receipt.fallbackMessage}\n\n${appGuard.fallbackMessage ?? appGuard.retryMessage}`,
        }),
  };
}
