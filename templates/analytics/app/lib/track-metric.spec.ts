import { afterEach, describe, expect, it, vi } from "vitest";

const getIdToken = vi.hoisted(() => vi.fn(async () => "token"));

vi.mock("./auth", () => ({ getIdToken }));

import { trackMetricViewed } from "./track-metric";

describe("trackMetricViewed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    getIdToken.mockClear();
  });

  it("does not emit synthetic browser events or read the user token", async () => {
    vi.stubGlobal("window", {
      __AGENT_NATIVE_SYNTHETIC_TRAFFIC__: "beta-e2e",
    });
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("navigator", { sendBeacon: vi.fn() });

    await trackMetricViewed("Revenue", "dashboard-1");

    expect(getIdToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(navigator.sendBeacon).not.toHaveBeenCalled();
  });
});
