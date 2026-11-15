import { describe, expect, it } from "vitest";

import {
  readTrafficEnvironment,
  readTrafficFilterValue,
  trafficEnvironmentOfHost,
  withNewDashboardTrafficFilter,
  withTrafficFilterOf,
} from "./traffic-environment";

describe("trafficEnvironmentOfHost", () => {
  it.each([
    "beta.slides.agent-native.com",
    "BETA.slides.agent-native.com",
    "localhost",
    "slides.localhost",
    "127.0.0.1",
    "0.0.0.0",
    "[::1]",
    "machine.local",
    "slides.test",
    "preview-8730--an-slides.netlify.app",
  ])("counts %s as beta", (hostname) => {
    expect(trafficEnvironmentOfHost(hostname)).toBe("beta");
  });

  it.each([
    "slides.agent-native.com",
    "www.agent-native.com",
    "app.customer.example",
    "betamax.example",
    "my.beta.example",
    "localhost.example",
    "netlify.app.example",
  ])("counts %s as production", (hostname) => {
    expect(trafficEnvironmentOfHost(hostname)).toBe("production");
  });

  it.each([null, undefined, ""])(
    "has no answer for a host of %j",
    (hostname) => {
      expect(trafficEnvironmentOfHost(hostname)).toBeNull();
    },
  );
});

describe("withNewDashboardTrafficFilter", () => {
  it("starts a new dashboard on production, after its own filters", () => {
    const own = { id: "app", label: "App", type: "select" };

    const config = withNewDashboardTrafficFilter({
      panels: [],
      filters: [own],
    });

    expect(config.panels).toEqual([]);
    expect(config.filters).toEqual([
      own,
      expect.objectContaining({
        id: "traffic_environment",
        type: "select",
        default: "production",
      }),
    ]);
  });

  it("adds it to a config with no filters", () => {
    const config: { filters?: unknown } = {};

    expect(withNewDashboardTrafficFilter(config).filters).toHaveLength(1);
  });

  it("leaves a dashboard that already chose alone", () => {
    const config = {
      filters: [{ id: "traffic_environment", default: "beta" }],
    };

    expect(withNewDashboardTrafficFilter(config)).toBe(config);
  });
});

describe("withTrafficFilterOf", () => {
  const traffic = { id: "traffic_environment", default: "beta" };

  it("carries the choice onto the rebuilt config", () => {
    const own = { id: "app" };

    expect(
      withTrafficFilterOf({ filters: [traffic] }, { filters: [own] }).filters,
    ).toEqual([own, traffic]);
  });

  it("gives nothing to a dashboard that never chose", () => {
    const rebuilt = { filters: [{ id: "app" }] };

    expect(withTrafficFilterOf({ filters: [] }, rebuilt)).toBe(rebuilt);
  });
});

describe("readTrafficEnvironment", () => {
  it("reads the two environments and nothing else", () => {
    expect(readTrafficEnvironment("production")).toBe("production");
    expect(readTrafficEnvironment("beta")).toBe("beta");
    expect(readTrafficEnvironment("all")).toBeUndefined();
    expect(readTrafficEnvironment("")).toBeUndefined();
    expect(readTrafficEnvironment(null)).toBeUndefined();
  });
});

describe("readTrafficFilterValue", () => {
  it("reads all traffic and no choice as no environment", () => {
    expect(readTrafficFilterValue("all")).toBeUndefined();
    expect(readTrafficFilterValue("")).toBeUndefined();
    expect(readTrafficFilterValue(undefined)).toBeUndefined();
  });

  it("reads production and beta", () => {
    expect(readTrafficFilterValue("production")).toBe("production");
    expect(readTrafficFilterValue("beta")).toBe("beta");
  });

  it("refuses a value the filter doesn't offer rather than reading all traffic", () => {
    expect(() => readTrafficFilterValue("staging")).toThrow(
      'The traffic filter is "staging". Set f_traffic_environment to all, production or beta.',
    );
  });
});
