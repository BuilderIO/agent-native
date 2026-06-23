// Loom-style in-page overlay host. This content script is injected into every
// page (declared for <all_urls>) and is wrapped in an IIFE so it emits a single
// self-contained classic script with no module imports/exports and leaks no
// names into the shared global scope. Its only job is to mount/unmount the
// overlay iframes; all UI and control logic lives inside the extension-origin
// overlay pages (src/overlay.html). The background service worker is the source
// of truth for which "parts" are visible and pushes them here.

(function clipsOverlayHost() {
  type OverlayPart = "bubble" | "countdown" | "toolbar";

  const CONTAINER_ID = "clips-recorder-overlay-root";
  const ALL_PARTS: OverlayPart[] = ["bubble", "countdown", "toolbar"];
  const flags = window as unknown as { __clipsOverlayHostReady?: boolean };

  function requestState(): void {
    try {
      chrome.runtime.sendMessage(
        { type: "CLIPS_CONTENT_HELLO" },
        (response) => {
          if (chrome.runtime.lastError) return;
          const parts = (response as { parts?: unknown } | undefined)?.parts;
          reconcile(Array.isArray(parts) ? (parts as OverlayPart[]) : []);
        },
      );
    } catch {
      /* worker asleep; will resync on next message */
    }
  }

  // Only wake the service worker (via requestState) when a recording is actually
  // active. When idle this script does nothing but keep its message listener
  // registered, so a recording that starts later still reaches this tab via the
  // background's MOUNT broadcast.
  function syncIfRecording(): void {
    try {
      chrome.storage.local.get("clipsRecordingActive", (value) => {
        if (chrome.runtime.lastError) return;
        if (value && value.clipsRecordingActive) requestState();
      });
    } catch {
      /* ignore */
    }
  }

  function ensureContainer(): HTMLDivElement {
    let container = document.getElementById(
      CONTAINER_ID,
    ) as HTMLDivElement | null;
    if (container) return container;
    container = document.createElement("div");
    container.id = CONTAINER_ID;
    Object.assign(container.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483646",
      pointerEvents: "none",
      border: "none",
      margin: "0",
      padding: "0",
    });
    (document.documentElement || document.body).appendChild(container);
    return container;
  }

  function partFrameId(part: OverlayPart): string {
    return `${CONTAINER_ID}-${part}`;
  }

  function styleFrame(frame: HTMLIFrameElement, part: OverlayPart): void {
    Object.assign(frame.style, {
      position: "absolute",
      border: "none",
      background: "transparent",
      colorScheme: "normal",
      pointerEvents: "auto",
    });
    frame.setAttribute("allowtransparency", "true");
    if (part === "bubble") {
      frame.allow = "camera; microphone";
      Object.assign(frame.style, {
        left: "24px",
        bottom: "24px",
        width: "148px",
        height: "148px",
      });
    } else if (part === "toolbar") {
      Object.assign(frame.style, {
        left: "0",
        right: "0",
        bottom: "22px",
        marginInline: "auto",
        width: "420px",
        maxWidth: "100%",
        height: "64px",
      });
    } else {
      Object.assign(frame.style, {
        inset: "0",
        width: "100%",
        height: "100%",
      });
    }
  }

  function mountPart(container: HTMLDivElement, part: OverlayPart): void {
    if (document.getElementById(partFrameId(part))) return;
    const frame = document.createElement("iframe");
    frame.id = partFrameId(part);
    const url = new URL(chrome.runtime.getURL("src/overlay.html"));
    url.searchParams.set("part", part);
    if (part === "countdown") url.searchParams.set("seconds", "3");
    frame.src = url.toString();
    styleFrame(frame, part);
    container.appendChild(frame);
  }

  function reconcile(parts: OverlayPart[]): void {
    const wanted = new Set(parts.filter((p) => ALL_PARTS.includes(p)));
    if (wanted.size === 0) {
      document.getElementById(CONTAINER_ID)?.remove();
      return;
    }
    const container = ensureContainer();
    for (const part of ALL_PARTS) {
      const existing = document.getElementById(partFrameId(part));
      if (wanted.has(part)) {
        if (!existing) mountPart(container, part);
      } else if (existing) {
        existing.remove();
      }
    }
  }

  // Guard against rare double-injection (SPA soft-reloads re-running the script).
  if (flags.__clipsOverlayHostReady) {
    syncIfRecording();
    return;
  }
  flags.__clipsOverlayHostReady = true;

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return;
    const type = (message as { type?: unknown }).type;
    if (type === "CLIPS_OVERLAY_MOUNT") {
      const parts = (message as { parts?: unknown }).parts;
      reconcile(Array.isArray(parts) ? (parts as OverlayPart[]) : []);
    } else if (type === "CLIPS_OVERLAY_UNMOUNT") {
      reconcile([]);
    }
  });

  syncIfRecording();
})();
