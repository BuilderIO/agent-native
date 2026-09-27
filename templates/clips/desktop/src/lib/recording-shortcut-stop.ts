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
  | { type: "direct"; reason: DirectStopReason };

async function stopDirectly(
  reason: DirectStopReason,
  stopDeadline: number,
): Promise<StopOutcome> {
  if (reason !== "pill-did-not-acknowledge") {
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

export async function requestRecordingShortcutStop(): Promise<StopOutcome> {
  const stopDeadline = Date.now() + STOP_FALLBACK_DEADLINE_MS;
  const acknowledgementDeadline = stopDeadline - DIRECT_STOP_WAIT_MS;
  if (!acknowledgementListenerReady) {
    if (!acknowledgementListenerSetup) {
      return stopDirectly(
        "acknowledgement-listener-not-registered",
        stopDeadline,
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
      );
    } finally {
      if (readinessTimeout) clearTimeout(readinessTimeout);
    }
    if (!listenerReady || !acknowledgementListenerReady) {
      return stopDirectly("acknowledgement-listener-not-ready", stopDeadline);
    }
  }

  const remainingMs = Math.max(0, acknowledgementDeadline - Date.now());
  if (remainingMs === 0) {
    return stopDirectly("pill-did-not-acknowledge", stopDeadline);
  }

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
    return stopDirectly("pill-did-not-acknowledge", stopDeadline);
  }
  return { type: "pill" };
}
