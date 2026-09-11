/**
 * Sample bridge — proves the compile-time pipeline.
 *
 * Rules that every *.bridge.ts MUST follow:
 *   • No import/require of any module (DOM globals only).
 *   • No references to outer/module scope (the code runs inside an iframe).
 *   • Wrap everything in a self-executing IIFE.
 *   • Type-only imports (erased by tsc) are permitted if needed for doc purposes,
 *     but in practice they are unnecessary since no app types are reachable here.
 */
(function () {
  window.addEventListener("message", function (e: MessageEvent) {
    // Every other *.bridge.ts listener validates the sender before trusting
    // the payload (see editor-chrome.bridge.ts, hit-test.bridge.ts, etc. —
    // all check `e.source !== window.parent`); this one didn't, even though
    // it's just a compile-pipeline smoke-test fixture with no real iframe
    // wiring today. Match the house rule so it stays a safe template to
    // copy from if this file is ever pointed at a live surface.
    if (e.source !== window.parent) return;
    if (!e.data || e.data.type !== "agent-native:sample-ping") return;
    var correlationId: string = e.data.correlationId ?? "";
    try {
      (window.parent as Window).postMessage(
        { type: "agent-native:sample-pong", correlationId },
        "*",
      );
    } catch (_err) {
      // Cross-origin errors are silently swallowed.
    }
  });
})();
