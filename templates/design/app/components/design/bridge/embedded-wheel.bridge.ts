/**
 * Embedded canvas gesture bridge — injected into every canvas iframe.
 *
 * A screen preview is a real iframe, so wheel and pointer-drag events never
 * bubble to the canvas underneath. In embedded mode we forward bounded wheel
 * payloads to the parent. In every canvas mode we also forward middle-button
 * drags, plus left-button drags while the host's hand/Space tool is armed, so
 * the parent can reuse its existing single/overview pan implementation.
 *
 * Runtime placeholder (replaced by DesignCanvas.tsx before injection):
 *   __EMBEDDED_WHEEL_FORWARDING_ENABLED__  — boolean literal "true"/"false"
 *   __EMBEDDED_SPACE_KEY_FORWARDING_ENABLED__ — boolean literal; true only
 *     when the editor-chrome bridge is absent (Interact mode)
 *   __EDITING_SAFETY_ENABLED__ — boolean literal; true outside Interact mode
 *     to freeze authored motion and block native link/form navigation
 *
 * Protocol (iframe → parent, only when enabled):
 *
 *   { type: 'embedded-canvas-wheel', deltaX, deltaY, deltaZ, deltaMode,
 *     clientX, clientY, ctrlKey, metaKey, shiftKey, altKey }
 *
 *   { type: 'embedded-canvas-pan', phase: 'start'|'move'|'end'|'cancel',
 *     pointerId, button, buttons, clientX, clientY,
 *     ctrlKey, metaKey, shiftKey, altKey }
 *
 * Protocol (parent → iframe):
 *
 *   { type: 'embedded-canvas-pan-mode', leftButtonEnabled }
 *   { type: 'embedded-canvas-gesture-mode', wheelEnabled,
 *     spaceKeyForwardingEnabled }
 *   { type: 'embedded-canvas-pan-cancel' }
 *
 * Rules:
 *   • No import/require of any module (DOM globals only).
 *   • No references to outer/module scope (the code runs inside an iframe).
 *   • Wrap everything in a self-executing IIFE.
 */
declare var __EMBEDDED_WHEEL_FORWARDING_ENABLED__: boolean;
declare var __EMBEDDED_SPACE_KEY_FORWARDING_ENABLED__: boolean;
declare var __EDITING_SAFETY_ENABLED__: boolean;

