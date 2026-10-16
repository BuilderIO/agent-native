import { useCallback, useEffect, useRef, useState } from "react";

import { useOrg } from "../org/hooks.js";
import { extractShareErrorMessage } from "./share-controller-helpers.js";
import type { ShareVisibility } from "./useShareDialogController.js";

/**
 * Whether moving to `to` shows more of the resource to more people than `from`
 * does and so needs an explicit confirmation. Public -> organization narrows
 * access and Public stays confirmation-free, so only private -> organization
 * asks.
 */
export function visibilityNeedsConfirmation(
  from: ShareVisibility,
  to: ShareVisibility,
): boolean {
  return from === "private" && to === "org";
}

/**
 * Why a requested visibility change was never saved: `ignored` when the
 * request was refused up front (closed surface, no manage rights, a save
 * already running) and `dropped` when it was held for confirmation and then
 * cancelled or invalidated.
 */
export class ShareVisibilityNotSavedError extends Error {
  readonly reason: "ignored" | "dropped";

  constructor(reason: "ignored" | "dropped") {
    super(
      reason === "dropped"
        ? "The visibility change was not confirmed."
        : "The visibility change was not applied.",
    );
    this.name = "ShareVisibilityNotSavedError";
    this.reason = reason;
  }
}

function notSaved(reason: "ignored" | "dropped"): Promise<void> {
  const rejected = Promise.reject<void>(
    new ShareVisibilityNotSavedError(reason),
  );
  // Callers that fire and forget must not raise an unhandled rejection; one
  // that awaits the returned promise still sees it.
  rejected.catch(() => undefined);
  return rejected;
}

export interface ShareVisibilityTransitionOptions {
  resourceType: string;
  resourceId: string;
  /** The visibility shown right now, including an in-flight optimistic one. */
  current: ShareVisibility;
  /** The organization the resource belongs to, from the share listing. */
  orgId: string | null;
  canManage: boolean;
  /** False while the share surface is closed; a pending request is dropped. */
  active: boolean;
  /** Saves the visibility. Rejects on failure so the caller can show it. */
  apply: (next: ShareVisibility) => Promise<void>;
  /**
   * Receives a failure of a change that needed no confirmation. Required so a
   * failed save is never left looking like a successful one.
   */
  onDirectError: (error: unknown) => void;
}

export interface ShareVisibilityTransitionRequest {
  from: ShareVisibility;
  to: ShareVisibility;
}

export interface ShareVisibilityTransition {
  /** The change waiting for confirmation, or null. Nothing is saved yet. */
  pending: ShareVisibilityTransitionRequest | null;
  /**
   * The resource's organization name, only when it was read for that exact
   * organization. Null means "say your organization" instead of a name.
   */
  organizationName: string | null;
  submitting: boolean;
  /** Why the last confirmation failed; the request stays pending to retry. */
  error: string | null;
  /**
   * Saves `next` at once, or holds it for confirmation when it broadens.
   * The promise resolves only once the change is persisted. A change that
   * needs no confirmation rejects with the save's failure. A held change that
   * fails when confirmed keeps its `error` and stays pending so the user can
   * retry, and its promise stays pending too: it resolves after a successful
   * retry and rejects with `ShareVisibilityNotSavedError` once the change is
   * cancelled or invalidated (resource change, closed surface, lost manage
   * rights). A request that is refused up front rejects the same way.
   */
  request: (next: ShareVisibility) => Promise<void>;
  confirm: () => Promise<void>;
  cancel: () => void;
}

interface PendingState extends ShareVisibilityTransitionRequest {
  resourceKey: string;
  settle: { resolve: () => void; reject: (reason: unknown) => void };
}

