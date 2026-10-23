import { useEffect, useRef } from "react";

export interface RecoveryAttempt {
  isActive(): boolean;
  assertActive(): void;
  step<T>(operation: () => Promise<T>): Promise<T>;
}

export class RecoveryAttemptEnded extends Error {
  constructor() {
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
 * confirms it, so its creation time is not known before then.
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
    creationPending ? undefined : (page.createdAt ?? null),
  ];
}

interface Epoch {
  readonly id: number;
  readonly resolved: (string | null | undefined)[];
  active: boolean;
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
  const current = useRef<Epoch>({
    id: 0,
    resolved: [...identity],
    active: true,
  });
  const epoch = current.current;
  // Invalidate during render: a late promise can resume before effect cleanup.
  // A new epoch never takes back an earlier one, so A, then B, then A again
  // leaves the first A's attempts ended.
  if (identityDiffers(epoch.resolved, identity)) {
    epoch.active = false;
    current.current = {
      id: epoch.id + 1,
      resolved: [...identity],
      active: true,
    };
  } else {
    identity.forEach((part, index) => {
      if (part !== undefined) epoch.resolved[index] = part;
    });
  }
  const epochId = current.current.id;
  useEffect(() => {
    // A Strict Mode remount resumes the identity its cleanup ended, under a
    // fresh epoch, so attempts begun before the cleanup stay ended.
    if (!current.current.active)
      current.current = {
        ...current.current,
        resolved: [...current.current.resolved],
        active: true,
      };
    const owned = current.current;
    return () => {
      owned.active = false;
    };
  }, [epochId]);
  const begin = () => {
    const epoch = current.current;
    const isActive = () => epoch.active && current.current === epoch;
    const assertActive = () => {
      if (!isActive()) throw new RecoveryAttemptEnded();
    };
    return {
      isActive,
      assertActive,
      async step<T>(operation: () => Promise<T>) {
        assertActive();
        const result = await operation();
        assertActive();
        return result;
      },
    } satisfies RecoveryAttempt;
  };
  // State tied to the owner resets with `epoch`, which moves only when the
  // identity really changes.
  return Object.assign(begin, { epoch: epochId });
}
