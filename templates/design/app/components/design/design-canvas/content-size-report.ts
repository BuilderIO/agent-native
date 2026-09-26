import { injectDocumentMarkup } from "@agent-native/core/shared";


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

  function rawMeasure() {
    var doc = document.documentElement;
    var body = document.body;
    return Math.max(
      doc ? doc.scrollHeight : 0,
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
    );
  }

  function naturalMeasure() {
    var body = document.body;
    if (!body) return 0;
    var bodyTop = body.getBoundingClientRect().top + (window.scrollY || 0);
    var height = Math.max(body.scrollHeight, body.offsetHeight);
    var descendants = body.querySelectorAll("*");
    for (var i = 0; i < descendants.length; i++) {
      var element = descendants[i];
      if (element.closest("[data-agent-native-edit-overlay]")) continue;
      var styles = window.getComputedStyle(element);
      if (styles.display === "none" || styles.position === "fixed") continue;
      var bottom = element.getBoundingClientRect().bottom +
        (window.scrollY || 0) - bodyTop;
      if (bottom > height) height = bottom;
    }
    return Math.max(1, Math.ceil(height));
  }

  function usesNaturalHeight() {
    if (document.querySelector('meta[data-agent-native-screen-height-mode="hug"]')) {
      return true;
    }
    var modeStyle = document.querySelector(
      "style[data-agent-native-screen-default-height]",
    );
    return !!modeStyle && modeStyle.textContent.trim() === "";
  }

  // The editor's overlays are chrome, not content. A selection handle sits a
  // few px outside the box it marks, so once a selection reaches the bottom
  // edge the frame grows to fit it, which moves the handle down, which grows
  // the frame again. Hug screens also need the natural measurement without
  // badges, whose shadows can extend past their border box. Hide chrome only
  // in this report and only when Hug is opted in or chrome affects the frame.
  function measure(includeNaturalHeight) {
    var raw = rawMeasure();
    var chrome = document.querySelectorAll("[data-agent-native-edit-overlay]");
    if (!chrome.length) {
      return {
        height: raw,
        naturalHeight: includeNaturalHeight ? naturalMeasure() : null,
      };
    }
    var chromeBottom = 0;
    var scrollY = window.scrollY || 0;
    for (var i = 0; i < chrome.length; i++) {
      var bottom = chrome[i].getBoundingClientRect().bottom + scrollY;
      if (bottom > chromeBottom) chromeBottom = bottom;
    }
    var rawNeedsChromeExclusion = chromeBottom >= raw - 1;
    if (!rawNeedsChromeExclusion && !includeNaturalHeight) {
      return {
        height: raw,
        naturalHeight: null,
      };
    }
    var prior = [];
    for (var j = 0; j < chrome.length; j++) {
      prior.push(chrome[j].style.display);
      chrome[j].style.display = "none";
    }
    try {
      return {
        height: rawNeedsChromeExclusion ? rawMeasure() : raw,
        naturalHeight: includeNaturalHeight ? naturalMeasure() : null,
      };
    } finally {
      for (var k = 0; k < chrome.length; k++) {
        chrome[k].style.display = prior[k];
      }
    }
  }

  window.__agentNativeMeasureNaturalHeight = function () {
    return measure(true).naturalHeight || 0;
  };

  var lastHeight = -1;
  var lastNaturalHeight = null;
  var lastWidth = -1;
  var frame = 0;
  function report() {
    frame = 0;
    applyDeviceVh();
    applyViewportHeightGuard();
    // Natural content sizing is opt-in for explicit Hug screens. Most
    // overview frames keep their authored/device height and should not walk
    // every layer on each observer report.
    var measurement = measure(usesNaturalHeight());
    var height = measurement.height;
    var naturalHeight = measurement.naturalHeight;
    var width = window.innerWidth || 0;
    var viewportHeight = window.innerHeight || 0;
    if (
      height === lastHeight &&
      naturalHeight === lastNaturalHeight &&
      width === lastWidth
    ) return;
    lastHeight = height;
    lastNaturalHeight = naturalHeight;
    lastWidth = width;
    try {
      window.parent.postMessage(
        {
          type: "agent-native:content-size",
          width: width,
          height: height,
          naturalHeight: naturalHeight,
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
    if (document.body) ro.observe(document.body);
  }
  // measure() hides and restores every chrome node to take a chrome-free
  // reading, and the hover ring is repositioned on each pointermove. Both are
  // attribute writes inside the observed subtree, so observing chrome lets the
  // reporter re-arm from its own measurement: one mutation then reflows the
  // whole document every frame for as long as the cursor stays on the canvas.
  function isChromeNode(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentNode;
    if (!el || el.nodeType !== 1 || !el.closest) return false;
    return !!el.closest("[data-agent-native-edit-overlay]");
  }
  function allChromeNodes(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      if (!isChromeNode(nodes[i])) return false;
    }
    return true;
  }
  function touchesAuthoredContent(records) {
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (isChromeNode(record.target)) continue;
      if (
        record.type === "childList" &&
        allChromeNodes(record.addedNodes) &&
        allChromeNodes(record.removedNodes)
      ) {
        continue;
      }
      return true;
    }
    return false;
  }
  if (typeof MutationObserver === "function") {
    var mo = new MutationObserver(function (records) {
      if (!touchesAuthoredContent(records)) return;
      scheduleReport();
    });
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

export function appendContentSizeReporter(html: string): string {
  return injectDocumentMarkup(html, CONTENT_SIZE_REPORT_BRIDGE);
}

export function measureNaturalDocumentHeight(doc: Document): number | null {
  const view = doc.defaultView as
    | (Window & { __agentNativeMeasureNaturalHeight?: () => number })
    | null;
  if (!view || typeof view.__agentNativeMeasureNaturalHeight !== "function") {
    return null;
  }
  const height = view.__agentNativeMeasureNaturalHeight();
  return Number.isFinite(height) && height > 0 ? Math.ceil(height) : null;
}
