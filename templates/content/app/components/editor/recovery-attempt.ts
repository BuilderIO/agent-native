import { useEffect, useRef } from "react";

export interface RecoveryAttempt {
  isActive(): boolean;
  assertActive(): void;
  step<T>(operation: () => Promise<T>): Promise<T>;
}

/**
 * The attempt's owner ended. `answer` is how the step's own operation
 * settled, or null when the operation never ran, so a caller can hand on what
 * the server actually answered instead of guessing at it.
 */
export class RecoveryAttemptEnded extends Error {
  constructor(readonly answer: PromiseSettledResult<unknown> | null = null) {
    super("The recovery attempt's original scope ended.");
    this.name = "RecoveryAttemptEnded";
  }
}

/**
 * What a recovery attempt belongs to, one part per facet: account, org, page
 * and the page's incarnation. `undefined` is a facet not known yet, as before
 * the session read returns; `null` is a facet known to be absent.
 */
export type RecoveryIdentity = readonly (string | null | undefined)[];

/**
 * A page's recovery owner. A page created later under a deleted page's id
 * renders without a remount, so only its creation time ends the old page's
 * recovery work. An optimistic page shows the client's clock until the server
 * confirms it, and a page read without its creation time has not shown it
 * yet, so neither is known then.
 */
export function pageRecoveryIdentity(
  session: { email?: string | null; orgId?: string | null } | null | undefined,
  page: { id: string; createdAt?: string | null },
  creationPending: boolean,
): RecoveryIdentity {
  return [
    session?.email ? session.email.trim().toLowerCase() : undefined,
    session?.email ? (session.orgId ?? null) : undefined,
    page.id,
    creationPending ? undefined : page.createdAt,
  ];
}

interface Epoch {
  readonly id: number;
  readonly resolved: (string | null | undefined)[];
  active: boolean;
  // A facet is not known right now, so the owner may yet turn out to be
  // another one. Steps wait here instead of acting for it.
  unresolved: boolean;
  readonly waiting: Set<() => void>;
}

function createEpoch(id: number, identity: RecoveryIdentity): Epoch {
  return {
    id,
    resolved: [...identity],
    active: true,
    unresolved: identity.includes(undefined),
    waiting: new Set(),
  };
}

function wake(epoch: Epoch) {
  const waiting = [...epoch.waiting];
  epoch.waiting.clear();
  for (const resume of waiting) resume();
}

function end(epoch: Epoch) {
  epoch.active = false;
  wake(epoch);
}

// A facet that becomes known, or is briefly unknown again, is the same owner;
// only a facet resolved to a value other than the one it had is a new owner.
function identityDiffers(
  resolved: readonly (string | null | undefined)[],
  identity: RecoveryIdentity,
) {
  return identity.some(
    (part, index) =>
      part !== undefined &&
      resolved[index] !== undefined &&
      resolved[index] !== part,
  );
}

export function useRecoveryAttemptOwner(identity: RecoveryIdentity) {
  const unresolved = identity.includes(undefined);
  const current = useRef<Epoch>(createEpoch(0, identity));
  const epoch = current.current;
  // Invalidate during render: a late promise can resume before effect cleanup.
  // A new epoch never takes back an earlier one, so A, then B, then A again
  // leaves the first A's attempts ended.
  if (identityDiffers(epoch.resolved, identity)) {
    end(epoch);
    current.current = createEpoch(epoch.id + 1, identity);
  } else {
    identity.forEach((part, index) => {
      if (part !== undefined) epoch.resolved[index] = part;
    });
    // Held as soon as a render shows a facet unknown, but released only after
    // a render that knows them all commits; a render React drops must not let
    // a step act for an owner no committed render showed.
    if (unresolved) epoch.unresolved = true;
  }
  const epochId = current.current.id;
  useEffect(() => {
    // A Strict Mode remount resumes the identity its cleanup ended, under a
    // fresh epoch, so attempts begun before the cleanup stay ended.
    if (!current.current.active)
      current.current = {
        ...createEpoch(current.current.id, current.current.resolved),
        unresolved: current.current.unresolved,
      };
    const owned = current.current;
    return () => end(owned);
  }, [epochId]);
  useEffect(() => {
    const committed = current.current;
    committed.unresolved = unresolved;
    if (!unresolved) wake(committed);
  });
  const begin = () => {
    const epoch = current.current;
    const isActive = () => epoch.active && current.current === epoch;
    const assertActive = () => {
      if (!isActive()) throw new RecoveryAttemptEnded();
    };
    // Nothing while the step may go on; a wait while a facet is unknown.
    const hold = (answer: PromiseSettledResult<unknown> | null) => {
      if (!isActive())
        throw answer?.status === "rejected" &&
          answer.reason instanceof RecoveryAttemptEnded
          ? answer.reason
          : new RecoveryAttemptEnded(answer);
      if (!epoch.unresolved) return null;
      return new Promise<void>((resume) => epoch.waiting.add(resume));
    };
    return {
      isActive,
      assertActive,
      // Both before the operation and once it settles, the step waits while
      // the owner is not known and ends if it turned out to be another one.
      async step<T>(operation: () => Promise<T>) {
        for (let wait = hold(null); wait; wait = hold(null)) await wait;
        let answer: PromiseSettledResult<T>;
        try {
          answer = { status: "fulfilled", value: await operation() };
        } catch (reason) {
          answer = { status: "rejected", reason };
        }
        for (let wait = hold(answer); wait; wait = hold(answer)) await wait;
        if (answer.status === "rejected") throw answer.reason;
        return answer.value;
      },
    } satisfies RecoveryAttempt;
  };
  // State tied to the owner resets with `epoch`, which moves only when the
  // identity really changes.
  return Object.assign(begin, { epoch: epochId });
}
