import {
  CAPTURE_STARTUP_BUDGET_MS,
  isCaptureReadyAccepted,
  isCaptureTerminal,
  type MotionCaptureSession,
} from "./motion-capture.js";

export interface OwnedCapture {
  recordingId: string;
  startedAtMs: number;
  startUncertaintyMs: number;
  observedFrameRate?: number | undefined;
  readMediaTime(): { mediaTimeMs: number; uncertaintyMs: number };
  stop(): Promise<void>;
  discard?(): Promise<void>;
}
export interface CaptureStartGate {
  confirmBegin(): Promise<void>;
}
export class CaptureTeardownUnconfirmedError extends Error {
  override name = "CaptureTeardownUnconfirmedError";
}
export class CaptureStartAbortedError extends Error {
  override name = "CaptureStartAbortedError";
}
class CaptureTransportError extends Error {
  override name = "CaptureTransportError";
}
interface Options {
  call<T>(action: string, args: Record<string, unknown>): Promise<T>;
  kind: "desktop" | "chrome-extension" | "browser";
  label: string;
  surface: string;
  start(
    session: MotionCaptureSession,
    signal: AbortSignal,
    gate: CaptureStartGate,
  ): Promise<OwnedCapture>;
  cancelStartup?(): Promise<void>;
  startupRecordingId?(): string | null | undefined;
  onError?(error: Error): void;
}
interface PollResult {
  session: MotionCaptureSession | null;
}
interface Report extends Record<string, unknown> {
  operation: "report";
  sessionId: string;
}
interface PendingReport {
  args: Report;
  attempts: number;
  refusals: number;
  retryAtMs: number;
}

type StartupEnd = "disarmed" | "budget" | "stop-requested" | "superseded";
const MAX_REFUSED_REPORTS = 3;
const POLL_INTERVAL_MS = 400;
const RETRY_MAX_MS = 5000;
const BEGIN_GATE_ATTEMPTS = 3;

function isTeardownUnconfirmed(cause: unknown): cause is Error {
  return (
    cause instanceof Error &&
    [
      "CaptureTeardownUnconfirmedError",
      "RecordingTeardownUnconfirmedError",
    ].includes(cause.name)
  );
}

function isTransportFailure(cause: unknown) {
  return (
    cause instanceof TypeError ||
    (cause instanceof Error &&
      ["CaptureTransportError", "AbortError", "TimeoutError"].includes(
        cause.name,
      ))
  );
}

