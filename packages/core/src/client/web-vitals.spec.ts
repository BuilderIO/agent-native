import { describe, expect, it } from "vitest";

import {
  createWebVitalsTracker,
  type PageViewVitals,
  type WebVitalsLocation,
} from "./web-vitals.js";

function at(pathname: string, route = pathname): WebVitalsLocation {
  return { route, url: `https://app.example.test${pathname}`, pathname };
}

function setup(
  options: {
    measuresLayoutShift?: boolean;
    interactionCount?: () => number;
  } = {},
) {
  const reports: PageViewVitals[] = [];
  const tracker = createWebVitalsTracker({
    measuresLayoutShift: options.measuresLayoutShift ?? true,
    interactionCount: options.interactionCount,
    report: (vitals) => reports.push(vitals),
  });
  return { tracker, reports };
}

describe("createWebVitalsTracker", () => {
  it("reports load metrics once, when the page view ends", () => {
    const { tracker, reports } = setup();
    tracker.startLoad(at("/r/abc", "/r/:id"), 182.4);
    tracker.largestContentfulPaint(900);
    tracker.largestContentfulPaint(2_410.6);
    tracker.finalizeLargestContentfulPaint();
    tracker.largestContentfulPaint(5_000);
    expect(reports).toEqual([]);

    tracker.hidden();
    tracker.hidden();
    expect(reports).toEqual([
      {
        route: "/r/:id",
        url: "https://app.example.test/r/abc",
        navigationType: "load",
        ttfbMs: 182,
        lcpMs: 2_411,
        cls: 0,
      },
    ]);
  });

  it("leaves out metrics the browser could not measure instead of zeroing them", () => {
    const { tracker, reports } = setup({ measuresLayoutShift: false });
    tracker.startLoad(at("/"), undefined);
    tracker.hidden();
    expect(reports).toEqual([]);

    tracker.visible(at("/"));
    tracker.interaction({ interactionId: 7, duration: 96 });
    tracker.hidden();
    expect(reports).toEqual([
      {
        route: "/",
        url: "https://app.example.test/",
        navigationType: "resume",
        inpMs: 96,
      },
    ]);
  });

  it("starts a page view on push, but keeps it through a replace", () => {
    const { tracker, reports } = setup();
    tracker.startLoad(at("/"), 50);
    tracker.navigate(at("/inbox"), "replace");
    tracker.navigate(at("/inbox"), "push");
    expect(reports).toEqual([]);

    tracker.layoutShift({ startTime: 10, value: 0.2, hadRecentInput: false });
    tracker.navigate(at("/thread/42", "/thread/:id"), "push");
    // Client navigations have no document load, so no TTFB or LCP.
    tracker.largestContentfulPaint(300);
    tracker.interaction({ interactionId: 3, duration: 40 });
    tracker.hidden();

    expect(reports).toEqual([
      {
        route: "/inbox",
        url: "https://app.example.test/inbox",
        navigationType: "load",
        ttfbMs: 50,
        cls: 0.2,
      },
      {
        route: "/thread/:id",
        url: "https://app.example.test/thread/42",
        navigationType: "client",
        inpMs: 40,
        cls: 0,
      },
    ]);
  });

  it("measures CLS as the largest session window of shifts", () => {
    const { tracker, reports } = setup();
    tracker.startLoad(at("/"), undefined);
    tracker.layoutShift({ startTime: 0, value: 0.1, hadRecentInput: false });
    tracker.layoutShift({ startTime: 800, value: 0.1, hadRecentInput: false });
    // Shifts right after input are expected, not unexpected.
    tracker.layoutShift({ startTime: 900, value: 0.5, hadRecentInput: true });
    // More than a second after the last shift opens a new window.
    tracker.layoutShift({
      startTime: 2_000,
      value: 0.15,
      hadRecentInput: false,
    });
    tracker.layoutShift({
      startTime: 2_500,
      value: 0.01,
      hadRecentInput: false,
    });
    tracker.hidden();
    expect(reports[0].cls).toBe(0.2);
  });

  it("closes a CLS window after five seconds even with steady shifts", () => {
    const { tracker, reports } = setup();
    tracker.startLoad(at("/"), undefined);
    for (let time = 0; time <= 6_000; time += 500) {
      tracker.layoutShift({
        startTime: time,
        value: 0.01,
        hadRecentInput: false,
      });
    }
    tracker.hidden();
    expect(reports[0].cls).toBe(0.1);
  });

  it("takes INP from each interaction's longest entry, skipping one per 50 interactions", () => {
    let interactions = 0;
    const { tracker, reports } = setup({
      interactionCount: () => interactions,
    });
    tracker.startLoad(at("/"), undefined);
    // keydown and keyup of one interaction count once, at their longest.
    tracker.interaction({ interactionId: 1, duration: 80 });
    tracker.interaction({ interactionId: 1, duration: 480 });
    tracker.interaction({ interactionId: 2, duration: 200 });
    tracker.interaction({ interactionId: 0, duration: 900 });
    interactions = 2;
    tracker.navigate(at("/next"), "push");
    expect(reports[0].inpMs).toBe(480);

    for (let id = 10; id < 70; id += 1) {
      tracker.interaction({
        interactionId: id,
        duration: id === 10 ? 600 : 24,
      });
    }
    interactions = 2 + 60;
    tracker.hidden();
    // 60 interactions: the single longest is treated as an outlier.
    expect(reports[1].inpMs).toBe(24);
  });
});
