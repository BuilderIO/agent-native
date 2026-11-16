import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

const STOP_FALLBACK_DEADLINE_MS = 300;
const ACK_LISTENER_READY_TIMEOUT_MS = 150;
const DIRECT_STOP_REQUEST_TIMEOUT_MS = 20;
const DIRECT_STOP_HOLD_TIMEOUT_MS = 50;
const DIRECT_STOP_WAIT_MS =
  DIRECT_STOP_REQUEST_TIMEOUT_MS + DIRECT_STOP_HOLD_TIMEOUT_MS;
const pendingStops = new Map<string, (handled: boolean) => void>();
let acknowledgementListenerCount = 0;
let acknowledgementListenerReady = false;
let acknowledgementListenerSetup: Promise<void> | undefined;

type DirectStopReason =
  | "acknowledgement-listener-not-registered"
  | "acknowledgement-listener-registration-failed"
  | "acknowledgement-listener-not-ready"
  | "pill-did-not-acknowledge";

type StopOutcome =
  | { type: "pill" }
  | { type: "direct"; reason: DirectStopReason }
  /** The recording it was for has ended: nothing was sent. */
  | { type: "stale" };

/** Whether the recording a stop is for is still the one running. */
type StillCurrent = () => Promise<boolean>;

const STALE: StopOutcome = { type: "stale" };

async function stopDirectly(
  reason: DirectStopReason,
  stopDeadline: number,
  stillCurrent?: StillCurrent,
): Promise<StopOutcome> {
  if (stillCurrent && !(await stillCurrent())) return STALE;
  const pillRequest = emit("clips:tray-stop-request", {
    fallback: true,
  }).then(
    () => undefined,
    (error) => {
      console.error("[clips-tray] fallback pill stop request failed:", error);
    },
  );
  const requestWaitMs = Math.min(
    DIRECT_STOP_REQUEST_TIMEOUT_MS,
    Math.max(0, stopDeadline - Date.now()),
  );
  if (requestWaitMs > 0) {
    let requestTimeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      pillRequest,
      new Promise<void>((resolve) => {
        requestTimeout = setTimeout(resolve, requestWaitMs);
      }),
    ]);
    if (requestTimeout) clearTimeout(requestTimeout);
  }

  const holdAttempt = invoke("set_toolbar_finishing", { hold: true }).then(
    () => true,
    (error) => {
      console.error("[clips-tray] finishing hold failed:", error);
      return false;
    },
  );
  const holdWaitMs = Math.min(
    DIRECT_STOP_HOLD_TIMEOUT_MS,
    Math.max(0, stopDeadline - Date.now()),
  );
  let holdSet = false;
  if (holdWaitMs > 0) {
    let holdTimeout: ReturnType<typeof setTimeout> | undefined;
    holdSet = await Promise.race([
      holdAttempt,
      new Promise<boolean>((resolve) => {
        holdTimeout = setTimeout(() => resolve(false), holdWaitMs);
      }),
    ]);
    if (holdTimeout) clearTimeout(holdTimeout);
  }
  if (!holdSet) {
    console.warn(
      "[clips-tray] stopping directly without a confirmed finishing hold",
    );
    void invoke("show_popover").catch((error) => {
      console.error("[clips-tray] completion card recovery failed:", error);
    });
  }

  if (stillCurrent && !(await stillCurrent())) return STALE;
  await emit("clips:recorder-stop");
  return { type: "direct", reason };
}

export function listenForRecordingShortcutStopAcks() {
  const registration = listen<string>("clips:tray-stop-ack", (event) => {
    pendingStops.get(event.payload)?.(true);
  }).then((unlisten) => {
    acknowledgementListenerCount += 1;
    acknowledgementListenerReady = acknowledgementListenerCount > 0;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      acknowledgementListenerCount -= 1;
      acknowledgementListenerReady = acknowledgementListenerCount > 0;
      if (
        !acknowledgementListenerReady &&
        acknowledgementListenerSetup === readiness
      ) {
        acknowledgementListenerSetup = undefined;
      }
      unlisten();
      if (!acknowledgementListenerReady) {
        for (const finish of pendingStops.values()) finish(false);
      }
    };
  });
  const readiness = registration.then(() => undefined);
  void readiness.catch(() => {});
  acknowledgementListenerSetup = readiness;
  return registration;
}

