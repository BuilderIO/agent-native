import { AsyncLocalStorage } from "node:async_hooks";

import {
  createTripwireSink,
  type CredentialSource,
  type TripwireScope,
  type TripwireSink,
} from "../tripwire/index.js";

/**
 * What the code a workflow run calls can report to, without a signature that
 * carries it: the run's tripwire sink, and the providers whose credential
 * source the run has already reported (one `credential_source_used` per
 * provider per run). The host opens it around each guarded call, so an action
 * and the connector under it write to the run's own workflow.
 */
export interface RunObserver {
  readonly tripwire: TripwireSink;
  readonly credentialProviders: Set<string>;
}

const storage = new AsyncLocalStorage<RunObserver>();

export function createRunObserver(tripwire: TripwireSink): RunObserver {
  return { tripwire, credentialProviders: new Set() };
}

export function withRunObserver<T>(
  observer: RunObserver | undefined,
  work: () => T,
): T {
  return observer ? storage.run(observer, work) : work();
}

function currentRunObserver(): RunObserver | undefined {
  return storage.getStore();
}

/**
 * The sink an action records to: the run's when the host opened one, else one
 * bound to the factory, so an event is never lost to a missing context.
 */
export function actionTripwire(scope: TripwireScope): TripwireSink {
  return currentRunObserver()?.tripwire ?? createTripwireSink({ scope });
}

/** Reports where a provider's credential came from, the first time this run uses it. */
export function noteCredentialSource(input: {
  provider: string;
  source: CredentialSource;
  operationId?: string;
  details?: Readonly<Record<string, unknown>>;
  /** The run's observer, from code that runs outside the context the host opens. */
  observer?: RunObserver;
}): void {
  const observer = input.observer ?? currentRunObserver();
  if (!observer || observer.credentialProviders.has(input.provider)) return;
  observer.credentialProviders.add(input.provider);
  observer.tripwire({
    area: "credential",
    code: "credential_source_used",
    severity: "info",
    ...(input.operationId === undefined
      ? {}
      : { operationId: input.operationId }),
    details: {
      ...input.details,
      provider: input.provider,
      source: input.source,
    },
  });
}
