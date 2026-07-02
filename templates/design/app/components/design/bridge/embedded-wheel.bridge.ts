/**
 * Embedded overview bridge — injected into every canvas iframe.
 *
 * A screen preview is a real iframe, so normal wheel events never bubble to
 * the overview canvas underneath. In embedded mode we forward a bounded wheel
 * payload to the parent so the existing canvas wheel handler can pan/zoom
 * exactly as if the pointer were over empty canvas.
 *
 * Runtime placeholder (replaced by DesignCanvas.tsx before injection):
 *   __EMBEDDED_WHEEL_FORWARDING_ENABLED__  — boolean literal "true"/"false"
 *
 * Protocol (iframe → parent, only when enabled):
 *
 *   { type: 'embedded-canvas-wheel', deltaX, deltaY, deltaZ, deltaMode,
 *     clientX, clientY, ctrlKey, metaKey, shiftKey, altKey }
 *
 * Rules:
 *   • No import/require of any module (DOM globals only).
 *   • No references to outer/module scope (the code runs inside an iframe).
 *   • Wrap everything in a self-executing IIFE.
 */
declare var __EMBEDDED_WHEEL_FORWARDING_ENABLED__: boolean;

(function () {
  var enabled = __EMBEDDED_WHEEL_FORWARDING_ENABLED__;
  if (!enabled) return;
  function clamp(value: number, limit: number): number {
    var number = Number(value) || 0;
    if (number > limit) return limit;
    if (number < -limit) return -limit;
    return number;
  }
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    try {
      (window.parent as Window).postMessage(
        {
          type: "embedded-canvas-wheel",
          deltaX: clamp(e.deltaX, 240),
          deltaY: clamp(e.deltaY, 240),
          deltaZ: clamp(e.deltaZ, 240),
          deltaMode: e.deltaMode,
          clientX: e.clientX,
          clientY: e.clientY,
          ctrlKey: !!e.ctrlKey,
          metaKey: !!e.metaKey,
          shiftKey: !!e.shiftKey,
          altKey: !!e.altKey,
        },
        "*",
      );
    } catch (_err) {}
  }
  var wheelTarget: EventTarget =
    document.documentElement || document.body || document;
  wheelTarget.addEventListener("wheel", onWheel as EventListener, {
    passive: false,
    capture: true,
  });
})();