(function () {
  var wheelEnabled = __EMBEDDED_WHEEL_FORWARDING_ENABLED__;
  var spaceKeyForwardingEnabled = __EMBEDDED_SPACE_KEY_FORWARDING_ENABLED__;
  var editingSafetyEnabled = __EDITING_SAFETY_ENABLED__;
  var leftButtonEnabled = false;
  var temporarySpacePanEnabled = false;
  var activePointerId: number | null = null;
  var activeButton: 0 | 1 | null = null;
  var captureTarget: Element | null = null;
  var suppressClick = false;
  var clearSuppressClickTimer: number | null = null;
  var lastClientX = 0;
  var lastClientY = 0;
  var lastCtrlKey = false;
  var lastMetaKey = false;
  var lastShiftKey = false;
  var lastAltKey = false;

  if (editingSafetyEnabled) {
    var freezeStyle = document.createElement("style");
    freezeStyle.setAttribute("data-agent-native-editing-safety-style", "");
    freezeStyle.textContent =
      "html,body{animation:none!important;transition:none!important;scroll-behavior:auto!important}" +
      "body *:not([data-agent-native-edit-overlay]):not([data-agent-native-edit-overlay] *){" +
      "animation:none!important;transition:none!important;scroll-behavior:auto!important}" +
      "body *:not([data-agent-native-edit-overlay]):not([data-agent-native-edit-overlay] *)::before," +
      "body *:not([data-agent-native-edit-overlay]):not([data-agent-native-edit-overlay] *)::after{" +
      "animation:none!important;transition:none!important}";
    (document.head || document.documentElement).appendChild(freezeStyle);
  }

  function clamp(value: number, limit: number): number {
    var number = Number(value) || 0;
    if (number > limit) return limit;
    if (number < -limit) return -limit;
    return number;
  }

  function stopNativeInteraction(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  function stopEditingNavigation(e: Event): void {
    if (!editingSafetyEnabled) return;
    stopNativeInteraction(e);
  }

  function stopEditingLinkNavigation(e: MouseEvent): void {
    if (!editingSafetyEnabled) return;
    var target = e.target as Element | null;
    if (!target || !target.closest) return;
    if (target.closest("a[href], area[href]")) stopNativeInteraction(e);
  }

  function postToParent(message: Record<string, unknown>): void {
    try {
      (window.parent as Window).postMessage(message, "*");
    } catch {}
  }

  function onWheel(e: WheelEvent): void {
    if (!wheelEnabled) return;
    stopNativeInteraction(e);
    postToParent({
      type: "embedded-canvas-wheel",
      deltaX: clamp(e.deltaX, 240),
      deltaY: clamp(e.deltaY, 240),
      deltaZ: clamp(e.deltaZ, 240),
      deltaMode: e.deltaMode,
      clientX: clamp(e.clientX, 100000),
      clientY: clamp(e.clientY, 100000),
      ctrlKey: !!e.ctrlKey,
      metaKey: !!e.metaKey,
      shiftKey: !!e.shiftKey,
      altKey: !!e.altKey,
    });
  }

  function shouldStartPan(e: PointerEvent): boolean {
    if (e.button === 1) return true;
    return e.button === 0 && (leftButtonEnabled || temporarySpacePanEnabled);
  }

  function postPan(
    phase: "start" | "move" | "end" | "cancel",
    e: PointerEvent,
  ): void {
    if (activeButton === null) return;
    lastClientX = clamp(e.clientX, 100000);
    lastClientY = clamp(e.clientY, 100000);
    lastCtrlKey = !!e.ctrlKey;
    lastMetaKey = !!e.metaKey;
    lastShiftKey = !!e.shiftKey;
    lastAltKey = !!e.altKey;
    postToParent({
      type: "embedded-canvas-pan",
      phase: phase,
      pointerId: Math.max(0, Math.min(0x7fffffff, Math.trunc(e.pointerId))),
      button: activeButton,
      buttons: phase === "end" || phase === "cancel" ? 0 : e.buttons,
      clientX: lastClientX,
      clientY: lastClientY,
      ctrlKey: lastCtrlKey,
      metaKey: lastMetaKey,
      shiftKey: lastShiftKey,
      altKey: lastAltKey,
    });
  }

  function releasePointerCapture(pointerId: number): void {
    if (!captureTarget) return;
    try {
      if (captureTarget.hasPointerCapture(pointerId)) {
        captureTarget.releasePointerCapture(pointerId);
      }
    } catch {}
    captureTarget = null;
  }

  function scheduleClickSuppressionReset(): void {
    if (clearSuppressClickTimer !== null) {
      window.clearTimeout(clearSuppressClickTimer);
    }
    clearSuppressClickTimer = window.setTimeout(function () {
      suppressClick = false;
      clearSuppressClickTimer = null;
    }, 0);
  }

  function onPointerDown(e: PointerEvent): void {
    if (activePointerId !== null || !shouldStartPan(e)) return;
    activePointerId = e.pointerId;
    activeButton = e.button === 1 ? 1 : 0;
    suppressClick = true;
    captureTarget =
      e.target instanceof Element ? e.target : document.documentElement;
    try {
      captureTarget.setPointerCapture(e.pointerId);
    } catch {}
    stopNativeInteraction(e);
    postPan("start", e);
  }

  function onPointerMove(e: PointerEvent): void {
    if (activePointerId !== e.pointerId || activeButton === null) return;
    stopNativeInteraction(e);
    postPan("move", e);
  }

  function finishPan(phase: "end" | "cancel", e: PointerEvent): void {
    if (activePointerId !== e.pointerId || activeButton === null) return;
    stopNativeInteraction(e);
    postPan(phase, e);
    releasePointerCapture(e.pointerId);
    activePointerId = null;
    activeButton = null;
    scheduleClickSuppressionReset();
  }

  function onPointerUp(e: PointerEvent): void {
    finishPan("end", e);
  }

  function onPointerCancel(e: PointerEvent): void {
    finishPan("cancel", e);
  }

  function suppressTrailingClick(e: MouseEvent): void {
    if (!suppressClick) return;
    stopNativeInteraction(e);
    suppressClick = false;
    if (clearSuppressClickTimer !== null) {
      window.clearTimeout(clearSuppressClickTimer);
      clearSuppressClickTimer = null;
    }
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    return !!(
      target instanceof Element &&
      target.closest(
        'input, textarea, select, [contenteditable], [role="textbox"], [data-agent-native-text-editing]',
      )
    );
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (
      !spaceKeyForwardingEnabled ||
      e.key !== " " ||
      e.code !== "Space" ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey ||
      e.shiftKey ||
      isTypingTarget(e.target)
    ) {
      return;
    }
    temporarySpacePanEnabled = true;
    stopNativeInteraction(e);
    if (e.repeat) return;
    postToParent({
      type: "design-hotkey",
      key: e.key,
      code: e.code,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      repeat: false,
    });
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (!spaceKeyForwardingEnabled || e.key !== " " || e.code !== "Space") {
      return;
    }
    var wasTemporarySpacePanEnabled = temporarySpacePanEnabled;
    temporarySpacePanEnabled = false;
    if (!wasTemporarySpacePanEnabled && isTypingTarget(e.target)) return;
    stopNativeInteraction(e);
    postToParent({ type: "design-hotkey-up", key: e.key, code: e.code });
  }

  function onHostMessage(e: MessageEvent): void {
    if (e.source !== window.parent) return;
    if (!e.data) return;
    if (e.data.type === "embedded-canvas-pan-cancel") {
      cancelActivePan();
      return;
    }
    if (e.data.type === "embedded-canvas-pan-mode") {
      leftButtonEnabled = !!e.data.leftButtonEnabled;
      return;
    }
    if (e.data.type === "embedded-canvas-gesture-mode") {
      wheelEnabled = !!e.data.wheelEnabled;
      spaceKeyForwardingEnabled = !!e.data.spaceKeyForwardingEnabled;
    }
  }

  function cancelActivePan(): void {
    temporarySpacePanEnabled = false;
    if (activePointerId === null || activeButton === null) return;
    var pointerId = activePointerId;
    postToParent({
      type: "embedded-canvas-pan",
      phase: "cancel",
      pointerId: pointerId,
      button: activeButton,
      buttons: 0,
      clientX: lastClientX,
      clientY: lastClientY,
      ctrlKey: lastCtrlKey,
      metaKey: lastMetaKey,
      shiftKey: lastShiftKey,
      altKey: lastAltKey,
    });
    releasePointerCapture(pointerId);
    activePointerId = null;
    activeButton = null;
    suppressClick = false;
  }

  function onWindowBlur(): void {
    // Moving focus from an iframe gesture into the parent canvas can blur the
    // child window while the top-level Design window is still active. The
    // parent separately sends embedded-canvas-pan-cancel on a real top-level
    // blur; this local guard handles page/tab hiding without killing that
    // intentional in-app focus transfer.
    if (document.visibilityState === "hidden") cancelActivePan();
  }

  var reloadReported = false;
  function reportRuntimeReload(): void {
    if (!editingSafetyEnabled || reloadReported) return;
    reloadReported = true;
    postToParent({ type: "agent-native:runtime-reloading" });
  }

  var wheelTarget: EventTarget =
    document.documentElement || document.body || document;
  wheelTarget.addEventListener("wheel", onWheel as EventListener, {
    passive: false,
    capture: true,
  });
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerCancel, true);
  document.addEventListener("click", suppressTrailingClick, true);
  document.addEventListener("click", stopEditingLinkNavigation, true);
  document.addEventListener("auxclick", suppressTrailingClick, true);
  document.addEventListener("submit", stopEditingNavigation, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("message", onHostMessage);
  window.addEventListener("blur", onWindowBlur);
  document.addEventListener("visibilitychange", onWindowBlur);
  window.addEventListener("beforeunload", reportRuntimeReload);
  window.addEventListener("pagehide", reportRuntimeReload);
  window.addEventListener("pagehide", cancelActivePan);
})();
