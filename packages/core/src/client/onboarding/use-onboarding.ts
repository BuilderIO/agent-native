import { useCallback, useEffect, useRef, useState } from "react";

import type {
  OnboardingAppProfile,
  OnboardingMethod,
  OnboardingStepStatus,
  OnboardingSummary,
} from "../../onboarding/types.js";
import {
  getAnalyticsIdentityKey,
  getAnalyticsSessionId,
  resolveAnalyticsIdentityKey,
  trackEvent,
} from "../analytics.js";
import { agentNativePath } from "../api-path.js";
import {
  scheduleAfterPaint,
  scheduleAfterStartup,
} from "../use-after-paint.js";
import {
  dispatchFirstRunOnboardingStatus,
  fetchFirstRunOnboardingStatus,
  readFirstRunOnboardingCookieState,
} from "./first-run-status.js";

const lastOnboardingStepViews = new Map<string, string>();
const seenOnboardingEvents = new Set<string>();
const CUSTOM_KEY_ATTEMPT_STORAGE_KEY =
  "agent-native.onboarding.custom_keys_attempt";
const locallyTrackedCustomKeyOutcomes = new Set<string>();
type CustomKeyOnboardingSaveOutcome =
  | "credential_saved"
  | "local_endpoint_saved";
type CustomKeyOnboardingAbandonmentOutcome =
  | "credential_abandoned"
  | "local_endpoint_abandoned";
type CustomKeyOnboardingSetupKind = "credential" | "local_endpoint";
const pendingCustomKeyCredentialSaves = new Map<
  string,
  {
    count: number;
    abandonmentRequested: boolean;
    saved: boolean;
    saveOutcome: CustomKeyOnboardingSaveOutcome;
    abandonmentOutcome: CustomKeyOnboardingAbandonmentOutcome;
  }
>();
let onboardingDocumentId: string | null = null;
let onboardingCorrelationSequence = 0;
const ONBOARDING_SUMMARY_TIMEOUT_MS = 15_000;
const ONBOARDING_SUMMARY_REUSE_MS = 5_000;

type CustomKeyOnboardingOutcome =
  | "credential_entry_started"
  | "credential_validated"
  | "credential_saved"
  | "credential_skipped"
  | "credential_abandoned"
  | "local_endpoint_saved"
  | "local_endpoint_skipped"
  | "local_endpoint_abandoned";

function isTerminalCustomKeyOnboardingOutcome(
  outcome: CustomKeyOnboardingOutcome,
): boolean {
  return (
    outcome === "credential_saved" ||
    outcome === "credential_skipped" ||
    outcome === "credential_abandoned" ||
    outcome === "local_endpoint_saved" ||
    outcome === "local_endpoint_skipped" ||
    outcome === "local_endpoint_abandoned"
  );
}

interface CustomKeyOnboardingAttempt {
  id: string;
  // Analytics sessions rotate after idle; attempt validity follows the identity.
  identityKey: string;
  // A restored BFCache page keeps this ID; a new document must not inherit it.
  documentId: string;
  setupKind?: CustomKeyOnboardingSetupKind;
  entryStarted?: boolean;
  credentialValidated?: boolean;
}

interface PendingCustomKeyOnboardingAttempt {
  attempt: Omit<CustomKeyOnboardingAttempt, "identityKey"> & {
    identityKey?: string;
  };
  identityKeyAtStart: string | undefined;
  status: "resolving" | "stored" | "memory" | "unavailable";
  outcomes: CustomKeyOnboardingOutcome[];
}

type CustomKeyAttemptRead =
  | { kind: "available"; attempt: CustomKeyOnboardingAttempt | null }
  | { kind: "pending"; pending: PendingCustomKeyOnboardingAttempt }
  | { kind: "stale" }
  | { kind: "unavailable" };

type CustomKeyOutcomeResult =
  | "tracked"
  | "tracked_uncorrelated"
  | "tracked_storage_unavailable"
  | "pending"
  | "missing"
  | "unavailable"
  | "stale"
  | "identity_mismatch"
  | "duplicate";