/**
 * `stillCurrent` (a stop link) is checked right before each stop event goes
 * out, so a stop still in flight when its recording ends and another starts
 * sends nothing.
 */
export async function requestRecordingShortcutStop(
  stillCurrent?: StillCurrent,
): Promise<StopOutcome> {
  const stopDeadline = Date.now() + STOP_FALLBACK_DEADLINE_MS;
  const acknowledgementDeadline = stopDeadline - DIRECT_STOP_WAIT_MS;
  if (!acknowledgementListenerReady) {
    if (!acknowledgementListenerSetup) {
      return stopDirectly(
        "acknowledgement-listener-not-registered",
        stopDeadline,
        stillCurrent,
      );
    }
    let readinessTimeout: ReturnType<typeof setTimeout> | undefined;
    let listenerReady = false;
    try {
      listenerReady = await Promise.race([
        acknowledgementListenerSetup.then(() => true),
        new Promise<boolean>((resolve) => {
          readinessTimeout = setTimeout(
            () => resolve(false),
            Math.min(
              ACK_LISTENER_READY_TIMEOUT_MS,
              Math.max(0, acknowledgementDeadline - Date.now()),
            ),
          );
        }),
      ]);
    } catch (error) {
      console.error(
        "[clips-tray] stop acknowledgement listener failed:",
        error,
      );
      return stopDirectly(
        "acknowledgement-listener-registration-failed",
        stopDeadline,
        stillCurrent,
      );
    } finally {
      if (readinessTimeout) clearTimeout(readinessTimeout);
    }
    if (!listenerReady || !acknowledgementListenerReady) {
      return stopDirectly(
        "acknowledgement-listener-not-ready",
        stopDeadline,
        stillCurrent,
      );
    }
  }

  const remainingMs = Math.max(0, acknowledgementDeadline - Date.now());
  if (remainingMs === 0) {
    return stopDirectly("pill-did-not-acknowledge", stopDeadline, stillCurrent);
  }

  if (stillCurrent && !(await stillCurrent())) return STALE;
  const requestId = crypto.randomUUID();
  const pillHandledRequest = new Promise<boolean>((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (handled: boolean) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      pendingStops.delete(requestId);
      resolve(handled);
    };

    timeout = setTimeout(() => finish(false), remainingMs);
    pendingStops.set(requestId, finish);
    void emit("clips:tray-stop-request", { requestId }).catch((error) => {
      console.error("[clips-tray] stop request event failed:", error);
      finish(false);
    });
  });

  if (!(await pillHandledRequest)) {
    return stopDirectly("pill-did-not-acknowledge", stopDeadline, stillCurrent);
  }
  return { type: "pill" };
}

/**
 * `clips://stop`. With a recorder running it goes through the recording
 * bar like the recording shortcut, so a bar whose listener isn't up yet
 * (it never acknowledges) still ends in a direct stop; without one it
 * stops directly.
 */
export async function stopRecordingFromLink(
  recorderRunning: boolean,
  recording: number,
): Promise<StopOutcome | undefined> {
  // Native confirms the link's recording is still the one running before
  // each stop event, so a link can't stop a recording started after it.
  // An IPC failure rejects, so the caller logs it, rather than reading as a
  // recording that ended.
  const stillCurrent = () =>
    invoke<boolean>("stop_link_recording_current", { recording });
  if (recorderRunning) return requestRecordingShortcutStop(stillCurrent);
  if (!(await stillCurrent())) return STALE;
  await emit("clips:recorder-stop");
  return undefined;
}

/**
 * Listens for `clips://stop`. Native keeps the stop until it's taken
 * (`take_pending_stop_link`), so one sent before this listener was up is
 * taken as soon as it is; each stop is taken once, by the event or that
 * startup check.
 */
export function listenForStopLinks(onStop: (recording: number) => void) {
  const takePending = () =>
    invoke<number | null>("take_pending_stop_link").then(
      (recording) => {
        if (recording !== null) onStop(recording);
      },
      (error) => {
        console.error("[clips-tray] taking the stop link failed:", error);
      },
    );
  return listen("clips:stop-link", () => {
    void takePending();
  }).then((unlisten) => {
    void takePending();
    return unlisten;
  });
}
