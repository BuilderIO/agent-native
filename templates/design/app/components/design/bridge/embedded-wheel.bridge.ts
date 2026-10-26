/**
 * Embedded canvas gesture bridge — injected into every Edit canvas iframe. Interact's document carries only the theme and links bridges.
 * Its Interact-mode guards remain as defense in depth.
 *
 * A screen preview is a real iframe, so wheel and pointer-drag events never
 * bubble to the canvas underneath. In embedded mode we forward bounded wheel
 * payloads to the parent. In every canvas mode we also forward middle-button
 * drags, plus left-button drags while the host's hand/Space tool is armed, so
 * the parent can reuse its existing single/overview pan implementation.
 *
 * Runtime placeholder (replaced by DesignCanvas.tsx before injection):
 *   __EMBEDDED_WHEEL_FORWARDING_ENABLED__  — boolean literal "true"/"false"
 *   __EMBEDDED_SPACE_KEY_FORWARDING_ENABLED__ — boolean literal controlling
 *     Space hotkey relay to the host; local Space-pan is always available
 *   __EDITING_SAFETY_ENABLED__ — boolean literal; true outside Interact mode
 *     to freeze authored motion and block native link/form navigation
 *   __INTERACTION_MODE__ — boolean literal; true while Interact owns the
 *     page. Every gesture below is then inert: the wheel, the middle button,
 *     Space and a drag are the page's own, so none is cancelled or forwarded
 *
 * Protocol (iframe → parent, only when enabled):
 *
 *   { type: 'embedded-canvas-wheel', deltaX, deltaY, deltaZ, deltaMode,
 *     clientX, clientY, ctrlKey, metaKey, shiftKey, altKey, steps, seq }
 *
 *   Until the host answers the last one with 'embedded-canvas-wheel-read'
 *   and its `seq`, later wheels fold into one pending message per kind of
 *   step, with deltas summed over `steps` wheels (at most 32 per message),
 *   so a host that falls behind doesn't work through a queue of stale steps
 *   after the fingers stop. At most 16 steps wait; wheels past that are
 *   dropped. A
 *   host that hasn't answered in 100 ms (1 s once it has answered before) is
 *   sent the next step anyway.
 *
 *   { type: 'embedded-canvas-pan', phase: 'start'|'move'|'end'|'cancel',
 *     pointerId, button, buttons, clientX, clientY, movementX, movementY,
 *     ctrlKey, metaKey, shiftKey, altKey }
 *
 * Protocol (parent → iframe):
 *
 *   { type: 'embedded-canvas-pan-mode', leftButtonEnabled }
 *   { type: 'embedded-canvas-wheel-read', seq }
 *   { type: 'embedded-canvas-gesture-mode', wheelEnabled,
 *     spaceKeyForwardingEnabled }
 *   { type: 'embedded-canvas-pan-cancel' }
 *   { type: 'set-interaction-mode', interact }
 *
 * Rules:
 *   • No import/require of any module (DOM globals only).
 *   • No references to outer/module scope (the code runs inside an iframe).
 *   • Wrap everything in a self-executing IIFE.
 */
declare var __EMBEDDED_WHEEL_FORWARDING_ENABLED__: boolean;
declare var __EMBEDDED_SPACE_KEY_FORWARDING_ENABLED__: boolean;
declare var __EDITING_SAFETY_ENABLED__: boolean;
declare var __INTERACTION_MODE__: boolean;