export function createOnboardingCorrelationId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  onboardingCorrelationSequence += 1;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${onboardingCorrelationSequence.toString(36)}`;
}

function getOnboardingDocumentId(): string {
  return (onboardingDocumentId ??= createOnboardingCorrelationId());
}

// Keep the handoff alive while the SPA opens settings before auth refresh settles.
let pendingCustomKeyOnboardingAttempt: PendingCustomKeyOnboardingAttempt | null =
  null;

function flushPendingCustomKeyOnboardingOutcomes(
  pending: PendingCustomKeyOnboardingAttempt,
): void {
  const outcomes = pending.outcomes.splice(0);
  for (const outcome of outcomes) {
    trackCustomKeyOnboardingOutcome(outcome);
  }
}

function readCustomKeyOnboardingAttempt(): CustomKeyAttemptRead {
  if (typeof window === "undefined") return { kind: "unavailable" };
  const pending = pendingCustomKeyOnboardingAttempt;
  if (pending?.attempt.documentId === getOnboardingDocumentId()) {
    if (pending.status === "resolving" || pending.status === "unavailable") {
      return { kind: "pending", pending };
    }
  }
  try {
    const value = window.sessionStorage.getItem(CUSTOM_KEY_ATTEMPT_STORAGE_KEY);
    if (!value) {
      if (
        pending?.attempt.documentId === getOnboardingDocumentId() &&
        pending.attempt.identityKey
      ) {
        return {
          kind: "available",
          attempt: pending.attempt as CustomKeyOnboardingAttempt,
        };
      }
      return { kind: "available", attempt: null };
    }
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") {
      return { kind: "unavailable" };
    }
    const attempt = parsed as Partial<CustomKeyOnboardingAttempt>;
    if (typeof attempt.id !== "string") return { kind: "unavailable" };
    if (attempt.documentId !== getOnboardingDocumentId()) {
      return { kind: "stale" };
    }
    if (typeof attempt.identityKey !== "string") {
      return { kind: "unavailable" };
    }
    if (
      pending?.attempt.id === attempt.id &&
      pending.attempt.documentId === attempt.documentId &&
      pending.attempt.identityKey
    ) {
      return {
        kind: "available",
        attempt: pending.attempt as CustomKeyOnboardingAttempt,
      };
    }
    return {
      kind: "available",
      attempt: attempt as CustomKeyOnboardingAttempt,
    };
  } catch {
    if (
      pending?.attempt.documentId === getOnboardingDocumentId() &&
      pending.attempt.identityKey
    ) {
      return {
        kind: "available",
        attempt: pending.attempt as CustomKeyOnboardingAttempt,
      };
    }
    return { kind: "unavailable" };
  }
}

function writePendingCustomKeyOnboardingAttempt(
  pending: PendingCustomKeyOnboardingAttempt,
  identityKey: string,
): "stored" | "unavailable" {
  pending.attempt.identityKey = identityKey;
  try {
    window.sessionStorage.setItem(
      CUSTOM_KEY_ATTEMPT_STORAGE_KEY,
      JSON.stringify(pending.attempt),
    );
    pending.status = "stored";
    return "stored";
  } catch {
    pending.status = "memory";
    return "unavailable";
  }
}

export function setCustomKeyOnboardingAttempt(
  id: string,
): Promise<"stored" | "no_session" | "unavailable"> {
  if (typeof window === "undefined") return Promise.resolve("unavailable");
  const sessionId = getAnalyticsSessionId();
  const pending: PendingCustomKeyOnboardingAttempt = {
    attempt: {
      id,
      documentId: getOnboardingDocumentId(),
      setupKind: "credential",
    },
    identityKeyAtStart: getAnalyticsIdentityKey(),
    status: "resolving",
    outcomes: [],
  };
  pendingCustomKeyOnboardingAttempt = pending;

  return resolveAnalyticsIdentityKey()
    .then((identityKey) => {
      if (!sessionId || !identityKey) {
        pending.status = "unavailable";
        flushPendingCustomKeyOnboardingOutcomes(pending);
        return "no_session" as const;
      }
      const result = writePendingCustomKeyOnboardingAttempt(
        pending,
        identityKey,
      );
      flushPendingCustomKeyOnboardingOutcomes(pending);
      return result;
    })
    .catch(() => {
      pending.status = "unavailable";
      flushPendingCustomKeyOnboardingOutcomes(pending);
      return "unavailable" as const;
    });
}

export function setCustomKeyOnboardingSetupKind(
  setupKind: CustomKeyOnboardingSetupKind,
): "stored" | "memory" | "missing" | "unavailable" {
  const pending = pendingCustomKeyOnboardingAttempt;
  if (pending && pending.attempt.documentId === getOnboardingDocumentId()) {
    pending.attempt.setupKind = setupKind;
    if (pending.status === "resolving") return "memory";
    if (pending.status === "unavailable") return "unavailable";
  }

  const stored = readCustomKeyOnboardingAttempt();
  if (stored.kind === "pending") {
    stored.pending.attempt.setupKind = setupKind;
    return stored.pending.status === "resolving" ? "memory" : "unavailable";
  }
  if (stored.kind !== "available" || !stored.attempt) {
    return stored.kind === "available" ? "missing" : "unavailable";
  }
  const attempt = { ...stored.attempt, setupKind };
  if (pending?.attempt.id === attempt.id) pending.attempt.setupKind = setupKind;
  try {
    window.sessionStorage.setItem(
      CUSTOM_KEY_ATTEMPT_STORAGE_KEY,
      JSON.stringify(attempt),
    );
    return "stored";
  } catch {
    return "unavailable";
  }
}

function trackUnavailableCustomKeyOnboardingOutcome(
  pending: PendingCustomKeyOnboardingAttempt,
  outcome: CustomKeyOnboardingOutcome,
): CustomKeyOutcomeResult {
  const identityKey = pending.attempt.identityKey ?? pending.identityKeyAtStart;
  if (identityKey !== getAnalyticsIdentityKey()) {
    if (pendingCustomKeyOnboardingAttempt === pending) {
      pendingCustomKeyOnboardingAttempt = null;
    }
    try {
      window.sessionStorage.removeItem(CUSTOM_KEY_ATTEMPT_STORAGE_KEY);
    } catch {
      return "unavailable";
    }
    return "identity_mismatch";
  }
  const attemptOutcomeKey = `${pending.attempt.id}:${outcome}`;
  if (locallyTrackedCustomKeyOutcomes.has(attemptOutcomeKey)) {
    return "duplicate";
  }
  trackOnboardingEvent("onboarding_method_outcome", {
    flow: "first_run",
    step_id: "choice",
    method_id: "custom_keys",
    onboarding_attempt_id: pending.attempt.id,
    outcome,
    correlation_status: "unavailable",
  });
  locallyTrackedCustomKeyOutcomes.add(attemptOutcomeKey);
  if (isTerminalCustomKeyOnboardingOutcome(outcome)) {
    if (pendingCustomKeyOnboardingAttempt === pending) {
      pendingCustomKeyOnboardingAttempt = null;
    }
  }
  return "tracked_uncorrelated";
}

export function trackCustomKeyOnboardingOutcome(
  outcome: CustomKeyOnboardingOutcome,
): CustomKeyOutcomeResult {
  const stored = readCustomKeyOnboardingAttempt();
  if (stored.kind === "unavailable") return "unavailable";
  if (stored.kind === "pending") {
    if (stored.pending.status === "resolving") {
      if (stored.pending.outcomes.includes(outcome)) return "duplicate";
      stored.pending.outcomes.push(outcome);
      return "pending";
    }
    return trackUnavailableCustomKeyOnboardingOutcome(stored.pending, outcome);
  }
  if (stored.kind === "stale") {
    // A duplicated tab can copy sessionStorage while the original attempt is live.
    try {
      window.sessionStorage.removeItem(CUSTOM_KEY_ATTEMPT_STORAGE_KEY);
    } catch {
      return "unavailable";
    }
    return "stale";
  }
  const { attempt } = stored;
  if (!attempt) return "missing";
  if (attempt.identityKey !== getAnalyticsIdentityKey()) {
    try {
      window.sessionStorage.removeItem(CUSTOM_KEY_ATTEMPT_STORAGE_KEY);
    } catch {
      if (pendingCustomKeyOnboardingAttempt?.attempt.id === attempt.id) {
        pendingCustomKeyOnboardingAttempt = null;
      }
      return "unavailable";
    }
    if (pendingCustomKeyOnboardingAttempt?.attempt.id === attempt.id) {
      pendingCustomKeyOnboardingAttempt = null;
    }
    return "identity_mismatch";
  }
  const attemptOutcomeKey = `${attempt.id}:${outcome}`;
  const alreadyTracked =
    (outcome === "credential_entry_started" && attempt.entryStarted) ||
    (outcome === "credential_validated" && attempt.credentialValidated);
  if (
    alreadyTracked ||
    locallyTrackedCustomKeyOutcomes.has(attemptOutcomeKey)
  ) {
    if (isTerminalCustomKeyOnboardingOutcome(outcome)) {
      try {
        window.sessionStorage.removeItem(CUSTOM_KEY_ATTEMPT_STORAGE_KEY);
      } catch {
        return "unavailable";
      }
    }
    return "duplicate";
  }

  trackOnboardingEvent("onboarding_method_outcome", {
    flow: "first_run",
    step_id: "choice",
    method_id: "custom_keys",
    onboarding_attempt_id: attempt.id,
    outcome,
  });

  locallyTrackedCustomKeyOutcomes.add(attemptOutcomeKey);
  if (
    outcome === "credential_entry_started" ||
    outcome === "credential_validated"
  ) {
    try {
      window.sessionStorage.setItem(
        CUSTOM_KEY_ATTEMPT_STORAGE_KEY,
        JSON.stringify({
          ...attempt,
          [outcome === "credential_entry_started"
            ? "entryStarted"
            : "credentialValidated"]: true,
        }),
      );
      if (pendingCustomKeyOnboardingAttempt?.attempt.id === attempt.id) {
        pendingCustomKeyOnboardingAttempt.attempt = {
          ...pendingCustomKeyOnboardingAttempt.attempt,
          ...attempt,
          [outcome === "credential_entry_started"
            ? "entryStarted"
            : "credentialValidated"]: true,
        };
      }
    } catch {
      if (pendingCustomKeyOnboardingAttempt?.attempt.id !== attempt.id) {
        return "tracked_storage_unavailable";
      }
      pendingCustomKeyOnboardingAttempt.status = "memory";
    }
  } else if (isTerminalCustomKeyOnboardingOutcome(outcome)) {
    try {
      window.sessionStorage.removeItem(CUSTOM_KEY_ATTEMPT_STORAGE_KEY);
    } catch {
      if (pendingCustomKeyOnboardingAttempt?.attempt.id !== attempt.id) {
        return "tracked_storage_unavailable";
      }
    }
    if (pendingCustomKeyOnboardingAttempt?.attempt.id === attempt.id) {
      pendingCustomKeyOnboardingAttempt = null;
    }
  }
  return "tracked";
}

function trackCustomKeyOnboardingOutcomeForAttempt(
  attemptId: string,
  outcome: CustomKeyOnboardingOutcome,
): CustomKeyOutcomeResult {
  const stored = readCustomKeyOnboardingAttempt();
  if (
    (stored.kind !== "available" && stored.kind !== "pending") ||
    (stored.kind === "available" && stored.attempt?.id !== attemptId) ||
    (stored.kind === "pending" && stored.pending.attempt.id !== attemptId) ||
    (stored.kind === "available" &&
      stored.attempt?.identityKey !== getAnalyticsIdentityKey()) ||
    (stored.kind === "pending" &&
      stored.pending.attempt.identityKey !== undefined &&
      stored.pending.attempt.identityKey !== getAnalyticsIdentityKey())
  ) {
    return "missing";
  }
  return trackCustomKeyOnboardingOutcome(outcome);
}

function beginCustomKeyOnboardingSave(
  saveOutcome: CustomKeyOnboardingSaveOutcome,
  abandonmentOutcome: CustomKeyOnboardingAbandonmentOutcome,
): {
  finish: (saved: boolean) => void;
} | null {
  const stored = readCustomKeyOnboardingAttempt();
  if (stored.kind === "available" && stored.attempt) {
    if (stored.attempt.identityKey !== getAnalyticsIdentityKey()) return null;
    return beginCustomKeyOnboardingSaveForAttempt(
      stored.attempt.id,
      saveOutcome,
      abandonmentOutcome,
    );
  }
  if (
    stored.kind === "pending" &&
    stored.pending.attempt.documentId === getOnboardingDocumentId() &&
    (stored.pending.attempt.identityKey === undefined ||
      stored.pending.attempt.identityKey === getAnalyticsIdentityKey())
  ) {
    return beginCustomKeyOnboardingSaveForAttempt(
      stored.pending.attempt.id,
      saveOutcome,
      abandonmentOutcome,
    );
  }
  return null;
}

function beginCustomKeyOnboardingSaveForAttempt(
  attemptId: string,
  saveOutcome: CustomKeyOnboardingSaveOutcome,
  abandonmentOutcome: CustomKeyOnboardingAbandonmentOutcome,
): { finish: (saved: boolean) => void } {
  const pending = pendingCustomKeyCredentialSaves.get(attemptId) ?? {
    count: 0,
    abandonmentRequested: false,
    saved: false,
    saveOutcome,
    abandonmentOutcome,
  };
  pending.count += 1;
  pendingCustomKeyCredentialSaves.set(attemptId, pending);

  let finished = false;
  return {
    finish(saved) {
      if (finished) return;
      finished = true;
      const current = pendingCustomKeyCredentialSaves.get(attemptId);
      if (!current) return;

      try {
        if (saved) {
          const result = trackCustomKeyOnboardingOutcomeForAttempt(
            attemptId,
            current.saveOutcome,
          );
          if (
            result === "tracked" ||
            result === "tracked_uncorrelated" ||
            result === "tracked_storage_unavailable" ||
            result === "duplicate"
          ) {
            current.saved = true;
          }
        }
      } finally {
        current.count -= 1;
        if (current.count === 0) {
          pendingCustomKeyCredentialSaves.delete(attemptId);
          if (current.abandonmentRequested && !current.saved) {
            trackCustomKeyOnboardingOutcomeForAttempt(
              attemptId,
              current.abandonmentOutcome,
            );
          }
        }
      }
    },
  };
}

export async function withCustomKeyOnboardingCredentialSave<T>(
  save: () => Promise<T>,
): Promise<T> {
  return withCustomKeyOnboardingSave(
    save,
    "credential_saved",
    "credential_abandoned",
  );
}

export async function withCustomKeyOnboardingLocalEndpointSave<T>(
  save: () => Promise<T>,
): Promise<T> {
  return withCustomKeyOnboardingSave(
    save,
    "local_endpoint_saved",
    "local_endpoint_abandoned",
  );
}

async function withCustomKeyOnboardingSave<T>(
  save: () => Promise<T>,
  saveOutcome: CustomKeyOnboardingSaveOutcome,
  abandonmentOutcome: CustomKeyOnboardingAbandonmentOutcome,
): Promise<T> {
  const credentialSave = beginCustomKeyOnboardingSave(
    saveOutcome,
    abandonmentOutcome,
  );
  let saved = false;
  try {
    const result = await save();
    saved = true;
    return result;
  } finally {
    credentialSave?.finish(saved);
  }
}

function handleCustomKeyOnboardingAbandonment(): void {
  const stored = readCustomKeyOnboardingAttempt();
  const attempt =
    stored.kind === "available"
      ? stored.attempt
      : stored.kind === "pending"
        ? stored.pending.attempt
        : null;
  if (
    attempt &&
    (attempt.identityKey === undefined ||
      attempt.identityKey === getAnalyticsIdentityKey())
  ) {
    const attemptId = attempt.id;
    const completedOutcome = (
      [
        "credential_saved",
        "credential_skipped",
        "credential_abandoned",
        "local_endpoint_saved",
        "local_endpoint_skipped",
        "local_endpoint_abandoned",
      ] as const
    ).find((outcome) =>
      locallyTrackedCustomKeyOutcomes.has(`${attemptId}:${outcome}`),
    );
    if (completedOutcome) {
      trackCustomKeyOnboardingOutcome(completedOutcome);
      return;
    }
    const pending = pendingCustomKeyCredentialSaves.get(attemptId);
    if (pending && pending.count > 0) {
      pending.abandonmentRequested = true;
      return;
    }
    trackCustomKeyOnboardingOutcome(
      attempt.setupKind === "local_endpoint"
        ? "local_endpoint_abandoned"
        : "credential_abandoned",
    );
    return;
  }
  trackCustomKeyOnboardingOutcome("credential_abandoned");
}

export function requestCustomKeyOnboardingAbandonment(): void {
  handleCustomKeyOnboardingAbandonment();
}

export function useCustomKeyOnboardingAttemptLifecycle(): void {
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    if (readCustomKeyOnboardingAttempt().kind === "stale") {
      trackCustomKeyOnboardingOutcome("credential_abandoned");
    }
    const handlePageHide = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        handleCustomKeyOnboardingAbandonment();
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      mountedRef.current = false;
      queueMicrotask(() => {
        if (!mountedRef.current) {
          handleCustomKeyOnboardingAbandonment();
        }
      });
    };
  }, []);
}

type SharedSummaryRead = {
  promise: Promise<OnboardingSummary>;
  settledAt: number | null;
};

const sharedSummaryReads = new Map<string, SharedSummaryRead>();

/**
 * The setup button, the checklist panel, and the first-run surface each mount
 * `useOnboarding`, and the summary is one of the most expensive startup reads.
 * Reads for the same URL share one request while it is in flight and for a
 * moment after it lands; `fresh` skips that reuse after this tab changed
 * onboarding state.
 */
function readOnboardingSummary(
  url: string,
  fresh: boolean,
): Promise<OnboardingSummary> {
  const shared = sharedSummaryReads.get(url);
  if (
    shared &&
    !fresh &&
    (shared.settledAt === null ||
      Date.now() - shared.settledAt < ONBOARDING_SUMMARY_REUSE_MS)
  ) {
    return shared.promise;
  }

  const controller =
    typeof AbortController === "undefined" ? null : new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller?.abort();
      reject(new Error("onboarding summary timed out"));
    }, ONBOARDING_SUMMARY_TIMEOUT_MS);
  });
  const request = (async () => {
    const response = await fetch(url, {
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response.ok) {
      throw new Error(`summary: ${response.status}`);
    }
    return (await response.json()) as OnboardingSummary;
  })();
  const read: SharedSummaryRead = {
    promise: Promise.race([request, timeout]).finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }),
    settledAt: null,
  };
  sharedSummaryReads.set(url, read);
  read.promise.then(
    () => {
      read.settledAt = Date.now();
    },
    () => {
      if (sharedSummaryReads.get(url) === read) sharedSummaryReads.delete(url);
    },
  );
  return read.promise;
}

export function __resetOnboardingSummaryReadsForTests(): void {
  sharedSummaryReads.clear();
}

export function __resetOnboardingEventDedupeForTests(): void {
  lastOnboardingStepViews.clear();
  seenOnboardingEvents.clear();
}

export function trackOnboardingEvent(
  name: string,
  properties: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  const identityKey = getAnalyticsIdentityKey() ?? "anonymous";
  const sessionId = getAnalyticsSessionId() ?? "unknown-session";
  const key = [
    sessionId,
    identityKey,
    name,
    properties.flow,
    properties.step_id,
    properties.extension_id,
    properties.integration_id,
    properties.role,
    properties.step_view_id,
    properties.onboarding_attempt_id,
  ]
    .map((value) => String(value ?? ""))
    .join(":");
  const stepViewScope = JSON.stringify([
    sessionId,
    identityKey,
    properties.flow,
  ]);
  const stepIdentity = JSON.stringify([
    properties.step_id,
    properties.extension_id,
  ]);
  const isRepeatableInteraction =
    name.startsWith("integration_") ||
    name === "onboarding_role_save_started" ||
    name === "onboarding_method_clicked" ||
    name === "onboarding_method_started" ||
    name === "onboarding_method_outcome" ||
    name === "onboarding_dismissed" ||
    name === "onboarding_reopened" ||
    name === "onboarding_abandoned";
  if (name === "onboarding_step_viewed") {
    if (
      typeof properties.step_view_id === "string" &&
      properties.step_view_id
    ) {
      if (seenOnboardingEvents.has(key)) return;
      seenOnboardingEvents.add(key);
    } else {
      if (lastOnboardingStepViews.get(stepViewScope) === stepIdentity) return;
      lastOnboardingStepViews.set(stepViewScope, stepIdentity);
    }
  } else if (name === "onboarding_reopened") {
    lastOnboardingStepViews.delete(stepViewScope);
  } else if (!isRepeatableInteraction) {
    if (seenOnboardingEvents.has(key)) return;
    seenOnboardingEvents.add(key);
  }
  trackEvent(name, properties);
}

export interface UseOnboardingResult {
  steps: OnboardingStepStatus[];
  profile: OnboardingAppProfile | null;
  loading: boolean;
  error: string | null;
  currentStepId: string | null;
  completeCount: number;
  totalCount: number;
  allComplete: boolean;
  dismissed: boolean;
  refresh: () => Promise<void>;
  complete: (id: string) => Promise<void>;
  dismiss: () => Promise<void>;
  reopen: () => Promise<void>;
  firstRun: boolean;
  completeFirstRun: () => Promise<void>;
  completeFirstRunError: string | null;
}

export function useOnboarding(
  options: {
    preview?: boolean;
    initialFirstRun?: boolean;
    /** The consumer renders first run itself when the server reports it. */
    firstRunSurface?: boolean;
  } = {},
): UseOnboardingResult {
  const preview = options.preview === true;
  const initialFirstRun = options.initialFirstRun === true;
  const firstRunSurface = options.firstRunSurface === true;
  const [steps, setSteps] = useState<OnboardingStepStatus[]>([]);
  const [profile, setProfile] = useState<OnboardingAppProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [firstRun, setFirstRun] = useState(preview || initialFirstRun);
  const [completeFirstRunError, setCompleteFirstRunError] = useState<
    string | null
  >(null);
  const stepsRef = useRef<OnboardingStepStatus[]>([]);
  const mountedRef = useRef(true);
  const fetchGenerationRef = useRef(0);

  useEffect(() => {
    setFirstRun(preview || initialFirstRun);
  }, [initialFirstRun, preview]);

  const fetchAll = useCallback(
    async (reuseSharedRead?: boolean) => {
      const fetchGeneration = ++fetchGenerationRef.current;
      try {
        const summaryUrl = agentNativePath(
          preview
            ? "/_agent-native/onboarding/summary?preview=1"
            : "/_agent-native/onboarding/summary",
        );
        const firstRunPromise = preview
          ? Promise.resolve(true).then((value) => {
              dispatchFirstRunOnboardingStatus(value);
              return value;
            })
          : initialFirstRun
            ? Promise.resolve(true)
            : fetchFirstRunOnboardingStatus();
        const [summary, firstRunRes] = await Promise.all([
          readOnboardingSummary(summaryUrl, reuseSharedRead !== true),
          firstRunPromise,
        ]);
        if (
          !mountedRef.current ||
          fetchGeneration !== fetchGenerationRef.current
        ) {
          return;
        }
        const previousSteps = stepsRef.current;
        if (previousSteps.length > 0) {
          for (const [stepIndex, step] of summary.steps.entries()) {
            const previousStep = previousSteps.find(
              (previous) => previous.id === step.id,
            );
            if (step.complete && !previousStep?.complete) {
              trackOnboardingEvent("onboarding_step_completed", {
                flow: "checklist",
                step_id: step.id,
                step_index: stepIndex,
              });
            }
          }
        }
        stepsRef.current = summary.steps;
        setSteps(summary.steps);

        setProfile(summary.profile);

        if (preview) {
          setFirstRun(true);
        } else if (!initialFirstRun) {
          setFirstRun(firstRunRes === true);
        }

        setDismissed(!!summary.dismissed);
        setError(null);
      } catch (e) {
        if (
          !mountedRef.current ||
          fetchGeneration !== fetchGenerationRef.current
        ) {
          return;
        }
        setError(e instanceof Error ? e.message : "Failed to load onboarding");
      } finally {
        if (
          mountedRef.current &&
          fetchGeneration === fetchGenerationRef.current
        ) {
          setLoading(false);
        }
      }
    },
    [preview],
  );

  // Setup hints wait until startup reads have had the server. A first-run
  // surface reads at paint whenever first run is possible; with the first-run
  // cookie absent the server always answers `firstRun: false`, so it waits too.
  const [firstRunCookieAbsent] = useState(
    () => readFirstRunOnboardingCookieState() === "absent",
  );
  const deferUntilStartup =
    !preview && !initialFirstRun && !(firstRunSurface && !firstRunCookieAbsent);

  useEffect(() => {
    mountedRef.current = true;
    let initialFetchRan = false;
    const schedule = deferUntilStartup
      ? scheduleAfterStartup
      : scheduleAfterPaint;
    const cancelInitialFetch = schedule(() => {
      initialFetchRan = true;
      if (mountedRef.current) void fetchAll(true);
    });
    const refetchOnFocus = () => {
      if (!initialFetchRan) {
        if (deferUntilStartup) return;
        initialFetchRan = true;
        cancelInitialFetch();
      }
      void fetchAll(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refetchOnFocus();
    };
    const onFocus = () => refetchOnFocus();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      mountedRef.current = false;
      fetchGenerationRef.current += 1;
      cancelInitialFetch();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [deferUntilStartup, fetchAll]);

  const complete = useCallback(
    async (id: string) => {
      const response = await fetch(
        agentNativePath(
          `/_agent-native/onboarding/steps/${encodeURIComponent(id)}/complete`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      if (!response.ok)
        throw new Error(`onboarding step failed: ${response.status}`);
      trackOnboardingEvent("onboarding_step_completed", {
        flow: "checklist",
        step_id: id,
      });
      await fetchAll();
    },
    [fetchAll],
  );

  const dismiss = useCallback(async () => {
    setDismissed(true);
    const currentStepIndex = steps.findIndex((step) => !step.complete);
    const currentStep = steps[currentStepIndex];
    trackOnboardingEvent("onboarding_dismissed", {
      flow: "checklist",
      ...(currentStepIndex >= 0
        ? {
            step_id: currentStep?.id,
            step_index: currentStepIndex,
          }
        : {}),
      reason: "user_action",
    });
    await fetch(agentNativePath("/_agent-native/onboarding/dismiss"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    await fetchAll();
  }, [fetchAll, steps]);

  const reopen = useCallback(async () => {
    setDismissed(false);
    trackOnboardingEvent("onboarding_reopened", {
      flow: "checklist",
      reason: "user_action",
    });
    await fetch(agentNativePath("/_agent-native/onboarding/reopen"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    await fetchAll();
  }, [fetchAll]);

  const completeFirstRun = useCallback(async () => {
    if (preview) {
      setFirstRun(false);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("agent-native:first-run-completed"),
        );
      }
      return;
    }
    setCompleteFirstRunError(null);
    let response: Response;
    try {
      response = await fetch(
        agentNativePath("/_agent-native/onboarding/first-run/complete"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "first-run completion request failed";
      trackEvent("onboarding_failed", {
        flow: "first_run",
        stage: "complete",
        reason: "network_error",
      });
      setCompleteFirstRunError(message);
      throw e instanceof Error ? e : new Error(message);
    }
    if (!response.ok) {
      const message = `first-run completion failed: ${response.status}`;
      trackEvent("onboarding_failed", {
        flow: "first_run",
        stage: "complete",
        reason: "http_error",
        status_code: response.status,
      });
      setCompleteFirstRunError(message);
      throw new Error(message);
    }
    trackOnboardingEvent("onboarding_completed", { flow: "first_run" });
    setFirstRun(false);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("agent-native:first-run-completed"));
    }
    await fetchAll();
  }, [fetchAll, preview]);

  const totalCount = steps.length;
  const completeCount = steps.filter((s) => s.complete).length;
  const allComplete = steps.filter((s) => s.required).every((s) => s.complete);

  const currentStepId =
    steps.find((s) => s.required && !s.complete)?.id ??
    steps.find((s) => !s.complete)?.id ??
    null;

  return {
    steps,
    profile,
    loading,
    error,
    currentStepId,
    completeCount,
    totalCount,
    allComplete,
    dismissed,
    refresh: fetchAll,
    complete,
    dismiss,
    reopen,
    firstRun,
    completeFirstRun,
    completeFirstRunError,
  };
}

export type { OnboardingMethod, OnboardingStepStatus };
