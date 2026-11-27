(function clipsPageTrackRelay() {
  const installedFlag = "__clipsPageTrackRelayInstalled";
  const PORT_NAME = "clips-page-track";
  const COMMAND_EVENT = "clips-page-track:command";
  const STATUS_EVENT = "clips-page-track:status";
  const EVENTS_EVENT = "clips-page-track:events";

  const toPage = (command: unknown): void => {
    window.dispatchEvent(
      new CustomEvent(COMMAND_EVENT, { detail: JSON.stringify(command) }),
    );
  };

  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope[installedFlag]) {
    toPage({ kind: "hello" });
    return;
  }
  scope[installedFlag] = true;

  let port: chrome.runtime.Port | null = null;

  const send = (message: unknown): void => {
    if (!port) return;
    try {
      port.postMessage(message);
    } catch (error) {
      console.warn("[clips-page-track] relay send failed", error);
      port = null;
      toPage({ kind: "stop" });
    }
  };

  const connect = (): void => {
    if (port) return;
    let opened: chrome.runtime.Port;
    try {
      opened = chrome.runtime.connect({ name: PORT_NAME });
    } catch (error) {
      console.warn("[clips-page-track] relay connect failed", error);
      return;
    }
    port = opened;
    opened.onMessage.addListener((message: unknown) => {
      if (message && typeof message === "object") toPage(message);
    });
    opened.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (port === opened) port = null;
      toPage({ kind: "stop" });
    });
  };

  window.addEventListener(STATUS_EVENT, (event) => {
    const detail: unknown = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== "string") return;
    let kind: unknown = null;
    try {
      kind = (JSON.parse(detail) as { kind?: unknown } | null)?.kind;
    } catch (error) {
      console.warn("[clips-page-track] unreadable status", error);
      return;
    }
    if (kind === "ready") connect();
    else if (kind === "stopped") send({ kind: "stopped" });
  });

  window.addEventListener(EVENTS_EVENT, (event) => {
    const detail: unknown = (event as CustomEvent<unknown>).detail;
    if (typeof detail === "string" && detail.length > 0) {
      send({ kind: "events", lines: detail });
    }
  });

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) toPage({ kind: "hello" });
  });

  toPage({ kind: "hello" });
})();