(function () {
  var wheelEnabled = __EMBEDDED_WHEEL_FORWARDING_ENABLED__;
  var spaceKeyForwardingEnabled = __EMBEDDED_SPACE_KEY_FORWARDING_ENABLED__;
  var editingSafetyEnabled = __EDITING_SAFETY_ENABLED__;
  var interactionMode = __INTERACTION_MODE__;
  var leftButtonEnabled = false;
  var temporarySpacePanEnabled = false;
  var forwardedSpaceKeyDown = false;
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
  var freezeStyle: HTMLStyleElement | null = null;
  type ForwardedWheel = {
    deltaX: number;
    deltaY: number;
    deltaZ: number;
    deltaMode: number;
    clientX: number;
    clientY: number;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    steps: number;
  };
  // Folded steps waiting for the host in arrival order: a new one for each
  // change of kind and every 32 wheels, and at most 16.
  var pendingWheels: ForwardedWheel[] = [];
  var wheelAwaitingHost = false;
  var wheelReadTimer: number | null = null;
  // The id of the last step sent; the host echoes it when it reads the step.
  var wheelSeq = 0;
  var hostAnswersWheels = false;

  function syncEditingSafetyStyle(): void {
    var currentStyle =
      freezeStyle ||
      (document.querySelector(
        "style[data-agent-native-editing-safety-style]",
      ) as HTMLStyleElement | null);
    if (!editingSafetyEnabled) {
      if (currentStyle && currentStyle.parentNode) {
        currentStyle.parentNode.removeChild(currentStyle);
      }
      freezeStyle = null;
      return;
    }
    if (currentStyle && currentStyle.isConnected) {
      freezeStyle = currentStyle;
      return;
    }
    freezeStyle = document.createElement("style");
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
  syncEditingSafetyStyle();

  function clamp(value: number, limit: number): number {
    var number = Number(value) || 0;
    if (number > limit) return limit;
    if (number < -limit) return -limit;
    return number;
  }

  function stopNativeInteraction(e: Event): void {
    if (e.cancelable) e.preventDefault();
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

  function sendWheel(wheel: ForwardedWheel): void {
    wheelSeq += 1;
    wheelAwaitingHost = true;
    if (wheelReadTimer !== null) window.clearTimeout(wheelReadTimer);
    // A host that never answers (the single-screen view reads pinches from the
    // zoom bridge instead) still gets the folded wheels, a few times a second.
    // One that has answered is waited on for up to a second, so slow frames
    // don't let a second step through; past that the answer is taken as lost.
    wheelReadTimer = window.setTimeout(
      sendNextWheel,
      hostAnswersWheels ? 1000 : 100,
    );
    postToParent({
      type: "embedded-canvas-wheel",
      deltaX: wheel.deltaX,
      deltaY: wheel.deltaY,
      deltaZ: wheel.deltaZ,
      deltaMode: wheel.deltaMode,
      clientX: wheel.clientX,
      clientY: wheel.clientY,
      ctrlKey: wheel.ctrlKey,
      metaKey: wheel.metaKey,
      shiftKey: wheel.shiftKey,
      altKey: wheel.altKey,
      steps: wheel.steps,
      seq: wheelSeq,
    });
  }

  function sendNextWheel(): void {
    if (wheelReadTimer !== null) {
      window.clearTimeout(wheelReadTimer);
      wheelReadTimer = null;
    }
    wheelAwaitingHost = false;
    var next = pendingWheels.shift();
    if (next) sendWheel(next);
  }

  function onWheelRead(seq: unknown): void {
    // An answer to a step the timer already gave up on frees nothing: the
    // step sent after it is still unread.
    if (seq !== wheelSeq) return;
    hostAnswersWheels = true;
    sendNextWheel();
  }

  function resetWheelForwarding(): void {
    if (wheelReadTimer !== null) {
      window.clearTimeout(wheelReadTimer);
      wheelReadTimer = null;
    }
    wheelAwaitingHost = false;
    pendingWheels = [];
  }

  function onWheel(e: WheelEvent): void {
    if (interactionMode) return;
    var zoomIntent = !!(e.ctrlKey || e.metaKey);
    if (!wheelEnabled && !zoomIntent) return;
    stopNativeInteraction(e);
    var wheel: ForwardedWheel = {
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
      steps: 1,
    };
    if (!wheelAwaitingHost) {
      sendWheel(wheel);
      return;
    }
    var pending =
      pendingWheels.length > 0 ? pendingWheels[pendingWheels.length - 1] : null;
    // The host bounds a step's pan by 32 wheels' worth, so a longer wait
    // queues further steps rather than folding travel it would clip.
    if (
      pending &&
      pending.steps < 32 &&
      pending.deltaMode === wheel.deltaMode &&
      pending.ctrlKey === wheel.ctrlKey &&
      pending.metaKey === wheel.metaKey &&
      pending.shiftKey === wheel.shiftKey &&
      pending.altKey === wheel.altKey
    ) {
      pending.deltaX += wheel.deltaX;
      pending.deltaY += wheel.deltaY;
      pending.deltaZ += wheel.deltaZ;
      pending.clientX = wheel.clientX;
      pending.clientY = wheel.clientY;
      pending.steps += 1;
      return;
    }
    // A pinch turning into a scroll is a new kind of step: queue it behind
    // the folded one rather than mix the two. A host that leaves 16 steps
    // unread has stopped keeping up, and more would only play out after the
    // fingers stop.
    if (pendingWheels.length >= 16) return;
    pendingWheels.push(wheel);
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
      movementX: clamp(e.movementX, 100000),
      movementY: clamp(e.movementY, 100000),
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
    if (interactionMode || activePointerId !== null || !shouldStartPan(e)) {
      return;
    }
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

  function shouldLetEditorChromeHandleSpace(): boolean {
    return (
      !spaceKeyForwardingEnabled &&
      editingSafetyEnabled &&
      !!document.querySelector("[data-agent-native-editor-chrome-host]")
    );
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (
      interactionMode ||
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
    if (shouldLetEditorChromeHandleSpace()) {
      if (e.cancelable) e.preventDefault();
      return;
    }
    stopNativeInteraction(e);
    if (e.repeat || !spaceKeyForwardingEnabled) return;
    forwardedSpaceKeyDown = true;
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
    if (e.key !== " " || e.code !== "Space") return;
    var wasTemporarySpacePanEnabled = temporarySpacePanEnabled;
    temporarySpacePanEnabled = false;
    var wasSpaceKeyForwarded = forwardedSpaceKeyDown;
    forwardedSpaceKeyDown = false;
    if (!wasTemporarySpacePanEnabled && !wasSpaceKeyForwarded) return;
    if (shouldLetEditorChromeHandleSpace() && !wasSpaceKeyForwarded) {
      if (e.cancelable) e.preventDefault();
      return;
    }
    stopNativeInteraction(e);
    if (wasSpaceKeyForwarded) {
      postToParent({ type: "design-hotkey-up", key: e.key, code: e.code });
    }
  }

  function onHostMessage(e: MessageEvent): void {
    if (e.source !== window.parent) return;
    if (!e.data) return;
    if (e.data.type === "embedded-canvas-pan-cancel") {
      cancelActivePan();
      return;
    }
    if (e.data.type === "embedded-canvas-wheel-read") {
      onWheelRead(e.data.seq);
      return;
    }
    if (e.data.type === "embedded-canvas-pan-mode") {
      leftButtonEnabled = !!e.data.leftButtonEnabled;
      return;
    }
    if (e.data.type === "set-interaction-mode") {
      interactionMode = e.data.interact === true;
      if (interactionMode) {
        resetWheelForwarding();
        cancelActivePan();
        if (forwardedSpaceKeyDown) {
          forwardedSpaceKeyDown = false;
          postToParent({ type: "design-hotkey-up", key: " ", code: "Space" });
        }
      }
      return;
    }
    if (e.data.type === "embedded-canvas-gesture-mode") {
      wheelEnabled = !!e.data.wheelEnabled;
      spaceKeyForwardingEnabled = !!e.data.spaceKeyForwardingEnabled;
      if (typeof e.data.editingSafetyEnabled === "boolean") {
        var nextEditingSafetyEnabled = e.data.editingSafetyEnabled;
        if (editingSafetyEnabled && !nextEditingSafetyEnabled) {
          cancelActivePan();
          if (forwardedSpaceKeyDown) {
            forwardedSpaceKeyDown = false;
            postToParent({
              type: "design-hotkey-up",
              key: " ",
              code: "Space",
            });
          }
        }
        editingSafetyEnabled = nextEditingSafetyEnabled;
        syncEditingSafetyStyle();
      }
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
      movementX: 0,
      movementY: 0,
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