export function useShareVisibilityTransition(
  options: ShareVisibilityTransitionOptions,
): ShareVisibilityTransition {
  const { resourceType, resourceId, current, canManage, active } = options;
  const resourceKey = `${resourceType}:${resourceId}`;
  const [pending, setPendingState] = useState<PendingState | null>(null);
  const [submitting, setSubmittingState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<PendingState | null>(null);
  const submittingRef = useRef(false);
  // Bumped whenever the pending request is dropped, so a save that finishes
  // afterwards cannot touch the next request's state.
  const generationRef = useRef(0);
  // The newest save still running. A request for the value that save is
  // already writing joins it instead of reporting that value as persisted.
  const inflightRef = useRef<{
    resourceKey: string;
    target: ShareVisibility;
    promise: Promise<void>;
  } | null>(null);
  const latestRef = useRef({ ...options, resourceKey });
  latestRef.current = { ...options, resourceKey };

  const org = useOrg({ enabled: active && canManage });
  const organizationName = readOrganizationName(org.data, options.orgId);

  const reset = useCallback(() => {
    generationRef.current += 1;
    // A save that is already running settles the request itself.
    if (!submittingRef.current) {
      pendingRef.current?.settle.reject(
        new ShareVisibilityNotSavedError("dropped"),
      );
    }
    pendingRef.current = null;
    submittingRef.current = false;
    setPendingState(null);
    setSubmittingState(false);
    setError(null);
  }, []);

  useEffect(() => reset, [reset]);
  useEffect(() => {
    reset();
  }, [reset, resourceKey]);
  useEffect(() => {
    if (!active || !canManage) reset();
  }, [active, canManage, reset]);
  // The saved value moved under the dialog (another tab, a refetch), so the
  // change it describes is no longer the one it would make. While a save is
  // running `current` is the optimistic value, which is expected to differ.
  useEffect(() => {
    if (pending && !submitting && pending.from !== current) reset();
  }, [current, pending, reset, submitting]);

  const track = useCallback(
    (key: string, target: ShareVisibility, promise: Promise<void>) => {
      const entry = { resourceKey: key, target, promise };
      inflightRef.current = entry;
      const clear = () => {
        if (inflightRef.current === entry) inflightRef.current = null;
      };
      promise.then(clear, clear);
    },
    [],
  );

  const request = useCallback(
    (next: ShareVisibility): Promise<void> => {
      const latest = latestRef.current;
      if (next === latest.current) {
        const inflight = inflightRef.current;
        return inflight &&
          inflight.resourceKey === latest.resourceKey &&
          inflight.target === next
          ? inflight.promise
          : Promise.resolve();
      }
      if (!latest.canManage || !latest.active || submittingRef.current) {
        return notSaved("ignored");
      }
      if (!visibilityNeedsConfirmation(latest.current, next)) {
        reset();
        const generation = generationRef.current;
        const saved = latest.apply(next);
        track(latest.resourceKey, next, saved);
        saved.catch((failure) => {
          // Only the newest intent on this resource reports to the shared
          // error state. An older failure, or one from a resource the surface
          // has left, still rejects for its caller but must not show here.
          // The generation moves in an effect, so the resource is also checked
          // against the live value.
          if (
            generation === generationRef.current &&
            latestRef.current.resourceKey === latest.resourceKey
          ) {
            latest.onDirectError(failure);
          }
        });
        return saved;
      }
      // A held request replaces any earlier one, which is dropped.
      reset();
      const held = new Promise<void>((resolve, reject) => {
        const state: PendingState = {
          from: latest.current,
          to: next,
          resourceKey: latest.resourceKey,
          settle: { resolve, reject },
        };
        pendingRef.current = state;
        setPendingState(state);
        setError(null);
      });
      held.catch(() => undefined);
      return held;
    },
    [reset, track],
  );

  const confirm = useCallback(async () => {
    const state = pendingRef.current;
    if (!state || submittingRef.current) return;
    const latest = latestRef.current;
    // The effects that drop a stale request run after render; a click can
    // land before them, so the request is checked against the live values.
    if (
      state.resourceKey !== latest.resourceKey ||
      !latest.canManage ||
      !latest.active ||
      state.from !== latest.current
    ) {
      reset();
      return;
    }
    const generation = generationRef.current;
    submittingRef.current = true;
    setSubmittingState(true);
    setError(null);
    try {
      const applying = latest.apply(state.to);
      track(state.resourceKey, state.to, applying);
      await applying;
      state.settle.resolve();
      if (generation !== generationRef.current) return;
      pendingRef.current = null;
      setPendingState(null);
    } catch (failure) {
      if (generation !== generationRef.current) {
        state.settle.reject(failure);
        return;
      }
      setError(extractShareErrorMessage(failure));
    } finally {
      if (generation === generationRef.current) {
        submittingRef.current = false;
        setSubmittingState(false);
      }
    }
  }, [reset, track]);

  const cancel = useCallback(() => {
    if (submittingRef.current) return;
    reset();
  }, [reset]);

  return {
    pending: pending ? { from: pending.from, to: pending.to } : null,
    organizationName,
    submitting,
    error,
    request,
    confirm,
    cancel,
  };
}

function readOrganizationName(
  org:
    | {
        orgId?: string | null;
        orgName?: string | null;
        orgs?: Array<{ orgId: string; orgName: string }>;
      }
    | undefined,
  resourceOrgId: string | null,
): string | null {
  if (!org || !resourceOrgId) return null;
  const name =
    org.orgId === resourceOrgId
      ? org.orgName
      : org.orgs?.find((summary) => summary.orgId === resourceOrgId)?.orgName;
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed || null;
}
