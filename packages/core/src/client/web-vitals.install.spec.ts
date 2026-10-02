// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { installWebVitals, type PageViewVitals } from "./web-vitals.js";

type ObserverCallback = (list: { getEntries: () => unknown[] }) => void;

describe("installWebVitals", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
        url: "https://app.example.test/r/1",
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
        url: "https://app.example.test/r/1",
        navigationType: "load",
        lcpMs: 1_200,
      },
    ]);
  });
});
