// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, string>) =>
    values?.time ? `${key}(${values.time})` : key,
  useFormatters: () => ({
    formatDate: (value: string, options?: { dateStyle?: string }) =>
      options?.dateStyle ? `full:${value}` : `formatted:${value}`,
  }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";

import { PanelFreshnessClock } from "./PanelFreshnessClock";

const FETCHED_AT = "2026-10-14T12:00:00.000Z";

describe("PanelFreshnessClock", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = (
    freshness: Parameters<typeof PanelFreshnessClock>[0]["freshness"],
  ) =>
    act(async () => {
      root.render(
        <TooltipProvider>
          <PanelFreshnessClock freshness={freshness} />
        </TooltipProvider>,
      );
    });
  const button = () => container.querySelector("button")!;
  const tooltip = () =>
    document.body.querySelector("[data-agent-native-tooltip]");

  it("names the full timestamp and cache state as the button's accessible name", async () => {
    await render({ fetchedAt: FETCHED_AT, cache: "app-cache" });

    expect(button().getAttribute("aria-label")).toBe(
      `sqlDashboard.fetchedAt(full:${FETCHED_AT}) · sqlDashboard.cacheApp`,
    );
    expect(button().getAttribute("type")).toBe("button");
  });

  it("opens on keyboard focus so the full timestamp can be read without a pointer", async () => {
    await render({ fetchedAt: FETCHED_AT, cache: "live" });
    expect(tooltip()).toBeNull();

    await act(async () => button().focus());

    expect(tooltip()?.textContent).toContain(
      `sqlDashboard.fetchedAt(full:${FETCHED_AT})`,
    );
  });

  it("opens on a tap, where hover and focus never fire", async () => {
    await render({ fetchedAt: FETCHED_AT, cache: "provider-cache" });

    await act(async () => button().click());

    expect(tooltip()?.textContent).toContain("sqlDashboard.cacheProvider");
  });

  it("says plainly when the fetch time and cache state are unknown", async () => {
    await render({ cache: "unknown" });

    expect(button().getAttribute("aria-label")).toBe(
      "sqlDashboard.fetchTimeUnknown · sqlDashboard.cacheUnknown",
    );
  });

  it("names a live result by its time alone, with no cache suffix", async () => {
    await render({ fetchedAt: FETCHED_AT, cache: "live" });

    expect(button().getAttribute("aria-label")).toBe(
      `sqlDashboard.fetchedAt(full:${FETCHED_AT})`,
    );
  });
});
