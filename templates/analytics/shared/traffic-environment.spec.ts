import { describe, expect, it } from "vitest";

import {
  readTrafficEnvironment,
  trafficEnvironmentOfHost,
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

describe("readTrafficEnvironment", () => {
  it("reads the two environments and nothing else", () => {
    expect(readTrafficEnvironment("production")).toBe("production");
    expect(readTrafficEnvironment("beta")).toBe("beta");
    expect(readTrafficEnvironment("all")).toBeUndefined();
    expect(readTrafficEnvironment("")).toBeUndefined();
    expect(readTrafficEnvironment(null)).toBeUndefined();
  });
});
