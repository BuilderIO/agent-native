type ActionFailureShape = {
  action?: unknown;
  status?: unknown;
  errorCode?: unknown;
};

export function isTransientCatalogAvailability(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const failure = error as ActionFailureShape;
  return (
    failure.action === "get-data-browser-catalog" &&
    failure.status === 403 &&
    failure.errorCode === "data_connection_unavailable"
  );
}

export async function waitForCatalogReady(options: {
  read: () => Promise<string>;
  isTransient: (error: unknown) => boolean;
  timeoutMs: number;
  intervalsMs: number[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ attempts: number; transientFailures: number }> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  const deadline = now() + options.timeoutMs;
  let attempts = 0;
  let transientFailures = 0;
  let lastState = "unread";
  let lastFailure: unknown;
  for (;;) {
    attempts++;
    try {
      lastState = await options.read();
      lastFailure = undefined;
      if (lastState === "ready") return { attempts, transientFailures };
    } catch (error) {
      if (!options.isTransient(error)) throw error;
      transientFailures++;
      lastFailure = error;
    }
    const wait =
      options.intervalsMs[
        Math.min(attempts - 1, options.intervalsMs.length - 1)
      ] ?? 1000;
    if (now() + wait > deadline) break;
    await sleep(wait);
  }
  const last =
    lastFailure instanceof Error
      ? `last failure ${lastFailure.message}`
      : `last state ${lastState}`;
  throw new Error(
    `Catalog was not ready within ${options.timeoutMs}ms after ${attempts} attempts (${transientFailures} transient); ${last}`,
    lastFailure === undefined ? undefined : { cause: lastFailure },
  );
}
