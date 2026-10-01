import {
  CREDENTIAL_STORE_UNAVAILABLE_ERROR_CODE,
  isLlmCredentialError,
  LLM_MISSING_CREDENTIALS_ERROR_CODE,
} from "../agent/engine/credential-errors.js";
import {
  AMBIGUOUS_HTTP_CREDENTIAL_CODES,
  credentialStateForErrorCode,
} from "../agent/engine/credential-state.js";
import {
  BUILDER_GATEWAY_INTERNAL_ERROR_CODE,
  PROVIDER_RATE_LIMITED_ERROR_CODE,
  PROVIDER_TRANSIENT_REJECTION_ERROR_CODE,
} from "../agent/engine/error-detail.js";
import { organizationIdFromResourceOwner } from "../resources/store.js";
import { resolveDeployEnvironment } from "../server/deploy-environment.js";
import type { JobFrontmatter, JobFrontmatterPatch } from "./frontmatter.js";

/**
 * Failures a retry cannot fix: the run never started because something the
 * automation depends on is absent. They are typed outcomes of their own, never
 * folded into a generic "errored", so the owner sees the real cause and the
 * scheduler can stop re-failing every tick.
 */
export const AUTOMATION_PRECONDITION_CODES = [
  LLM_MISSING_CREDENTIALS_ERROR_CODE,
  "missing_tools",
  "owner_missing",
  "owner_reserved",
  "config_invalid",
] as const;

export type AutomationPreconditionCode =
  (typeof AUTOMATION_PRECONDITION_CODES)[number];

export const MISSING_TOOLS_ERROR_CODE = "missing_tools";
export const OWNER_MISSING_ERROR_CODE = "owner_missing";
export const OWNER_RESERVED_ERROR_CODE = "owner_reserved";
export const CONFIG_INVALID_ERROR_CODE = "config_invalid";
export const BACKGROUND_AUTOMATION_FAILED_ERROR_CODE =
  "background_automation_failed";

/** Consecutive identical precondition failures before the automation pauses. */
export const PRECONDITION_PAUSE_AFTER = 3;
/** Ordinary runtime errors may be transient, so they get more attempts. */
export const RUNTIME_PAUSE_AFTER = 5;
const RUNTIME_BACKOFF_BASE_MS = 15 * 60_000;
const RUNTIME_BACKOFF_MAX_MS = 6 * 60 * 60_000;
const MAX_RECORDED_ERROR_CHARS = 500;

export function isAutomationPreconditionCode(
  code: string | null | undefined,
): code is AutomationPreconditionCode {
  return (
    code != null &&
    (AUTOMATION_PRECONDITION_CODES as readonly string[]).includes(code)
  );
}

/**
 * A code that says the LLM credential is absent, rejected, or not allowed:
 * only a person reconnecting or an admin granting it fixes it, so retrying is
 * pointless. A spent quota (`exhausted`) heals on its own and is not one, and
 * a bare HTTP status (a gateway wave also returns them) does not name the
 * credential as the cause.
 */
export function isCredentialPreconditionCode(
  code: string | null | undefined,
): boolean {
  if (!code || AMBIGUOUS_HTTP_CREDENTIAL_CODES.has(code.toLowerCase())) {
    return false;
  }
  const kind = credentialStateForErrorCode(code)?.kind;
  return kind === "missing" || kind === "rejected" || kind === "notPermitted";
}

/**
 * An absent credential: connecting one is the whole fix, so a pause for it
 * resumes as soon as one is usable. A rejected or forbidden credential is not
 * one: its rejection marker expires on a timer while the key stays bad, so it
 * stays paused until the owner enables the automation again.
 */
export function isMissingCredentialCode(
  code: string | null | undefined,
): boolean {
  return credentialStateForErrorCode(code)?.kind === "missing";
}

const TRANSIENT_FAILURE_CODES = new Set([
  CREDENTIAL_STORE_UNAVAILABLE_ERROR_CODE,
  "remote_dispatch_failed",
  "remote_execution_unavailable",
  "http_429",
  PROVIDER_RATE_LIMITED_ERROR_CODE,
  "overloaded_error",
  "provider_network_error",
  PROVIDER_TRANSIENT_REJECTION_ERROR_CODE,
  BUILDER_GATEWAY_INTERNAL_ERROR_CODE,
  "builder_gateway_network_error",
]);

/**
 * Failures of the platform or a provider rather than of the automation: spent
 * credits, an unreadable credential store, a remote host, rate limits and 5xx.
 * They pause like any runtime failure, but the pause lifts itself on a timed
 * probe, so a fleet incident or a credit reset never leaves automations off.
 */
export function isTransientAutomationFailureCode(
  code: string | null | undefined,
): boolean {
  const normalized = code?.trim().toLowerCase();
  if (!normalized) return false;
  return (
    TRANSIENT_FAILURE_CODES.has(normalized) ||
    /^http_5\d\d$/.test(normalized) ||
    credentialStateForErrorCode(normalized)?.kind === "exhausted"
  );
}

