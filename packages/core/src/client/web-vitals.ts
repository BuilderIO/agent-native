/**
 * Core Web Vitals per page view, measured with the browser's own
 * PerformanceObserver. A page view is one visible stretch of one route: it
 * ends when the route changes through `pushState`/`popstate` or the page is
 * hidden, and a page that becomes visible again starts a new one. TTFB and
 * LCP belong to the document load only; INP and CLS are measured within each
 * page view. A metric the browser cannot measure is left out, never zero.
 */

export type WebVitalsNavigationType = "load" | "client" | "resume";

export interface PageViewVitals {
  route: string;
  url: string;
  navigationType: WebVitalsNavigationType;
  ttfbMs?: number;
  lcpMs?: number;
  inpMs?: number;
  cls?: number;
}

export interface WebVitalsLocation {
  route: string;
  url: string;
  pathname: string;
}

interface LayoutShiftLike {
  startTime: number;
  value: number;
  hadRecentInput: boolean;
}

interface InteractionLike {
  interactionId?: number;
  duration: number;
}

interface PageView {
  location: WebVitalsLocation;
  navigationType: WebVitalsNavigationType;
  ttfbMs?: number;
  lcpMs?: number;
  lcpFinal: boolean;
  cls: number;
  windowValue: number;
  windowStart: number;
  windowLast: number;
  longestInteractions: Array<{ id: number; duration: number }>;
  interactionIds: Set<number>;
  interactionCountAtStart?: number;
}

export interface WebVitalsTrackerOptions {
  measuresLayoutShift: boolean;
  report: (vitals: PageViewVitals) => void;
  interactionCount?: () => number | undefined;
}

const CLS_WINDOW_GAP_MS = 1_000;
const CLS_WINDOW_MAX_MS = 5_000;
const LONGEST_INTERACTIONS_KEPT = 10;
const INTERACTIONS_PER_INP_STEP = 50;

function roundMs(value: number): number {
  return Math.round(value);
}

/**
 * The page-view state machine, separate from the observers that feed it so
 * the metric rules can be exercised without a browser.
 */
export function createWebVitalsTracker(options: WebVitalsTrackerOptions) {
  let current: PageView | null = null;

  function begin(
    location: WebVitalsLocation,
    navigationType: WebVitalsNavigationType,
  ): void {
    current = {
      location,
      navigationType,
      lcpFinal: navigationType !== "load",
      cls: 0,
      windowValue: 0,
      windowStart: 0,
      windowLast: 0,
      longestInteractions: [],
      interactionIds: new Set(),
      interactionCountAtStart: options.interactionCount?.(),
    };
  }

  function inp(view: PageView): number | undefined {
    const longest = view.longestInteractions;
    if (!longest.length) return undefined;
    const browserCount =
      view.interactionCountAtStart === undefined
        ? undefined
        : (options.interactionCount?.() ?? 0) - view.interactionCountAtStart;
    const count = Math.max(browserCount ?? 0, view.interactionIds.size);
    // The 98th percentile: skip one of the longest per 50 interactions.
    const index = Math.min(
      longest.length - 1,
      Math.floor(count / INTERACTIONS_PER_INP_STEP),
    );
    return roundMs(longest[index].duration);
  }

  function end(): void {
    const view = current;
    current = null;
    if (!view) return;
    const vitals: PageViewVitals = {
      route: view.location.route,
      url: view.location.url,
      navigationType: view.navigationType,
    };
    if (view.ttfbMs !== undefined) vitals.ttfbMs = view.ttfbMs;
    if (view.lcpMs !== undefined) vitals.lcpMs = view.lcpMs;
    const inpMs = inp(view);
    if (inpMs !== undefined) vitals.inpMs = inpMs;
    if (options.measuresLayoutShift) {
      vitals.cls = Math.round(view.cls * 10_000) / 10_000;
    }
    if (
      vitals.ttfbMs === undefined &&
      vitals.lcpMs === undefined &&
      vitals.inpMs === undefined &&
      vitals.cls === undefined
    ) {
      return;
    }
    options.report(vitals);
  }

  return {
    startLoad(location: WebVitalsLocation, ttfbMs: number | undefined): void {
      begin(location, "load");
      if (current && ttfbMs !== undefined) current.ttfbMs = roundMs(ttfbMs);
    },
    /**
     * `replace` keeps the page view and moves it to the new route, since
     * redirects and URL canonicalization replace the entry the person landed
     * on. Any other change of path is a new page view.
     */
    navigate(location: WebVitalsLocation, kind: "push" | "replace"): void {
      if (!current) return;
      if (current.location.pathname === location.pathname) return;
      if (kind === "replace") {
        current.location = location;
        return;
      }
      end();
      begin(location, "client");
    },
    hidden(): void {
      end();
    },
    visible(location: WebVitalsLocation): void {
      if (!current) begin(location, "resume");
    },
    largestContentfulPaint(startTimeMs: number): void {
      if (!current || current.lcpFinal) return;
      current.lcpMs = roundMs(Math.max(0, startTimeMs));
    },
    finalizeLargestContentfulPaint(): void {
      if (current) current.lcpFinal = true;
    },
    layoutShift(entry: LayoutShiftLike): void {
      const view = current;
      if (!view || entry.hadRecentInput) return;
      if (
        view.windowValue > 0 &&
        entry.startTime - view.windowLast < CLS_WINDOW_GAP_MS &&
        entry.startTime - view.windowStart < CLS_WINDOW_MAX_MS
      ) {
        view.windowValue += entry.value;
      } else {
        view.windowValue = entry.value;
        view.windowStart = entry.startTime;
      }
      view.windowLast = entry.startTime;
      view.cls = Math.max(view.cls, view.windowValue);
    },
    interaction(entry: InteractionLike): void {
      const view = current;
      const id = entry.interactionId;
      if (!view || !id) return;
      view.interactionIds.add(id);
      const longest = view.longestInteractions;
      const existing = longest.find((item) => item.id === id);
      if (existing) {
        existing.duration = Math.max(existing.duration, entry.duration);
      } else if (
        longest.length < LONGEST_INTERACTIONS_KEPT ||
        entry.duration > longest[longest.length - 1].duration
      ) {
        longest.push({ id, duration: entry.duration });
      } else {
        return;
      }
      longest.sort((a, b) => b.duration - a.duration);
      longest.length = Math.min(longest.length, LONGEST_INTERACTIONS_KEPT);
    },
  };
}

