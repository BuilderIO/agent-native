// Loom-style in-page overlay host. The background service worker injects this
// into the LAUNCH TAB on demand via chrome.scripting.executeScript (covered by
// the activeTab permission the user grants when they click the extension), NOT
// declaratively on every page — that would need broad "<all_urls>" host access
// and Chrome's in-depth review. So the overlay lives on the tab the recording
// was started from; it does not follow across tabs unless CROSS_TAB_FOLLOW is
// re-enabled in background.ts (see PERMISSIONS.md). Wrapped in an IIFE so it
// emits a single self-contained classic script with no module imports/exports
// and leaks no names into the shared global scope. Its only job is to
// mount/unmount the overlay iframes; all UI and control logic lives inside the
// extension-origin overlay pages (src/overlay.html). The worker is the source of
// truth for which "parts" are visible and pushes them here.

(function clipsOverlayHost() {
  type OverlayPart = "bubble" | "countdown" | "toolbar" | "saving";

  const CONTAINER_ID = "clips-recorder-overlay-root";
  const ALL_PARTS: OverlayPart[] = ["bubble", "countdown", "toolbar", "saving"];
  const flags = window as unknown as { __clipsOverlayHostReady?: boolean };

  function errorPayload(error: unknown): {
    name: string;
    message: string;
    stack?: string;
  } {
    if (error instanceof Error) {
      return {
        name: error.name || "Error",
        message: error.message || "Unknown content-script error",
        stack: error.stack,
      };
    }
    return {
      name: "Error",
      message: String(error ?? "Unknown content-script error"),
    };
  }

  function reportContentScriptError(
    error: unknown,
    context: Record<string, unknown> = {},
  ): void {
    try {
      chrome.runtime.sendMessage(
        {
          type: "CLIPS_EXTENSION_ERROR",
          surface: "content-script",
          ...errorPayload(error),
          context: {
            ...context,
            pageUrl: location.href,
          },
        },
        () => void chrome.runtime.lastError,
      );
    } catch {
      /* background unavailable */
    }
  }

  window.addEventListener("error", (event) => {
    reportContentScriptError(event.error || event.message, {
      mechanism: "global-error",
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportContentScriptError(event.reason, {
      mechanism: "unhandled-rejection",
    });
  });

  // ----- Draggable, resizable camera bubble ---------------------------------
  // Size + position persist in storage so the bubble stays where the user put it
  // across pages and recordings (like the desktop app). The iframe can't move or
  // resize itself, so the content script owns its geometry.
  const BUBBLE_SIZES: Record<string, number> = { sm: 184, lg: 280 };
  const bubbleGeom: { size: string; left: number | null; top: number | null } =
    { size: "lg", left: null, top: null };
  let bubbleDragLayer: HTMLDivElement | null = null;
  let bubblePersistTimer: ReturnType<typeof setTimeout> | undefined;

  function bubbleSizePx(): number {
    return BUBBLE_SIZES[bubbleGeom.size] ?? BUBBLE_SIZES.lg;
  }

  function clampBubble(
    left: number,
    top: number,
    size: number,
  ): { left: number; top: number } {
    return {
      left: Math.max(8, Math.min(left, window.innerWidth - size - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - size - 8)),
    };
  }

  function applyBubbleGeom(): void {
    const frame = document.getElementById(
      partFrameId("bubble"),
    ) as HTMLIFrameElement | null;
    if (!frame) return;
    const size = bubbleSizePx();
    const margin = 24;
    const base = clampBubble(
      bubbleGeom.left ?? margin,
      bubbleGeom.top ?? window.innerHeight - size - margin,
      size,
    );
    Object.assign(frame.style, {
      left: `${base.left}px`,
      top: `${base.top}px`,
      bottom: "auto",
      width: `${size}px`,
      height: `${size}px`,
    });
  }

  function persistBubbleGeom(): void {
    clearTimeout(bubblePersistTimer);
    bubblePersistTimer = setTimeout(() => {
      try {
        chrome.storage.local.set({ bubbleGeom });
      } catch {
        /* ignore */
      }
    }, 200);
  }

  function startBubbleDrag(): void {
    if (bubbleDragLayer) return;
    const frame = document.getElementById(
      partFrameId("bubble"),
    ) as HTMLIFrameElement | null;
    if (!frame) return;
    // Full-screen capture layer so the pointer keeps tracking after it leaves
    // the small bubble iframe.
    const layer = document.createElement("div");
    Object.assign(layer.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      cursor: "grabbing",
    });
    (document.documentElement || document.body).appendChild(layer);
    bubbleDragLayer = layer;
    const onMove = (e: PointerEvent): void => {
      const size = bubbleSizePx();
      const rect = frame.getBoundingClientRect();
      const next = clampBubble(
        rect.left + e.movementX,
        rect.top + e.movementY,
        size,
      );
      bubbleGeom.left = next.left;
      bubbleGeom.top = next.top;
      Object.assign(frame.style, {
        left: `${next.left}px`,
        top: `${next.top}px`,
        bottom: "auto",
      });
    };
    const onUp = (): void => {
      layer.removeEventListener("pointermove", onMove);
      layer.removeEventListener("pointerup", onUp);
      layer.removeEventListener("pointercancel", onUp);
      layer.remove();
      bubbleDragLayer = null;
      persistBubbleGeom();
    };
    layer.addEventListener("pointermove", onMove);
    layer.addEventListener("pointerup", onUp);
    layer.addEventListener("pointercancel", onUp);
  }

  try {
    chrome.storage.local.get("bubbleGeom", (value) => {
      if (chrome.runtime.lastError) return;
      const g = value.bubbleGeom as
        | { size?: unknown; left?: unknown; top?: unknown }
        | undefined;
      if (g && typeof g === "object") {
        bubbleGeom.size = g.size === "sm" ? "sm" : "lg";
        bubbleGeom.left = typeof g.left === "number" ? g.left : null;
        bubbleGeom.top = typeof g.top === "number" ? g.top : null;
      }
      applyBubbleGeom();
    });
  } catch {
    /* ignore */
  }

  window.addEventListener("resize", () => applyBubbleGeom());

  function readCurrentParts(
    callback: (parts: OverlayPart[] | null) => void,
  ): void {
    try {
      chrome.runtime.sendMessage(
        { type: "CLIPS_CONTENT_HELLO" },
        (response) => {
          if (chrome.runtime.lastError) {
            callback(null);
            return;
          }
          const parts = (response as { parts?: unknown } | undefined)?.parts;
          callback(Array.isArray(parts) ? (parts as OverlayPart[]) : []);
        },
      );
    } catch {
      callback(null);
    }
  }

  function requestState(): void {
    readCurrentParts((parts) => {
      if (parts) reconcile(parts);
      /* worker asleep; will resync on next message */
    });
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
      colorScheme: "dark",
      pointerEvents: "auto",
    });
    frame.setAttribute("allowtransparency", "true");
    if (part === "bubble") {
      frame.allow = "camera; microphone";
      // Above the countdown so the face stays sharp over the dim/blur. Exact
      // size/position are set by applyBubbleGeom() once mounted.
      const size = bubbleSizePx();
      Object.assign(frame.style, {
        left: "24px",
        bottom: "24px",
        width: `${size}px`,
        height: `${size}px`,
        // Clip the IFRAME itself to a circle so the iframe's opaque canvas (which
        // a declared color-scheme always paints, dark or white) can never show as
        // a square box around the bubble.
        borderRadius: "50%",
        overflow: "hidden",
        zIndex: "3",
      });
    } else if (part === "toolbar") {
      // Left-edge vertical pill (desktop layout). Height grows on hover via the
      // resize message below. Clipped to the pill's radius (the pill fills the
      // iframe) so the opaque canvas can't show as a box; shadow on the iframe so
      // the clip doesn't cut it.
      Object.assign(frame.style, {
        left: "16px",
        top: "calc(50% - 77px)",
        width: "68px",
        height: "154px",
        borderRadius: "20px",
        overflow: "hidden",
        boxShadow: "0 10px 28px rgba(9, 9, 11, 0.45)",
        zIndex: "2",
      });
    } else if (part === "saving") {
      // Compact card: caption + a single indeterminate bar (no circular spinner).
      // Clipped to the card radius (card fills the iframe) so no canvas box shows.
      Object.assign(frame.style, {
        left: "24px",
        bottom: "24px",
        width: "240px",
        height: "64px",
        borderRadius: "14px",
        overflow: "hidden",
        boxShadow: "0 10px 28px rgba(9, 9, 11, 0.45)",
        zIndex: "2",
      });
    } else {
      // countdown — full-screen dim/blur, below the bubble.
      Object.assign(frame.style, {
        inset: "0",
        width: "100%",
        height: "100%",
        zIndex: "1",
      });
    }
  }

  function mountPart(container: HTMLDivElement, part: OverlayPart): void {
    if (document.getElementById(partFrameId(part))) return;
    const frame = document.createElement("iframe");
    frame.id = partFrameId(part);
    if (part === "bubble") frame.allow = "camera; microphone";
    const url = new URL(chrome.runtime.getURL("src/overlay.html"));
    url.searchParams.set("part", part);
    if (part === "countdown") url.searchParams.set("seconds", "3");
    frame.src = url.toString();
    styleFrame(frame, part);
    container.appendChild(frame);
    if (part === "bubble") applyBubbleGeom();
  }

  // Camera-ready gating + connecting spinner: while the camera connects we show a
  // simple centered spinner and keep the bubble hidden, then reveal the bubble and
  // start the countdown once the feed is live — so the "3" never hangs and there's
  // no half-loaded, un-draggable bubble during the wait. The bubble posts
  // "camera-ready" when its video plays (or fails); a fallback timer proceeds
  // anyway if the camera never connects.
  const CONNECTING_ID = `${CONTAINER_ID}-connecting`;
  let cameraReady = false;
  let countdownDeferred = false;
  let countdownFallbackTimer: ReturnType<typeof setTimeout> | undefined;

  function showConnecting(container: HTMLDivElement): void {
    if (document.getElementById(CONNECTING_ID)) return;
    const wrap = document.createElement("div");
    wrap.id = CONNECTING_ID;
    Object.assign(wrap.style, {
      position: "absolute",
      inset: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      pointerEvents: "none",
      zIndex: "4",
    });
    const chip = document.createElement("div");
    Object.assign(chip.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "84px",
      height: "84px",
      borderRadius: "20px",
      background: "rgba(24, 24, 27, 0.92)",
      boxShadow: "0 10px 28px rgba(9, 9, 11, 0.45)",
    });
    const spinner = document.createElement("div");
    Object.assign(spinner.style, {
      width: "40px",
      height: "40px",
      borderRadius: "50%",
      border: "4px solid rgba(255, 255, 255, 0.18)",
      borderTopColor: "rgba(255, 255, 255, 0.92)",
    });
    chip.appendChild(spinner);
    wrap.appendChild(chip);
    container.appendChild(wrap);
    try {
      spinner.animate(
        [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
        { duration: 800, iterations: Infinity },
      );
    } catch {
      /* Web Animations unavailable — a static ring is fine */
    }
  }

  function hideConnecting(): void {
    document.getElementById(CONNECTING_ID)?.remove();
  }

  function setBubbleHidden(hidden: boolean): void {
    const frame = document.getElementById(partFrameId("bubble"));
    if (frame) (frame as HTMLElement).style.visibility = hidden ? "hidden" : "";
  }

  function mountDeferredCountdown(): void {
    countdownDeferred = false;
    clearTimeout(countdownFallbackTimer);
    readCurrentParts((parts) => {
      if (!parts?.includes("countdown")) {
        hideConnecting();
        setBubbleHidden(false);
        if (parts) reconcile(parts);
        return;
      }

      hideConnecting();
      setBubbleHidden(false);
      const container = document.getElementById(
        CONTAINER_ID,
      ) as HTMLDivElement | null;
      if (container && !document.getElementById(partFrameId("countdown"))) {
        mountPart(container, "countdown");
      }
    });
  }

  function reconcile(parts: OverlayPart[]): void {
    console.log("[clips-cs] reconcile parts:", parts, "on", location.href);
    const wanted = new Set(parts.filter((p) => ALL_PARTS.includes(p)));
    // Leaving the countdown phase (recording / saving / idle): cancel any pending
    // deferred countdown + spinner so a late fallback timer can't pop the "3-2-1"
    // back up over a later overlay (this was the "countdown over the saving card"
    // bug).
    if (!wanted.has("countdown")) {
      countdownDeferred = false;
      clearTimeout(countdownFallbackTimer);
      hideConnecting();
    }
    if (wanted.size === 0) {
      document.getElementById(CONTAINER_ID)?.remove();
      cameraReady = false;
      return;
    }
    const container = ensureContainer();
    const gateCountdown =
      wanted.has("countdown") && wanted.has("bubble") && !cameraReady;
    for (const part of ALL_PARTS) {
      const existing = document.getElementById(partFrameId(part));
      if (wanted.has(part)) {
        // Hold the countdown (showing the spinner) until the camera feed is live.
        if (part === "countdown" && gateCountdown) {
          if (!existing && !countdownDeferred) {
            countdownDeferred = true;
            clearTimeout(countdownFallbackTimer);
            countdownFallbackTimer = setTimeout(mountDeferredCountdown, 12000);
          }
          continue;
        }
        if (!existing) mountPart(container, part);
        // Keep the bubble hidden behind the spinner until the feed is live.
        if (part === "bubble" && gateCountdown) setBubbleHidden(true);
      } else if (existing) {
        existing.remove();
      }
    }
    if (gateCountdown) showConnecting(container);
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

  // Overlay iframes post layout requests (toolbar hover-resize, bubble drag and
  // size). Only trust messages from our own extension-origin frames.
  window.addEventListener("message", (event) => {
    const data = event.data as
      | {
          source?: string;
          kind?: string;
          part?: string;
          height?: number;
          size?: string;
        }
      | undefined;
    if (!data || data.source !== "clips-overlay") return;
    if (event.origin !== chrome.runtime.getURL("").replace(/\/$/, "")) return;

    if (data.kind === "resize" && data.part === "toolbar") {
      const frame = document.getElementById(partFrameId("toolbar"));
      if (frame && typeof data.height === "number") {
        frame.style.height = `${Math.round(data.height)}px`;
      }
      return;
    }
    if (data.kind === "camera-ready") {
      cameraReady = true;
      if (countdownDeferred) mountDeferredCountdown();
      return;
    }
    if (data.kind === "countdown-finished") {
      document.getElementById(partFrameId("countdown"))?.remove();
      hideConnecting();
      return;
    }
    if (data.kind === "bubble-drag-start") {
      startBubbleDrag();
      return;
    }
    if (data.kind === "bubble-size") {
      bubbleGeom.size = data.size === "sm" ? "sm" : "lg";
      applyBubbleGeom();
      persistBubbleGeom();
      return;
    }
  });

  syncIfRecording();
})();