export interface AutomationFailure {
  /** Typed code persisted as `lastErrorCode` and the run's `error_code`. */
  code: string;
  /** The real cause, never a generic status sentence. */
  message: string;
  precondition: boolean;
}

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || !error || !("errorCode" in error)) {
    return undefined;
  }
  const code = (error as { errorCode?: unknown }).errorCode;
  return typeof code === "string" && code ? code : undefined;
}

export function classifyAutomationFailure(error: unknown): AutomationFailure {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";
  const explicit = errorCodeOf(error);
  // `background_automation_*` codes only say how the run ended; the message may
  // still name a missing credential, so those are classified by message.
  const specific = explicit && !explicit.startsWith("background_automation_");
  // The app's tool supplier throws this as a bare Error before the runner's
  // own check runs, so it reaches here without a code.
  const namesMissingTools = MISSING_TOOLS_MESSAGE.test(message);
  const code =
    explicit === "background_automation_mcp_tools_unavailable" ||
    (!specific && namesMissingTools)
      ? MISSING_TOOLS_ERROR_CODE
      : specific
        ? explicit
        : isLlmCredentialError(error)
          ? LLM_MISSING_CREDENTIALS_ERROR_CODE
          : (explicit ?? BACKGROUND_AUTOMATION_FAILED_ERROR_CODE);
  return {
    code,
    message,
    precondition:
      isAutomationPreconditionCode(code) || isCredentialPreconditionCode(code),
  };
}

export type AutomationOwnerKind = "user" | "organization" | "shared";

export function automationOwnerKind(owner: string): AutomationOwnerKind {
  if (owner === "__shared__") return "shared";
  return organizationIdFromResourceOwner(owner) ? "organization" : "user";
}

/** `__shared__` / `__organization__:<id>` are scopes, not people. */
export function isPseudoOwner(owner: string): boolean {
  return automationOwnerKind(owner) !== "user";
}

const MISSING_TOOLS_MESSAGE =
  /^Configured MCP tools are unavailable in this run\b/;

const RESERVED_TEST_TLDS = ["test", "invalid", "example"];
const RESERVED_TEST_DOMAINS = ["example.com", "example.org", "example.net"];

export function isReservedTestIdentity(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return (
    RESERVED_TEST_TLDS.some(
      (tld) => domain === tld || domain.endsWith(`.${tld}`),
    ) ||
    RESERVED_TEST_DOMAINS.some(
      (reserved) => domain === reserved || domain.endsWith(`.${reserved}`),
    )
  );
}

/**
 * QA fixtures such as `qa-*@local.test` are expected on local and beta
 * deployments; in production they only burn LLM runs against real sinks.
 */
export function isReservedIdentityBlocked(email: string): boolean {
  return (
    isReservedTestIdentity(email) && resolveDeployEnvironment() === "production"
  );
}

export function reservedIdentityMessage(email: string): string {
  return `Owner "${email}" is a reserved test identity, so this automation does not run in production. Delete it or move it to a real user.`;
}

export interface FailureTransition {
  consecutiveFailures: number;
  pause: boolean;
  /** Fields to persist on the job's frontmatter. */
  patch: JobFrontmatterPatch;
}

/**
 * A pause the framework applied and the owner has since lifted by enabling
 * the job again. Any writer that flips `enabled` leaves the old pause fields
 * behind, so they are read as stale instead of being trusted.
 */
export function hasStalePause(
  meta: Pick<JobFrontmatter, "enabled" | "pausedReason">,
): boolean {
  return meta.enabled && Boolean(meta.pausedReason);
}

export function isPausedByFramework(
  meta: Pick<JobFrontmatter, "enabled" | "pausedReason">,
): boolean {
  return !meta.enabled && Boolean(meta.pausedReason);
}

function truncate(value: string): string {
  return value.length > MAX_RECORDED_ERROR_CHARS
    ? `${value.slice(0, MAX_RECORDED_ERROR_CHARS - 1)}…`
    : value;
}

export function pausedMessage(
  code: string,
  count: number,
  message: string,
): string {
  const next = isTransientAutomationFailureCode(code)
    ? "It retries on its own and resumes once this clears."
    : "Fix the cause, then enable the automation again.";
  return truncate(
    `Paused after ${count} consecutive ${code} failures: ${message} ${next}`,
  );
}

/** The cause first, then the delivery note owners already know. */
export function withDeliveryNote(message: string): string {
  return truncate(
    `${message.trim().replace(/\.$/, "")}. No delivery was confirmed.`,
  );
}

/**
 * The one place a failure becomes persisted state. `countTowardPause: false`
 * (a manual run) records the real cause without moving the streak, so asking
 * for a run never pauses the automation. `eventId` keys the streak on the
 * event: a queue or webhook retry of an event already counted records its
 * cause without counting again, so one bad event cannot pause by itself.
 */
