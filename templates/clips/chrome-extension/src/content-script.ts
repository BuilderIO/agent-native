// global scope. Its only job is to

(function clipsOverlayHost() {
  type OverlayPart = "bubble" | "countdown" | "toolbar" | "saving";

  const CONTAINER_ID = "clips-recorder-overlay-root";
  const ALL_PARTS: OverlayPart[] = ["bubble", "countdown", "toolbar", "saving"];
  const flags = window as unknown as { __clipsOverlayHostReady?: boolean };

  if (flags.__clipsOverlayHostReady) return;
  flags.__clipsOverlayHostReady = true;
  let recordingActive = false;

  type InteractionKind = "navigation" | "click" | "input" | "scroll";
  const HISTORY_NAVIGATION_DEDUPE_MS = 250;
  const HISTORY_NAVIGATION_WINDOW_MS = 1000;
  const MAX_HISTORY_NAVIGATION_MESSAGES_PER_WINDOW = 20;
  const CLICK_INPUT_WINDOW_MS = 1000;
  const MAX_CLICK_INPUT_MESSAGES_PER_WINDOW = 100;
  let historyBridgeToken: string | null = null;
  let historyNavigationWindowStartedAt = 0;
  let historyNavigationCount = 0;
  let clickInputWindowStartedAt = 0;
  let clickInputCount = 0;
  let lastHistoryNavigation: { url: string; sentAtMs: number } | null = null;
  const OVERLAY_ROOT_ID = "clips-recorder-overlay-root";

  function resetDiagnosticQuotas(): void {
    historyNavigationWindowStartedAt = 0;
    historyNavigationCount = 0;
    clickInputWindowStartedAt = 0;
    clickInputCount = 0;
    lastHistoryNavigation = null;
  }

  function targetDescriptor(target: EventTarget | null): string | undefined {
    if (!(target instanceof Element)) return undefined;
    if (target.closest(`#${OVERLAY_ROOT_ID}`)) return undefined;
    const element = target.closest(
      "button,a,input,textarea,select,[role=button]",
    ) as Element | null;
    const candidate = element ?? target;
    const tag = candidate.tagName.toLowerCase();
    const id = candidate.id;
    const testId = candidate.getAttribute("data-testid");
    const name = candidate.getAttribute("name");
    const part = [id, testId, name].find((value): value is string => {
      if (!value || value.length > 80) return false;
      return /^[A-Za-z0-9_.:-]+$/.test(value);
    });
    return `${tag}${part ? `#${part}` : ""}`.slice(0, 200);
  }

  function sendDiagnosticInteraction(
    kind: InteractionKind,
    target: EventTarget | null = null,
    url?: string,
  ): void {
    if (!recordingActive) return;
    if (kind === "click" || kind === "input") {
      const now = Date.now();
      if (now - clickInputWindowStartedAt >= CLICK_INPUT_WINDOW_MS) {
        clickInputWindowStartedAt = now;
        clickInputCount = 0;
      }
      if (clickInputCount >= MAX_CLICK_INPUT_MESSAGES_PER_WINDOW) return;
      clickInputCount += 1;
    }
    try {
      chrome.runtime.sendMessage(
        {
          type: "CLIPS_DIAGNOSTIC_INTERACTION",
          kind,
          target: targetDescriptor(target),
          ...(url ? { url } : {}),
        },
        () => void chrome.runtime.lastError,
      );
      // coercion-ok: the extension context can disappear after page unload; capture is best-effort
    } catch {
      /* background unavailable */
    }
  }

  function sendDiagnosticNavigation(url: string): void {
    if (!recordingActive) return;
    const now = Date.now();
    if (
      lastHistoryNavigation?.url === url &&
      now - lastHistoryNavigation.sentAtMs < HISTORY_NAVIGATION_DEDUPE_MS
    ) {
      return;
    }
    if (
      now - historyNavigationWindowStartedAt >=
      HISTORY_NAVIGATION_WINDOW_MS
    ) {
      historyNavigationWindowStartedAt = now;
      historyNavigationCount = 0;
    }
    if (historyNavigationCount >= MAX_HISTORY_NAVIGATION_MESSAGES_PER_WINDOW) {
      return;
    }
    historyNavigationCount += 1;
    lastHistoryNavigation = { url, sentAtMs: now };
    sendDiagnosticInteraction("navigation", null, url);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data as
      | { source?: unknown; kind?: unknown; token?: unknown; url?: unknown }
      | undefined;
    if (
      data?.source === "clips-diagnostic-history" &&
      data.kind === "token" &&
      typeof data.token === "string"
    ) {
      historyBridgeToken = data.token;
      return;
    }
    if (!recordingActive) return;
    if (
      data?.source !== "clips-diagnostic-history" ||
      data.kind !== "navigation" ||
      data.token !== historyBridgeToken ||
      typeof data.url !== "string"
    ) {
      return;
    }
    sendDiagnosticNavigation(data.url);
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) {
      return;
    }
    const data = event.data as
      | {
          source?: unknown;
          kind?: unknown;
          token?: unknown;
          email?: unknown;
          clipsBaseUrl?: unknown;
        }
      | undefined;
    if (
      data?.source !== "clips-auth-bridge" ||
      data.kind !== "session" ||
      typeof data.token !== "string" ||
      typeof data.clipsBaseUrl !== "string"
    ) {
      return;
    }
    chrome.runtime.sendMessage(
      {
        type: "CLIPS_AUTH_SESSION",
        token: data.token,
        ...(typeof data.email === "string" ? { email: data.email } : {}),
        clipsBaseUrl: data.clipsBaseUrl,
      },
      (response?: { ok?: boolean; error?: string }) => {
        void chrome.runtime.lastError;
        window.postMessage(
          {
            source: "clips-auth-bridge",
            kind: "session-result",
            ok: response?.ok === true,
            ...(response?.error ? { error: response.error } : {}),
          },
          window.location.origin,
        );
      },
    );
  });
  window.postMessage(
    { source: "clips-diagnostic-history", kind: "request-token" },
    "*",
  );

  let lastScrollAt = 0;
  const onClick = (event: MouseEvent) =>
    sendDiagnosticInteraction("click", event.target);
  const onInput = (event: Event) =>
    sendDiagnosticInteraction("input", event.target);
  const onScroll = (event: Event) => {
    const now = Date.now();
    if (now - lastScrollAt < 250) return;
    lastScrollAt = now;
    sendDiagnosticInteraction("scroll", event.target);
  };
  const onNavigation = () => sendDiagnosticNavigation(window.location.href);
  document.addEventListener("click", onClick, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("scroll", onScroll, true);
  window.addEventListener("popstate", onNavigation);
  window.addEventListener("hashchange", onNavigation);

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
      message:
        typeof error === "string" ? error : "Unknown content-script error",
    };
  }

  function reportContentScriptError(
    error: unknown,
    context: Record<string, unknown> = {},
  ): void {
    if (!recordingActive) return;
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

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes.clipsRecordingActive) return;
      const nextRecordingActive =
        changes.clipsRecordingActive.newValue === true;
      if (nextRecordingActive && !recordingActive) {
        resetDiagnosticQuotas();
      }
      recordingActive = nextRecordingActive;
    });
  } catch {
    /* storage unavailable */
  }

  const BUBBLE_SIZES: Record<string, number> = { sm: 184, lg: 280 };
  const bubbleGeom: { size: string; left: number | null; top: number | null } =
    { size: "lg", left: null, top: null };
  let bubbleDragLayer: HTMLDivElement | null = null;
  let bubblePersistTimer: ReturnType<typeof setTimeout> | undefined;

  const TOOLBAR_WIDTH = 68;
  const TOOLBAR_COLLAPSED_HEIGHT = 154;
  const toolbarGeom: { left: number | null; top: number | null } = {
    left: null,
    top: null,
  };
  let toolbarDragLayer: HTMLDivElement | null = null;
  let toolbarPersistTimer: ReturnType<typeof setTimeout> | undefined;

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
        void chrome.storage.local.set({ bubbleGeom });
      } catch {
        /* ignore */
      }
    }, 200);
  }

  function clampToolbar(
    left: number,
    top: number,
    height: number,
  ): { left: number; top: number } {
    return {
      left: Math.max(8, Math.min(left, window.innerWidth - TOOLBAR_WIDTH - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - height - 8)),
    };
  }

  function applyToolbarGeom(): void {
    const frame = document.getElementById(
      partFrameId("toolbar"),
    ) as HTMLIFrameElement | null;
    if (!frame) return;
    const height =
      frame.getBoundingClientRect().height || TOOLBAR_COLLAPSED_HEIGHT;
    const base = clampToolbar(
      toolbarGeom.left ?? 16,
      toolbarGeom.top ?? window.innerHeight / 2 - TOOLBAR_COLLAPSED_HEIGHT / 2,
      height,
    );
    Object.assign(frame.style, {
      left: `${base.left}px`,
      top: `${base.top}px`,
      right: "auto",
    });
  }

  function persistToolbarGeom(): void {
    clearTimeout(toolbarPersistTimer);
    toolbarPersistTimer = setTimeout(() => {
      try {
        void chrome.storage.local.set({ toolbarGeom });
      } catch {
        /* ignore */
      }
    }, 200);
  }

  function startToolbarDrag(): void {
    if (toolbarDragLayer) return;
    const frame = document.getElementById(
      partFrameId("toolbar"),
    ) as HTMLIFrameElement | null;
    if (!frame) return;

    const layer = document.createElement("div");
    Object.assign(layer.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      cursor: "grabbing",
    });
    (document.documentElement || document.body).appendChild(layer);
    toolbarDragLayer = layer;

    const onMove = (e: PointerEvent): void => {
      const rect = frame.getBoundingClientRect();
      const next = clampToolbar(
        rect.left + e.movementX,
        rect.top + e.movementY,
        rect.height || TOOLBAR_COLLAPSED_HEIGHT,
      );
      toolbarGeom.left = next.left;
      toolbarGeom.top = next.top;
      Object.assign(frame.style, {
        left: `${next.left}px`,
        top: `${next.top}px`,
        right: "auto",
      });
    };
    const onUp = (): void => {
      layer.removeEventListener("pointermove", onMove);
      layer.removeEventListener("pointerup", onUp);
      layer.removeEventListener("pointercancel", onUp);
      layer.remove();
      toolbarDragLayer = null;
      persistToolbarGeom();
    };
    layer.addEventListener("pointermove", onMove);
    layer.addEventListener("pointerup", onUp);
    layer.addEventListener("pointercancel", onUp);
  }

  function startBubbleDrag(): void {
    if (bubbleDragLayer) return;
    const frame = document.getElementById(
      partFrameId("bubble"),
    ) as HTMLIFrameElement | null;
    if (!frame) return;
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
    chrome.storage.local.get(["bubbleGeom", "toolbarGeom"], (value) => {
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
      const toolbar = value.toolbarGeom as
        | { left?: unknown; top?: unknown }
        | undefined;
      if (toolbar && typeof toolbar === "object") {
        toolbarGeom.left =
          typeof toolbar.left === "number" ? toolbar.left : null;
        toolbarGeom.top = typeof toolbar.top === "number" ? toolbar.top : null;
      }
      applyToolbarGeom();
    });
  } catch {
    /* ignore */
  }

  window.addEventListener("resize", () => {
    applyBubbleGeom();
    applyToolbarGeom();
  });

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

  function syncIfRecording(): void {
    try {
      chrome.storage.local.get("clipsRecordingActive", (value) => {
        if (chrome.runtime.lastError) return;
        const nextRecordingActive = value?.clipsRecordingActive === true;
        if (nextRecordingActive && !recordingActive) {
          resetDiagnosticQuotas();
        }
        recordingActive = nextRecordingActive;
        if (recordingActive) {
          sendDiagnosticNavigation(window.location.href);
          requestState();
        }
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
      const size = bubbleSizePx();
      Object.assign(frame.style, {
        left: "24px",
        bottom: "24px",
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "50%",
        overflow: "hidden",
        zIndex: "3",
      });
    } else if (part === "toolbar") {
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
    if (part === "toolbar") applyToolbarGeom();
  }

  const CONNECTING_ID = `${CONTAINER_ID}-connecting`;
  let cameraReady = false;
  let countdownDeferred = false;
  let countdownFallbackTimer: ReturnType<typeof setTimeout> | undefined;
  let lastWantedParts = new Set<OverlayPart>();

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

  function reconcile(parts: OverlayPart[], resetQuotas = false): void {
    console.log("[clips-cs] reconcile parts:", parts, "on", location.href);
    const wanted = new Set(parts.filter((p) => ALL_PARTS.includes(p)));
    const enteringRecording =
      wanted.has("toolbar") && !lastWantedParts.has("toolbar");
    if (resetQuotas || enteringRecording) resetDiagnosticQuotas();
    const enteringCameraCountdown =
      wanted.has("countdown") &&
      wanted.has("bubble") &&
      !lastWantedParts.has("countdown");
    if (!wanted.has("countdown")) {
      countdownDeferred = false;
      clearTimeout(countdownFallbackTimer);
      hideConnecting();
      setBubbleHidden(false);
    }
    if (wanted.size === 0) {
      document.getElementById(CONTAINER_ID)?.remove();
      cameraReady = false;
      lastWantedParts = wanted;
      return;
    }
    const container = ensureContainer();
    if (enteringCameraCountdown) {
      cameraReady = false;
      hideConnecting();
      setBubbleHidden(false);
      document.getElementById(partFrameId("bubble"))?.remove();
    }
    const gateCountdown =
      wanted.has("countdown") && wanted.has("bubble") && !cameraReady;
    for (const part of ALL_PARTS) {
      const existing = document.getElementById(partFrameId(part));
      if (wanted.has(part)) {
        if (part === "countdown" && gateCountdown) {
          if (!existing && !countdownDeferred) {
            countdownDeferred = true;
            clearTimeout(countdownFallbackTimer);
            countdownFallbackTimer = setTimeout(mountDeferredCountdown, 12000);
          }
          continue;
        }
        if (!existing) mountPart(container, part);
        if (part === "bubble" && gateCountdown) setBubbleHidden(true);
      } else if (existing) {
        existing.remove();
      }
    }
    if (gateCountdown) showConnecting(container);
    lastWantedParts = wanted;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return;
    const type = (message as { type?: unknown }).type;
    if (type === "CLIPS_OVERLAY_MOUNT") {
      const parts = (message as { parts?: unknown }).parts;
      reconcile(
        Array.isArray(parts) ? (parts as OverlayPart[]) : [],
        (message as { resetDiagnosticQuotas?: unknown })
          .resetDiagnosticQuotas === true,
      );
    } else if (type === "CLIPS_OVERLAY_UNMOUNT") {
      reconcile([]);
    }
  });

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
        applyToolbarGeom();
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
    if (data.kind === "toolbar-drag-start") {
      startToolbarDrag();
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