export type WebVitalsTracker = ReturnType<typeof createWebVitalsTracker>;

function supportedEntryTypes(): readonly string[] {
  return typeof PerformanceObserver !== "undefined"
    ? (PerformanceObserver.supportedEntryTypes ?? [])
    : [];
}

function activationStart(): number {
  const navigation = performance.getEntriesByType("navigation")[0] as
    | (PerformanceNavigationTiming & { activationStart?: number })
    | undefined;
  return navigation?.activationStart ?? 0;
}

function timeToFirstByte(): number | undefined {
  const navigation = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (!navigation || navigation.responseStart <= 0) return undefined;
  if (navigation.responseStart > performance.now()) return undefined;
  return Math.max(0, navigation.responseStart - activationStart());
}

export interface WebVitalsController {
  navigate(kind: "push" | "replace"): void;
}

/**
 * Starts measuring the current document. Returns null where the browser has
 * no PerformanceObserver, so no page view is reported as measured.
 */
export function installWebVitals(
  locate: () => WebVitalsLocation,
  report: (vitals: PageViewVitals) => void,
): WebVitalsController | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  const types = supportedEntryTypes();
  if (!types.length) return null;

  const performanceWithCount = performance as Performance & {
    interactionCount?: number;
  };
  const tracker = createWebVitalsTracker({
    measuresLayoutShift: types.includes("layout-shift"),
    report,
    interactionCount: () => performanceWithCount.interactionCount,
  });
  const prerendering = (document as Document & { prerendering?: boolean })
    .prerendering;
  let firstHiddenAt =
    document.visibilityState === "hidden" && !prerendering ? 0 : Infinity;
  const observers = new Map<
    PerformanceObserver,
    (entries: PerformanceEntryList) => void
  >();

  const observe = (
    type: string,
    handle: (entries: PerformanceEntryList) => void,
    init: Record<string, unknown> = {},
  ) => {
    if (!types.includes(type)) return;
    try {
      const observer = new PerformanceObserver((list) =>
        handle(list.getEntries()),
      );
      observer.observe({ type, buffered: true, ...init });
      observers.set(observer, handle);
      // coercion-ok: an entry type the browser lists but refuses to observe leaves its metric absent from the report, never 0.
    } catch {}
  };
  const flush = () => {
    for (const [observer, handle] of observers) {
      const records = observer.takeRecords();
      if (records.length) handle(records);
    }
  };

  tracker.startLoad(locate(), timeToFirstByte());

  const handleLcp = (entries: PerformanceEntryList) => {
    const start = activationStart();
    for (const entry of entries) {
      if (entry.startTime < firstHiddenAt) {
        tracker.largestContentfulPaint(entry.startTime - start);
      }
    }
  };
  const handleShifts = (entries: PerformanceEntryList) => {
    for (const entry of entries) {
      tracker.layoutShift(entry as unknown as LayoutShiftLike);
    }
  };
  const handleInteractions = (entries: PerformanceEntryList) => {
    for (const entry of entries) {
      tracker.interaction(entry as unknown as InteractionLike);
    }
  };
  observe("largest-contentful-paint", handleLcp);
  observe("layout-shift", handleShifts);
  observe("event", handleInteractions, { durationThreshold: 16 });
  observe("first-input", handleInteractions);

  const finalizeLcp = () => {
    flush();
    tracker.finalizeLargestContentfulPaint();
  };
  for (const type of ["keydown", "click"]) {
    window.addEventListener(type, finalizeLcp, { capture: true, once: true });
  }

  const pageHidden = () => {
    flush();
    tracker.finalizeLargestContentfulPaint();
    tracker.hidden();
  };
  document.addEventListener(
    "visibilitychange",
    (event) => {
      if (document.visibilityState === "hidden") {
        firstHiddenAt = Math.min(firstHiddenAt, event.timeStamp);
        pageHidden();
      } else {
        tracker.visible(locate());
      }
    },
    { capture: true },
  );
  window.addEventListener("pagehide", pageHidden, { capture: true });
  window.addEventListener(
    "pageshow",
    (event) => {
      if (event.persisted) tracker.visible(locate());
    },
    { capture: true },
  );

  return {
    navigate(kind) {
      flush();
      tracker.navigate(locate(), kind);
    },
  };
}
