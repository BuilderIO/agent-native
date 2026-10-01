/**
 * Deadlines for global setup.
 *
 * Playwright's `page.evaluate` has no timeout, and a `fetch` inside it waits on
 * whatever the host does. One host that accepts the connection and then goes
 * silent stalled a whole authenticated job until the 45-minute job timeout
 * killed it, which GitHub reports as "cancelled" with no test output at all. A
 * deadline turns that into a named, loud failure: which host, which step.
 */

export class SetupDeadlineError extends Error {
  constructor(
    readonly host: string,
    readonly step: string,
    readonly limitMs: number,
  ) {
    super(
      `${host}: setup exceeded its ${Math.round(limitMs / 1000)}s deadline while "${step}". The host accepted the work but never finished it.`,
    );
    this.name = "SetupDeadlineError";
  }
}

/** Reports and records the step a host's setup is currently in. */
export type SetupStep = (name: string) => void;

/**
 * Run one host's setup against a wall-clock deadline.
 *
 * The work itself cannot be cancelled (Playwright exposes no abort for
 * `evaluate`), so on expiry it is abandoned: the caller closes the browser,
 * which ends it. The abandoned promise's eventual rejection is swallowed only
 * after the deadline error has already been thrown to the caller.
 */
export async function withHostDeadline<T>(
  host: string,
  limitMs: number,
  run: (step: SetupStep) => Promise<T>,
  log: (line: string) => void = console.log,
): Promise<T> {
  let current = "starting";
  const step: SetupStep = (name) => {
    current = name;
    log(`[beta-e2e]   ${host}: ${name}…`);
  };

  const work = run(step);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new SetupDeadlineError(host, current, limitMs)),
      limitMs,
    );
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    // coercion-ok: if the deadline won, its error was thrown; the abandoned work must not surface as an unhandled rejection.
    work.catch(() => undefined);
  }
}

/**
 * Bound a single awaited call that has no timeout of its own, naming it in the
 * error so a hang inside it is attributable.
 */
export async function raceWithTimeout<T>(
  label: string,
  limitMs: number,
  work: Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `${label} did not finish within ${Math.round(limitMs / 1000)}s.`,
          ),
        ),
      limitMs,
    );
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    // coercion-ok: if the timeout won, its error was thrown; the abandoned call must not surface as an unhandled rejection.
    work.catch(() => undefined);
  }
}
