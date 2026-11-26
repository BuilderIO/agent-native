import {
  signDurableTurnGrant,
  verifyDurableTurnGrant,
  type DurableTurnGrantClaim,
} from "../integrations/internal-token.js";
import type { ProviderTurnGrant } from "../provider-api/interactive-scope.js";
import type { AgentTurnInitiator } from "./run-store.js";

/**
 * Where the background worker leaves the turn grant it verified from the
 * dispatch payload, for `runWithAgentRunContext` to scope the run with.
 */
export const VERIFIED_TURN_GRANT_CONTEXT_KEY = "__agentNativeVerifiedTurnGrant";

/** A claim plus its signature, as carried in a durable dispatch payload. */
export type SignedDurableTurnGrant = DurableTurnGrantClaim & {
  signature: string;
};

function claimFor(
  runId: string,
  turnId: string,
  initiator: Omit<AgentTurnInitiator, "anonymous">,
  expiresAt: number,
): DurableTurnGrantClaim {
  return {
    runId,
    turnId,
    initiator: {
      email: initiator.email,
      authUserId: initiator.authUserId ?? null,
      orgId: initiator.orgId ?? null,
      orgScope: initiator.orgScope ?? null,
    },
    expiresAt,
  };
}

function signed(claim: DurableTurnGrantClaim): SignedDurableTurnGrant {
  return { ...claim, signature: signDurableTurnGrant(claim) };
}

/**
 * The grant a foreground handler hands the durable run it dispatches, or
 * undefined. Only a fresh turn its signed-in owner is driving interactively
 * gets one; a continuation, recovery or anonymous turn never does.
 */
export function mintDurableTurnGrant(input: {
  runId: string;
  turnId: string;
  initiator: AgentTurnInitiator | undefined;
  interactive: boolean;
  continuation: boolean;
  lifetimeMs: number;
  now?: number;
}): SignedDurableTurnGrant | undefined {
  const { initiator } = input;
  if (!initiator || initiator.anonymous || !input.interactive) return undefined;
  if (input.continuation) return undefined;
  return signed(
    claimFor(
      input.runId,
      input.turnId,
      initiator,
      (input.now ?? Date.now()) + input.lifetimeMs,
    ),
  );
}

/**
 * The same turn's grant for the run a server-driven continuation chains to.
 * Only a run that verified its own grant passes one on, keeping its turn,
 * initiator and expiry; anything else returns undefined, so a stale or
 * forged grant never reaches the next run.
 */
export function reissueDurableTurnGrant(input: {
  verified: ProviderTurnGrant | undefined;
  initiator: AgentTurnInitiator | undefined;
  turnId: string;
  nextRunId: string;
  now?: number;
}): SignedDurableTurnGrant | undefined {
  const { verified, initiator } = input;
  if (!verified || !initiator || initiator.anonymous) return undefined;
  if (verified.turnId !== input.turnId) return undefined;
  if (
    verified.owner.trim().toLowerCase() !== initiator.email.trim().toLowerCase()
  )
    return undefined;
  if (verified.expiresAt <= (input.now ?? Date.now())) return undefined;
  return signed(
    claimFor(input.nextRunId, input.turnId, initiator, verified.expiresAt),
  );
}

export interface DurableTurnGrantStore {
  getRunTurnRef(
    runId: string,
  ): Promise<{ threadId: string; turnId: string } | null>;
  getTurnInitiatorByRun(runId: string): Promise<AgentTurnInitiator | null>;
  isTurnAborted(threadId: string, turnId: string): Promise<boolean>;
}

/**
 * The grant a durable dispatch carried, checked against the run's persisted
 * turn and initiator. Null when the payload has none or it no longer holds:
 * another run, turn or person, a bad signature, expired, or an aborted turn.
 */
export async function verifyDispatchedTurnGrant(
  candidate: unknown,
  runId: string,
  store: DurableTurnGrantStore,
  now: number = Date.now(),
): Promise<ProviderTurnGrant | null> {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    return null;
  const grant = candidate as Record<string, unknown>;
  const expiresAt = grant.expiresAt;
  if (
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now
  )
    return null;
  if (grant.runId !== runId) return null;
  const [turn, initiator] = await Promise.all([
    store.getRunTurnRef(runId),
    store.getTurnInitiatorByRun(runId),
  ]);
  if (!turn || !initiator || initiator.anonymous) return null;
  if (grant.turnId !== turn.turnId) return null;
  if (
    !verifyDurableTurnGrant(
      claimFor(runId, turn.turnId, initiator, expiresAt),
      grant.signature,
    )
  )
    return null;
  if (await store.isTurnAborted(turn.threadId, turn.turnId)) return null;
  return { runId, turnId: turn.turnId, owner: initiator.email, expiresAt };
}
