import { injectDocumentMarkup } from "@agent-native/core/shared";

/**
 * Content-size reporter injected into every canvas iframe (primary + each
 * breakpoint) so a frame can grow to fit its own content instead of inheriting
 * the primary frame's aspect ratio. The iframes are sandbox="allow-scripts"
 * (opaque origin), so the parent can't read contentDocument — this measures
 * scrollHeight inside the frame and posts { type, width, height } out, keyed by
 * event.source. It first pins full-height utilities to a fixed per-frame
 * --agent-native-device-vh so a min-h-screen hero can't chase the growing frame
 * (runaway), then remaps raw viewport-height units in authored CSS to the same
 * fixed device viewport.
 */

const CONTENT_SIZE_REPORT_BRIDGE = `
<style data-agent-native-content-size-guard>
  .min-h-screen { min-height: var(--agent-native-device-vh, 100vh) !important; }
  .h-screen { height: var(--agent-native-device-vh, 100vh) !important; }
  .min-h-dvh { min-height: var(--agent-native-device-vh, 100dvh) !important; }
  .h-dvh { height: var(--agent-native-device-vh, 100dvh) !important; }
  .min-h-svh { min-height: var(--agent-native-device-vh, 100svh) !important; }
  .h-svh { height: var(--agent-native-device-vh, 100svh) !important; }
</style>
<script data-agent-native-content-size-bridge>
(function () {
  if (window.__agentNativeContentSizeReport) return;
  window.__agentNativeContentSizeReport = true;

  // Must match deviceViewportFloorForWidth in frame-geometry.ts.
  function deviceViewportHeight(widthPx) {
    if (widthPx <= 640) return 844; // phone
    if (widthPx <= 1024) return 1024; // tablet
    return 900; // desktop
  }

  // Idempotent: only writes when the value changes. The MutationObserver below
  // watches documentElement attributes, so an unconditional re-write here would
  // observe its own style change and loop forever (~60fps) on static content.
  var lastVh = "";
  function applyDeviceVh() {
    var vh = deviceViewportHeight(window.innerWidth || 0) + "px";
    if (vh === lastVh) return;
    lastVh = vh;
    document.documentElement.style.setProperty("--agent-native-device-vh", vh);
  }

  function remapViewportHeightUnits(value) {
    return value.replace(
      /-?(?:\\d+\\.?\\d*|\\.\\d+)(?:d|s|l)?vh\\b/gi,
      function (match) {
        return "calc(var(--agent-native-device-vh, 900px) * " +
          Number.parseFloat(match) + " / 100)";
      },
    );
  }

  function remapStyleDeclaration(style) {
    var properties = [];
    for (var i = 0; i < style.length; i++) properties.push(style[i]);
    properties.forEach(function (property) {
      var value = style.getPropertyValue(property);
      var remapped = remapViewportHeightUnits(value);
      if (remapped === value) return;
      style.setProperty(
        property,
        remapped,
        style.getPropertyPriority(property),
      );
    });
  }

  function remapRuleList(rules) {
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (rule.style) remapStyleDeclaration(rule.style);
      if (rule.cssRules) remapRuleList(rule.cssRules);
    }
  }

  function applyViewportHeightGuard() {
    for (var i = 0; i < document.styleSheets.length; i++) {
      try {
        remapRuleList(document.styleSheets[i].cssRules);
      } catch (err) {
        /* Cross-origin stylesheet - the parent-side feedback guard remains. */
      }
    }
    var inlineStyles = document.querySelectorAll("[style]");
    for (var j = 0; j < inlineStyles.length; j++) {
      remapStyleDeclaration(inlineStyles[j].style);
    }
  }

  function measure() {
    var doc = document.documentElement;
    var body = document.body;
    return Math.max(
      doc ? doc.scrollHeight : 0,
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
    );
  }

  var lastHeight = -1;
  var lastWidth = -1;
  var frame = 0;
  function report() {
    frame = 0;
    applyDeviceVh();
    applyViewportHeightGuard();
    var height = measure();
    var width = window.innerWidth || 0;
    var viewportHeight = window.innerHeight || 0;
    if (height === lastHeight && width === lastWidth) return;
    lastHeight = height;
    lastWidth = width;
    try {
      window.parent.postMessage(
        {
          type: "agent-native:content-size",
          width: width,
          height: height,
          viewportHeight: viewportHeight,
        },
        "*",
      );
    } catch (err) {
      /* cross-origin parent — ignore */
    }
  }
  function scheduleReport() {
    if (frame) return;
    frame = window.requestAnimationFrame(report);
  }

  applyDeviceVh();

  if (typeof ResizeObserver === "function") {
    var ro = new ResizeObserver(scheduleReport);
    if (document.documentElement) ro.observe(document.documentElement);
  }
  if (typeof MutationObserver === "function") {
    var mo = new MutationObserver(scheduleReport);
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  }
  window.addEventListener("resize", scheduleReport);
  window.addEventListener("load", scheduleReport);
  // Late webfont / Tailwind-JIT reflows: a few settle passes catch height
  // changes that land after the initial paint without a permanent timer.
  [0, 120, 400, 1000].forEach(function (delay) {
    window.setTimeout(scheduleReport, delay);
  });
  scheduleReport();
})();
</script>
`;

export const CONTENT_SIZE_REPORT_MESSAGE_TYPE = "agent-native:content-size";

export type ContentSizeSample = {
  acceptedHeight: number;
  height: number;
  viewportHeight: number;
  width: number;
};

/**
 * A document using raw viewport-height CSS can report a larger scrollHeight
 * every time its iframe grows. Keep the first useful height when subsequent
 * growth tracks the viewport growth; later content changes at a stable
 * viewport are still accepted.
 */
export function resolveStableContentSizeSample(
  previous: ContentSizeSample | undefined,
  next: Omit<ContentSizeSample, "acceptedHeight">,
): ContentSizeSample {
  if (!previous) return { ...next, acceptedHeight: next.height };
  const sameWidth = Math.abs(next.width - previous.width) <= 1;
  const viewportGrowth = next.viewportHeight - previous.viewportHeight;
  const contentGrowth = next.height - previous.height;
  const viewportCoupledGrowth =
    sameWidth && viewportGrowth > 1 && contentGrowth > 1;
  return {
    ...next,
    acceptedHeight: viewportCoupledGrowth
      ? previous.acceptedHeight
      : next.height,
  };
}

/** Appends the reporter + full-height guard, mirroring appendHitTestResponder's
 * marker handling so it runs regardless of document structure. */
export function appendContentSizeReporter(html: string): string {
  return injectDocumentMarkup(html, CONTENT_SIZE_REPORT_BRIDGE);
}
