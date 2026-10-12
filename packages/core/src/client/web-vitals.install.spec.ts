// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { installWebVitals, type PageViewVitals } from "./web-vitals.js";

type ObserverCallback = (list: { getEntries: () => unknown[] }) => void;

describe("installWebVitals", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("leaves CLS out when the browser refuses to observe layout shifts", () => {
    const callbacks = new Map<string, ObserverCallback>();
    class RefusingLayoutShiftObserver {
      static supportedEntryTypes = ["largest-contentful-paint", "layout-shift"];
      constructor(private readonly callback: ObserverCallback) {}
      observe(options: { type: string }) {
        if (options.type === "layout-shift") {
          throw new TypeError("layout-shift is not observable here");
        }
        callbacks.set(options.type, this.callback);
      }
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal("PerformanceObserver", RefusingLayoutShiftObserver);
    const reports: PageViewVitals[] = [];

    installWebVitals(
      () => ({
        route: "/r/:id",
        pathname: "/r/1",
      }),
      (vitals) => reports.push(vitals),
    );
    callbacks.get("largest-contentful-paint")?.({
      getEntries: () => [{ startTime: 1_200 }],
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(reports).toEqual([
      {
        route: "/r/:id",
        navigationType: "load",
        lcpMs: 1_200,
      },
    ]);
  });
  it("drops a load in a background tab, so the first visible stretch is a resume", () => {
    const callbacks = new Map<string, ObserverCallback>();
    class Observer {
      static supportedEntryTypes = ["event", "layout-shift"];
      constructor(private readonly callback: ObserverCallback) {}
      observe(options: { type: string }) {
        callbacks.set(options.type, this.callback);
      }
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal("PerformanceObserver", Observer);
    const setVisibility = (state: "hidden" | "visible") => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: state,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    // The document's navigation timing has a TTFB, which a reported load
    // would carry.
    vi.spyOn(performance, "getEntriesByType").mockImplementation((type) =>
      type === "navigation"
        ? ([{ responseStart: 80 }] as unknown as PerformanceEntryList)
        : [],
    );
    vi.spyOn(performance, "now").mockReturnValue(5_000);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    const reports: PageViewVitals[] = [];

    installWebVitals(
      () => ({ route: "/r/:id", pathname: "/r/1" }),
      (vitals) => reports.push(vitals),
    );
    setVisibility("visible");
    callbacks.get("event")?.({
      getEntries: () => [{ interactionId: 1, duration: 120 }],
    });
    setVisibility("hidden");

    expect(reports).toEqual([
      { route: "/r/:id", navigationType: "resume", inpMs: 120, cls: 0 },
    ]);
  });
});