const LOCAL_PATH =
  /(?:\/(?:Users|home|private|var|tmp|Volumes)\/|[A-Za-z]:\\)[^"'`:;()<>\n]*/g;

function failureMessage(cause: unknown, fallback: string) {
  const message = cause instanceof Error ? cause.message : cause;
  if (typeof message !== "string") return fallback;
  const reason = message
    .split("\u0000")
    .join("")
    .replace(LOCAL_PATH, "a local file")
    .slice(0, 500);
  return reason || fallback;
}

function reportedState(reply: unknown): string | null {
  if (!reply || typeof reply !== "object" || !("state" in reply)) return null;
  return typeof reply.state === "string" ? reply.state : null;
}

function isTerminalReport(item: PendingReport) {
  return (
    typeof item.args.state === "string" && isCaptureTerminal(item.args.state)
  );
}

function startupEndReport(
  sessionId: string,
  end: StartupEnd | null,
  recordingId?: string,
): Report {
  const discarded = recordingId ? "; the take was discarded" : "";
  const report = (state: "cancelled" | "failed", error: string): Report => ({
    operation: "report",
    sessionId,
    state,
    error,
    ...(recordingId ? { recordingId } : {}),
  });
  if (end === "stop-requested")
    return report(
      "cancelled",
      `Capture was stopped before the recorder was ready${discarded}.`,
    );
  if (end === "budget")
    return report(
      "failed",
      `Recorder did not become ready within the startup bound${discarded}.`,
    );
  if (end === "superseded")
    return report(
      "failed",
      `Capture session ended on the server before the recorder was ready${discarded}.`,
    );
  return report(
    "cancelled",
    `Capture was disarmed before the recorder was ready${discarded}.`,
  );
}

function waitOrAbort(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

export function createCaptureHostRunner(options: Options) {
  let credential: { id: string; secret: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let accepting = false;
  let startup: Promise<OwnedCapture> | null = null;
  let startupTask: Promise<void> | null = null;
  let startupSession: {
    id: string;
    controller: AbortController;
    end: StartupEnd | null;
    begun: boolean;
    readySeen: boolean;
  } | null = null;
  let teardownUnconfirmed: { sessionId: string; error: string } | null = null;
  let owned: {
    sessionId: string;
    capture: OwnedCapture;
    stopping: boolean;
  } | null = null;
  let pending: PendingReport[] = [];
  const attempted = new Set<string>();
  const stillAccepting = () => accepting;
  const hostArmed = () => credential !== null;
  const error = (value: unknown) => {
    options.onError?.(
      value instanceof Error ? value : new Error(String(value)),
    );
  };
  const enqueue = (args: Report) => {
    pending.push({ args, attempts: 0, refusals: 0, retryAtMs: 0 });
  };
  async function call<T>(
    action: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        options.call<T>(action, args),
        new Promise<T>((_resolve, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new CaptureTransportError(
                  "Capture transport timed out; the recording remains locally bounded.",
                ),
              ),
            5000,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  const send = <T>(args: Record<string, unknown>) => {
    if (!credential)
      return Promise.reject(new Error("Capture host is not armed."));
    return call<T>("capture-host", {
      hostId: credential.id,
      secret: credential.secret,
      ...args,
    });
  };
  const poll = () => {
    const head = pending.length > 0 ? pending[0] : undefined;
    return send<PollResult>(
      head && head.attempts > 0 && isTerminalReport(head)
        ? {
            operation: "poll",
            sessionId: head.args.sessionId,
            pendingOutcome: head.args.state,
          }
        : { operation: "poll" },
    );
  };
  let releasing: Promise<void> | null = null;
  function releaseHost(): Promise<void> {
    if (releasing) return releasing;
    if (!credential) return Promise.resolve();
    releasing = send({ operation: "release" })
      .then(() => {
        credential = null;
        pending = [];
      })
      .finally(() => {
        releasing = null;
      });
    return releasing;
  }
  let flushing: Promise<void> | null = null;
  function flush(now = false): Promise<void> {
    if (flushing) return flushing;
    flushing = (async () => {
      while (pending.length > 0) {
        for (const item of [...pending]) {
          if (!now && item.retryAtMs > Date.now()) return;
          try {
            await send(item.args);
          } catch (cause) {
            item.attempts += 1;
            if (!isTransportFailure(cause)) item.refusals += 1;
            item.retryAtMs =
              Date.now() +
              Math.min(
                RETRY_MAX_MS,
                POLL_INTERVAL_MS * 2 ** (item.attempts - 1),
              );
            throw cause;
          }
          const index = pending.indexOf(item);
          if (index >= 0) pending.splice(index, 1);
        }
      }
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  }
  function settlePending(active: MotionCaptureSession | null) {
    pending = pending.filter((item) => {
      if (
        !active ||
        item.args.sessionId !== active.id ||
        isCaptureTerminal(active.state)
      )
        return false;
      if (isTerminalReport(item) || item.refusals < MAX_REFUSED_REPORTS)
        return true;
      error(
        new Error(
          `Capture server refused ${String(item.args.state ?? item.args.operation)} ${item.refusals} times; dropped it.`,
        ),
      );
      return false;
    });
  }
  async function deliverAll() {
    if (!hostArmed()) {
      pending = [];
      return;
    }
    for (let round = 0; ; round += 1) {
      try {
        await flush(true);
        return;
      } catch (cause) {
        settlePending((await poll()).session);
        if (pending.length === 0) return;
        if (round + 1 >= MAX_REFUSED_REPORTS) throw cause;
      }
    }
  }
  let stopping: Promise<void> | null = null;
  function stopOwned(): Promise<void> {
    if (stopping) return stopping;
    const current = owned;
    if (!current) return Promise.resolve();
    stopping = stopCurrent(current).finally(() => {
      stopping = null;
    });
    return stopping;
  }
  async function stopCurrent(current: NonNullable<typeof owned>) {
    let teardownConfirmed = true;
    current.stopping = true;
    if (deadline) clearTimeout(deadline);
    enqueue({
      operation: "report",
      sessionId: current.sessionId,
      state: "finalizing",
    });
    await flush().catch(() => undefined);
    try {
      await current.capture.stop();
      enqueue({
        operation: "report",
        sessionId: current.sessionId,
        state: "complete",
      });
    } catch (cause) {
      if (isTeardownUnconfirmed(cause)) {
        teardownConfirmed = false;
        current.stopping = false;
        accepting = false;
        throw cause;
      }
      enqueue({
        operation: "report",
        sessionId: current.sessionId,
        state: "failed",
        error: failureMessage(cause, "Recorder stop failed."),
      });
      error(cause);
    } finally {
      if (teardownConfirmed && owned === current) owned = null;
    }
    await flush().catch(() => undefined);
  }
  function endStartup(end: StartupEnd) {
    if (!startupSession) return;
    startupSession.end ??= end;
    startupSession.controller.abort();
  }
  async function confirmBegin(current: NonNullable<typeof startupSession>) {
    const { signal } = current.controller;
    const stopped = () => signal.aborted;
    const aborted = () =>
      new CaptureStartAbortedError(
        "Capture was stopped before the recorder began.",
      );
    if (stopped()) throw aborted();
    if (current.begun) return;
    for (let attempt = 1; ; attempt += 1) {
      let reply: unknown;
      try {
        reply = await send<unknown>({
          operation: "report",
          sessionId: current.id,
          state: "beginning",
        });
      } catch (cause) {
        if (stopped()) throw aborted();
        if (attempt >= BEGIN_GATE_ATTEMPTS)
          throw new CaptureStartAbortedError(
            `The server did not confirm the recorder could begin: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        await waitOrAbort(POLL_INTERVAL_MS, signal);
        continue;
      }
      const state = reportedState(reply);
      if (state === "beginning") break;
      endStartup(state === "stop-requested" ? "stop-requested" : "superseded");
      throw aborted();
    }
    if (stopped()) throw aborted();
    current.begun = true;
  }
  async function confirmReady(
    current: NonNullable<typeof startupSession>,
    capture: OwnedCapture,
  ) {
    const { signal } = current.controller;
    for (;;) {
      if (current.readySeen) return true;
      if (signal.aborted) return false;
      try {
        const reply = await send<unknown>({
          operation: "report",
          sessionId: current.id,
          state: "recording",
          recordingId: capture.recordingId,
          startedAtMs: capture.startedAtMs,
          startUncertaintyMs: capture.startUncertaintyMs,
          observedFrameRate: capture.observedFrameRate,
        });
        if (isCaptureReadyAccepted(reply as Partial<MotionCaptureSession>))
          return true;
        const state = reportedState(reply);
        if (state === "stop-requested") endStartup("stop-requested");
        else if (state && isCaptureTerminal(state)) endStartup("superseded");
      } catch (cause) {
        error(cause);
      }
      await waitOrAbort(POLL_INTERVAL_MS, signal);
    }
  }
  async function discardCapture(
    current: NonNullable<typeof startupSession>,
    capture: OwnedCapture,
    gateFailure: Error | null,
  ) {
    try {
      await (capture.discard ? capture.discard() : capture.stop());
    } catch (cause) {
      throw new CaptureTeardownUnconfirmedError(
        `Recorder discard is unconfirmed: ${String(cause)}`,
      );
    }
    enqueue(
      current.end || !gateFailure
        ? startupEndReport(current.id, current.end, capture.recordingId)
        : {
            operation: "report",
            sessionId: current.id,
            state: "failed",
            recordingId: capture.recordingId,
            error: `${gateFailure.message.slice(0, 450)}; the take was discarded.`,
          },
    );
    if (current.end !== "stop-requested" && current.end !== "superseded")
      accepting = false;
  }
  async function runStartup(session: MotionCaptureSession) {
    const current = {
      id: session.id,
      controller: new AbortController(),
      end: null as StartupEnd | null,
      begun: false,
      readySeen: false,
    };
    startupSession = current;
    const startupTimer = setTimeout(
      () => endStartup("budget"),
      CAPTURE_STARTUP_BUDGET_MS,
    );
    try {
      let capture: OwnedCapture;
      try {
        if (!stillAccepting()) endStartup("disarmed");
        startup = current.controller.signal.aborted
          ? Promise.reject(
              new CaptureStartAbortedError("Capture startup was cancelled."),
            )
          : options.start(session, current.controller.signal, {
              confirmBegin: () => confirmBegin(current),
            });
        capture = await startup;
      } catch (cause) {
        if (isTeardownUnconfirmed(cause)) throw cause;
        const startupRecordingId = options.startupRecordingId?.() ?? undefined;
        if (current.end === "stop-requested" || current.end === "superseded") {
          enqueue(
            startupEndReport(session.id, current.end, startupRecordingId),
          );
          return;
        }
        accepting = false;
        enqueue(
          current.end
            ? startupEndReport(session.id, current.end, startupRecordingId)
            : {
                operation: "report",
                sessionId: session.id,
                state: "failed",
                error: failureMessage(cause, "Recorder start failed."),
              },
        );
        if (!(cause instanceof CaptureStartAbortedError) || !current.end)
          error(cause);
        return;
      }
      deadline = setTimeout(
        () => {
          if (owned?.capture === capture) void stopOwned().catch(error);
          else endStartup("budget");
        },
        Math.max(
          0,
          session.maxDurationMs - capture.readMediaTime().mediaTimeMs,
        ),
      );
      let ready = false;
      let gateFailure: CaptureStartAbortedError | null = null;
      try {
        if (!current.begun) await confirmBegin(current);
        ready = await confirmReady(current, capture);
      } catch (cause) {
        if (!(cause instanceof CaptureStartAbortedError)) throw cause;
        gateFailure = cause;
      }
      if (!ready) {
        clearTimeout(deadline);
        await discardCapture(current, capture, gateFailure);
        return;
      }
      owned = { sessionId: session.id, capture, stopping: false };
      if (!stillAccepting()) await stopOwned();
    } catch (cause) {
      if (isTeardownUnconfirmed(cause)) {
        accepting = false;
        teardownUnconfirmed = { sessionId: session.id, error: cause.message };
        error(cause);
        return;
      }
      accepting = false;
      enqueue({
        operation: "report",
        sessionId: session.id,
        state: "failed",
        error: failureMessage(cause, "Recorder start failed."),
      });
      error(cause);
    } finally {
      clearTimeout(startupTimer);
      startup = null;
      if (startupSession === current) startupSession = null;
    }
  }
  function beginStartup(session: MotionCaptureSession) {
    startupTask = runStartup(session)
      .then(async () => {
        await flush().catch(() => undefined);
        if (stillAccepting() || owned || teardownUnconfirmed || !hostArmed())
          return;
        await deliverAll();
        await releaseHost();
      })
      .catch(error)
      .finally(() => {
        startupTask = null;
      });
  }
  function hasTerminalReport(sessionId: string) {
    return pending.some(
      (item) => item.args.sessionId === sessionId && isTerminalReport(item),
    );
  }
  async function tick() {
    if (!credential || !accepting || running) return;
    running = true;
    try {
      await flush().catch(() => undefined);
      const result = await poll();
      const session = result.session;
      settlePending(session);
      if (startupSession) {
        if (
          !session ||
          session.id !== startupSession.id ||
          isCaptureTerminal(session.state)
        )
          endStartup("superseded");
        else if (isCaptureReadyAccepted(session))
          startupSession.readySeen = true;
        else if (session.state === "stop-requested")
          endStartup("stop-requested");
      } else if (owned && session?.id === owned.sessionId) {
        if (session.state === "stop-requested" && !owned.stopping)
          void stopOwned().catch(error);
      } else if (
        stillAccepting() &&
        session &&
        (session.state === "queued" || session.state === "starting") &&
        !attempted.has(session.id)
      ) {
        const reply = await send<unknown>({
          operation: "report",
          sessionId: session.id,
          state: "starting",
        });
        attempted.add(session.id);
        const state = reportedState(reply);
        if (state === "stop-requested")
          enqueue(startupEndReport(session.id, "stop-requested"));
        else if (!state || !isCaptureTerminal(state)) beginStartup(session);
      } else if (
        session?.state === "stop-requested" &&
        !hasTerminalReport(session.id) &&
        !isCaptureReadyAccepted(session) &&
        !attempted.has(session.id)
      ) {
        enqueue(startupEndReport(session.id, "stop-requested"));
      } else if (
        session &&
        !owned &&
        !attempted.has(session.id) &&
        ["starting", "beginning", "recording", "finalizing"].includes(
          session.state,
        )
      ) {
        error(
          new Error(
            "Recorder session recovery required; this host does not own the live capture.",
          ),
        );
      }
      await flush().catch(() => undefined);
      if (!stillAccepting() && !owned && !startupTask && hostArmed()) {
        await deliverAll();
        await releaseHost();
      }
    } catch (cause) {
      error(cause);
    } finally {
      running = false;
      if (hostArmed() && stillAccepting())
        timer = setTimeout(() => {
          void tick();
        }, POLL_INTERVAL_MS);
    }
  }
  async function settleHeldSession() {
    const { session } = await poll();
    settlePending(session);
    if (
      !session ||
      isCaptureTerminal(session.state) ||
      owned?.sessionId === session.id ||
      hasTerminalReport(session.id)
    )
      return;
    if (isCaptureReadyAccepted(session) || session.state === "finalizing")
      throw new Error(
        "Recorder session recovery required; this host does not own the live capture.",
      );
    enqueue(startupEndReport(session.id, "disarmed"));
  }
  const api = {
    async arm() {
      if (credential) {
        if (!accepting)
          throw new Error(
            "Previous host release is incomplete; retry disarm first.",
          );
        return credential.id;
      }
      credential = await call<{ id: string; secret: string }>("capture-host", {
        operation: "register",
        kind: options.kind,
        label: options.label,
        surface: options.surface,
      });
      accepting = true;
      void tick();
      return credential.id;
    },
    async disarm() {
      accepting = false;
      if (timer) clearTimeout(timer);
      endStartup("disarmed");
      if (startup) {
        let cancelWait: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            startup.catch(() => undefined),
            new Promise<never>((_resolve, reject) => {
              cancelWait = setTimeout(
                () =>
                  reject(
                    new Error(
                      "Recorder teardown is unconfirmed. The host has stopped accepting commands; retry disarm after recovery.",
                    ),
                  ),
                5000,
              );
            }),
          ]);
        } finally {
          if (cancelWait) clearTimeout(cancelWait);
        }
      }
      if (startupTask) await startupTask;
      await stopOwned();
      if (stopping) await stopping;
      if (teardownUnconfirmed) {
        if (!options.cancelStartup)
          throw new CaptureTeardownUnconfirmedError(teardownUnconfirmed.error);
        await options.cancelStartup();
        enqueue({
          operation: "report",
          sessionId: teardownUnconfirmed.sessionId,
          state: "failed",
          error:
            "Capture startup failed; recorder teardown was confirmed on retry.",
        });
        teardownUnconfirmed = null;
      }
      if (hostArmed()) await settleHeldSession();
      await deliverAll();
      await releaseHost();
      if (timer) clearTimeout(timer);
      if (deadline) clearTimeout(deadline);
    },
    async abandon(reason: string) {
      const current = owned;
      if (deadline) clearTimeout(deadline);
      owned = null;
      if (current)
        enqueue({
          operation: "report",
          sessionId: current.sessionId,
          state: "failed",
          error: reason.slice(0, 500),
        });
      await flush(true);
    },
    async stop(): Promise<void> {
      if (startupSession) await api.disarm();
      else await stopOwned();
    },
  };
  return api;
}