export function applyAutomationFailure(
  meta: Pick<
    JobFrontmatter,
    | "enabled"
    | "lastErrorCode"
    | "consecutiveFailures"
    | "pausedReason"
    | "lastFailedEventId"
  >,
  failure: AutomationFailure,
  now: Date,
  options: { countTowardPause?: boolean; eventId?: string } = {},
): FailureTransition {
  const recordedMessage = withDeliveryNote(failure.message);
  const retryOfCountedEvent =
    options.eventId !== undefined && options.eventId === meta.lastFailedEventId;
  if (options.countTowardPause === false || retryOfCountedEvent) {
    return {
      consecutiveFailures: meta.consecutiveFailures ?? 0,
      pause: false,
      patch: {
        lastStatus: "error",
        lastError: recordedMessage,
        lastErrorCode: failure.code,
      },
    };
  }
  const prior =
    hasStalePause(meta) || meta.lastErrorCode !== failure.code
      ? 0
      : (meta.consecutiveFailures ?? 0);
  const count = prior + 1;
  const threshold = failure.precondition
    ? PRECONDITION_PAUSE_AFTER
    : RUNTIME_PAUSE_AFTER;
  const pause = count >= threshold;
  return {
    consecutiveFailures: count,
    pause,
    patch: {
      lastStatus: pause ? "paused" : "error",
      lastError: pause
        ? pausedMessage(failure.code, count, failure.message)
        : recordedMessage,
      lastErrorCode: failure.code,
      consecutiveFailures: count,
      ...(options.eventId ? { lastFailedEventId: options.eventId } : {}),
      ...(pause
        ? {
            enabled: false,
            pausedReason: failure.code,
            pausedAt: now.toISOString(),
          }
        : { pausedReason: undefined, pausedAt: undefined }),
    },
  };
}

/**
 * A failure that happens before any run starts (owner gone, reserved
 * identity): nothing to retry, so it pauses on the first observation.
 */
export function pauseNow(
  failure: AutomationFailure,
  now: Date,
): FailureTransition {
  return {
    consecutiveFailures: 1,
    pause: true,
    patch: {
      lastStatus: "paused",
      lastError: truncate(failure.message),
      lastErrorCode: failure.code,
      consecutiveFailures: 1,
      enabled: false,
      pausedReason: failure.code,
      pausedAt: now.toISOString(),
    },
  };
}

/** Fields that clear every trace of a past failure or pause. */
export const CLEAR_FAILURE_STATE: JobFrontmatterPatch = {
  lastError: undefined,
  lastErrorCode: undefined,
  consecutiveFailures: undefined,
  lastFailedEventId: undefined,
  pausedReason: undefined,
  pausedAt: undefined,
};

/** The owner enabled the job again: it starts from a clean slate. */
export const RESUME_AUTOMATION_PATCH: JobFrontmatterPatch = {
  ...CLEAR_FAILURE_STATE,
  lastStatus: undefined,
};

/**
 * Exponential backoff for repeated runtime failures, so an automation that
 * keeps failing is attempted at a widening interval before it pauses.
 * Preconditions are not backed off: they pause on their own.
 */
export function runtimeFailureNextRun(
  cronNext: Date,
  now: Date,
  consecutiveFailures: number,
): Date {
  const earliest = now.getTime() + runtimeBackoffMs(consecutiveFailures);
  return earliest > cronNext.getTime() ? new Date(earliest) : cronNext;
}

function runtimeBackoffMs(consecutiveFailures: number): number {
  return Math.min(
    RUNTIME_BACKOFF_MAX_MS,
    RUNTIME_BACKOFF_BASE_MS * 2 ** Math.max(consecutiveFailures - 1, 0),
  );
}

/**
 * A transient pause is probed on the same widening backoff (capped at 6h)
 * that spaced the failures before it, counted from when it paused.
 */
export function isTransientPauseProbeDue(
  meta: Pick<
    JobFrontmatter,
    "pausedReason" | "pausedAt" | "consecutiveFailures"
  >,
  now: Date,
): boolean {
  if (!isTransientAutomationFailureCode(meta.pausedReason)) return false;
  const pausedAtMs = meta.pausedAt ? Date.parse(meta.pausedAt) : Number.NaN;
  return (
    !Number.isFinite(pausedAtMs) ||
    now.getTime() - pausedAtMs >=
      runtimeBackoffMs(meta.consecutiveFailures ?? RUNTIME_PAUSE_AFTER)
  );
}

/**
 * Lifts a transient pause for one probe. The streak and its code stay, so a
 * probe that fails the same way pauses again at once (and the existing alert
 * chain keeps that quiet); a probe that succeeds clears everything.
 */
export const TRANSIENT_PROBE_RESUME_PATCH: JobFrontmatterPatch = {
  enabled: true,
  lastStatus: "error",
  pausedReason: undefined,
  pausedAt: undefined,
};
