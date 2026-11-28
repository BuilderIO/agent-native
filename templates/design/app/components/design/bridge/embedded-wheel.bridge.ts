/**
 * Embedded canvas gesture bridge — injected into every Edit canvas iframe. Interact's document carries only the theme, links and tweaks bridges.
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
 *     to stabilize managed/endless motion and block native link/form navigation
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
    // A zoom wheel the host reads as a mouse notch rather than a pinch.
    notch: boolean;
  };
  // Folded steps waiting for the host in arrival order: a new one for each
  // change of kind and every 32 wheels, and at most 16.
  var pendingWheels: ForwardedWheel[] = [];
  var wheelAwaitingHost = false;
  var wheelReadTimer: number | null = null;
  // The id of the last step sent; the host echoes it when it reads the step.
  var wheelSeq = 0;
  var hostAnswersWheels = false;

  var frozenAnimationTargets = new Set<Element>();
  // Keyed by selector plus pseudo-element: a host's frozen loop says nothing about its ::after.
  var frozenAnimationSlots = new Set<string>();

  function managedAnimationNames(rules: CSSRuleList, names: Set<string>): void {
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (rule.type === CSSRule.KEYFRAMES_RULE)
        names.add((rule as CSSKeyframesRule).name);
      else if (rule.type === CSSRule.STYLE_RULE) {
        for (var name of (rule as CSSStyleRule).style.animationName.split(","))
          if (name.trim() && name.trim() !== "none") names.add(name.trim());
      } else if ("cssRules" in rule)
        managedAnimationNames((rule as CSSGroupingRule).cssRules, names);
    }
  }

  function animationTargetSelector(element: Element): string {
    var parts: string[] = [];
    for (
      var current = element;
      current.parentElement;
      current = current.parentElement
    ) {
      var index = 1;
      for (
        var sibling = current.previousElementSibling;
        sibling;
        sibling = sibling.previousElementSibling
      )
        index++;
      parts.unshift("*:nth-child(" + index + ")");
    }
    return ":root" + (parts.length ? ">" + parts.join(">") : "");
  }

  function animationSafetyRules(): string {
    var managed = new Set<string>();
    var styles = document.querySelectorAll("style[data-agent-native-motion]");
    for (var i = 0; i < styles.length; i++) {
      var sheet = (styles[i] as HTMLStyleElement).sheet;
      if (sheet) managedAnimationNames(sheet.cssRules, managed);
    }
    var output = "";
    var inspected = new Set<string>();
    frozenAnimationTargets.clear();
    frozenAnimationSlots.clear();
    for (var animation of document.getAnimations()) {
      if (!(animation instanceof CSSAnimation)) continue;
      var effect = animation.effect as KeyframeEffect | null;
      if (!effect || !effect.target) continue;
      var target = effect.target;
      // A document stylesheet cannot select into a shadow tree; a path built
      // from the shadow host down would match light-DOM nodes instead.
      if (
        !target.isConnected ||
        target.getRootNode() !== document ||
        target.closest("[data-agent-native-edit-overlay]")
      )
        continue;
      var pseudo = effect.pseudoElement;
      var selector = animationTargetSelector(target) + (pseudo || "");
      if (inspected.has(selector)) continue;
      inspected.add(selector);
      var style = getComputedStyle(target, pseudo);
      var names = style.animationName.split(",");
      var iterations = style.animationIterationCount.split(",");
      var durations = style.animationDuration.split(",");
      var suppressed = names.map(function (name, index) {
        return (
          managed.has(name.trim()) ||
          iterations[index % iterations.length].trim() === "infinite"
        );
      });
      if (
        !suppressed.some(function (value) {
          return value;
        })
      )
        continue;
      frozenAnimationTargets.add(target);
      frozenAnimationSlots.add(selector);
      // Keep finite slots intact: changing a neighboring loop must not restart an entrance.
      output +=
        selector +
        "{animation-name:" +
        names
          .map(function (name, index) {
            return suppressed[index] ? "none" : name;
          })
          .join(",") +
        "!important;animation-duration:" +
        names
          .map(function (_name, index) {
            return suppressed[index]
              ? "0s"
              : durations[index % durations.length];
          })
          .join(",") +
        "!important}";
    }
    return output;
  }

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
      frozenAnimationTargets.clear();
      frozenAnimationSlots.clear();
      return;
    }
    freezeStyle = currentStyle || document.createElement("style");
    freezeStyle.setAttribute("data-agent-native-editing-safety-style", "");
    var css =
      "html,body{transition:none!important;scroll-behavior:auto!important}" +
      "body *:not([data-agent-native-edit-overlay]):not([data-agent-native-edit-overlay] *){" +
      "transition:none!important;scroll-behavior:auto!important}" +
      "body *:not([data-agent-native-edit-overlay]):not([data-agent-native-edit-overlay] *)::before," +
      "body *:not([data-agent-native-edit-overlay]):not([data-agent-native-edit-overlay] *)::after{" +
      "transition:none!important}";
    // Read the authored cascade, including split declarations and conditional rules.
    var hasFrozenAnimationRules =
      frozenAnimationTargets.size > 0 ||
      (freezeStyle.textContent || "").indexOf("animation-name:") !== -1;
    var sheet = freezeStyle.sheet;
    var disableForRead = !!(sheet && hasFrozenAnimationRules);
    if (disableForRead && sheet) sheet.disabled = true;
    try {
      css += animationSafetyRules();
      if (freezeStyle.textContent !== css) freezeStyle.textContent = css;
      if (!freezeStyle.isConnected) document.head.appendChild(freezeStyle);
    } finally {
      if (disableForRead && sheet) {
        sheet.disabled = false;
      }
    }
  }
  syncEditingSafetyStyle();
  function inlineAnimationDeclarations(value: string | null): string {
    return (value || "")
      .split(";")
      .filter(function (declaration) {
        // Custom properties count: `animation: var(--motion)` changes with them.
        return /^\s*(?:--[\w-]+|(?:-webkit-)?animation(?:-[\w-]+)?)\s*:/.test(
          declaration,
        );
      })
      .join(";");
  }
  function containsFrozenAnimationTarget(root: Element) {
    return Array.from(frozenAnimationTargets).some(function (element) {
      return root.contains(element);
    });
  }
  new MutationObserver(function (records) {
    if (!editingSafetyEnabled) return;
    var changed = records.some(function (record) {
      var target =
        record.target instanceof Element
          ? record.target
          : record.target.parentElement;
      var style = target && target.closest("style");
      if (style) return style !== freezeStyle;
      if (target && target.closest("[data-agent-native-edit-overlay]"))
        return false;
      if (record.type === "attributes") {
        if (!target) return false;
        if (record.attributeName === "style")
          return (
            inlineAnimationDeclarations(record.oldValue) !==
            inlineAnimationDeclarations(target.getAttribute("style"))
          );
        return (
          target.getAnimations({ subtree: true }).length > 0 ||
          containsFrozenAnimationTarget(target)
        );
      }
      if (target && containsFrozenAnimationTarget(target)) return true;
      // A removed node's animations are already cancelled, so check the
      // frozen set directly; its positional rule would hit the next sibling.
      if (
        Array.from(record.removedNodes).some(function (node) {
          return node instanceof Element && containsFrozenAnimationTarget(node);
        })
      )
        return true;
      return Array.from(record.addedNodes)
        .concat(Array.from(record.removedNodes))
        .some(function (node) {
          return (
            node instanceof Element &&
            node !== freezeStyle &&
            !node.hasAttribute("data-agent-native-edit-overlay") &&
            (node.matches("style") ||
              !!node.querySelector("style") ||
              node.getAnimations({ subtree: true }).length > 0)
          );
        });
    });
    if (changed) syncEditingSafetyStyle();
  }).observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style"],
    attributeOldValue: true,
  });
  window.addEventListener("resize", function () {
    if (!editingSafetyEnabled) return;
    syncEditingSafetyStyle();
  });
  // :hover, :focus and attribute selectors can start a loop without a mutation.
  document.addEventListener(
    "animationstart",
    function (event) {
      var target = event.target;
      if (
        editingSafetyEnabled &&
        target instanceof Element &&
        !frozenAnimationSlots.has(
          animationTargetSelector(target) + (event.pseudoElement || ""),
        ) &&
        getComputedStyle(target, event.pseudoElement || null)
          .animationIterationCount.split(",")
          .some(function (count) {
            return count.trim() === "infinite";
          })
      )
        syncEditingSafetyStyle();
    },
    true,
  );
  // A stylesheet applies after its link is inserted, without a DOM mutation.
  document.addEventListener(
    "load",
    function (event) {
      if (editingSafetyEnabled && event.target instanceof HTMLLinkElement) {
        syncEditingSafetyStyle();
      }
    },
    true,
  );

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

  var reportedBridgeFailures: Record<string, boolean> = {};

  function reportBridgeFailure(operation: string, error: unknown): void {
    if (reportedBridgeFailures[operation]) return;
    reportedBridgeFailures[operation] = true;
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn(
        "[design-embedded-wheel-bridge] " + operation + " failed:",
        error,
      );
    }
  }

  function isExpectedPointerCaptureError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    var name = (error as { name?: unknown }).name;
    return name === "NotFoundError" || name === "InvalidStateError";
  }

  function postToParent(message: Record<string, unknown>): boolean {
    var parentWindow = window.parent as Window | null | undefined;
    if (!parentWindow || typeof parentWindow.postMessage !== "function") {
      reportBridgeFailure("postMessage", "window.parent is unavailable");
      return false;
    }
    try {
      parentWindow.postMessage(message, "*");
      return true;
    } catch (error) {
      reportBridgeFailure("postMessage", error);
      return false;
    }
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
    if (
      !postToParent({
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
      })
    ) {
      window.clearTimeout(wheelReadTimer);
      wheelReadTimer = null;
      wheelAwaitingHost = false;
    }
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
    var deltaY = clamp(e.deltaY, 240);
    var wheel: ForwardedWheel = {
      deltaX: clamp(e.deltaX, 240),
      deltaY: deltaY,
      deltaZ: clamp(e.deltaZ, 240),
      deltaMode: e.deltaMode,
      clientX: clamp(e.clientX, 100000),
      clientY: clamp(e.clientY, 100000),
      ctrlKey: !!e.ctrlKey,
      metaKey: !!e.metaKey,
      shiftKey: !!e.shiftKey,
      altKey: !!e.altKey,
      steps: 1,
      // MAX_PINCH_DELTA_PX in core's zoom-gesture.
      notch: zoomIntent && Math.abs(deltaY) >= 40,
    };
    if (!wheelAwaitingHost) {
      sendWheel(wheel);
      return;
    }
    var pending =
      pendingWheels.length > 0 ? pendingWheels[pendingWheels.length - 1] : null;
    // The host bounds a step's pan by 32 wheels' worth, so a longer wait
    // queues further steps rather than folding travel it would clip. It
    // picks a zoom step's curve by its average wheel, so pinch-sized and
    // notch-sized wheels stay apart, and notches fold only in one direction
    // so their average stays a notch.
    if (
      pending &&
      pending.steps < 32 &&
      pending.deltaMode === wheel.deltaMode &&
      pending.ctrlKey === wheel.ctrlKey &&
      pending.metaKey === wheel.metaKey &&
      pending.shiftKey === wheel.shiftKey &&
      pending.altKey === wheel.altKey &&
      pending.notch === wheel.notch &&
      (!wheel.notch || Math.sign(pending.deltaY) === Math.sign(wheel.deltaY))
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
  ): boolean {
    if (activeButton === null) return false;
    lastClientX = clamp(e.clientX, 100000);
    lastClientY = clamp(e.clientY, 100000);
    lastCtrlKey = !!e.ctrlKey;
    lastMetaKey = !!e.metaKey;
    lastShiftKey = !!e.shiftKey;
    lastAltKey = !!e.altKey;
    return postToParent({
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
    var target = captureTarget;
    captureTarget = null;
    if (!target) return;
    if (
      typeof target.hasPointerCapture !== "function" ||
      typeof target.releasePointerCapture !== "function"
    ) {
      return;
    }
    try {
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
    } catch (error) {
      if (!isExpectedPointerCaptureError(error)) {
        reportBridgeFailure("releasePointerCapture", error);
      }
    }
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
    var target =
      e.target instanceof Element ? e.target : document.documentElement;
    if (typeof target.setPointerCapture === "function") {
      try {
        target.setPointerCapture(e.pointerId);
        captureTarget = target;
      } catch (error) {
        captureTarget = null;
        if (!isExpectedPointerCaptureError(error)) {
          reportBridgeFailure("setPointerCapture", error);
        }
      }
    } else {
      captureTarget = null;
    }
    stopNativeInteraction(e);
    if (!postPan("start", e)) {
      releasePointerCapture(e.pointerId);
      activePointerId = null;
      activeButton = null;
      suppressClick = false;
    }
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
