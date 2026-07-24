import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureException,
  registerTrackingProvider,
  unregisterTrackingProvider,
} from "./index.js";

describe("tracking captureException", () => {
  afterEach(() => {
    unregisterTrackingProvider("qa-exception");
    vi.unstubAllEnvs();
  });

  it("sends a bounded, redacted Node exception event", () => {
    const track = vi.fn();
    registerTrackingProvider({ name: "qa-exception", track });

    const error = new Error(
      "Request failed authorization=secret-token and bearer abc123",
    );
    error.stack = `${error.stack}\n${"x".repeat(10_000)}`;
    captureException(error, {
      handled: false,
      runtime: "node",
      source: "server",
      route: "/api/recordings",
      tags: { feature: "recording" },
      extra: { authorization: "secret", attempt: 2 },
    });

    expect(track).toHaveBeenCalledTimes(1);
    const [event] = track.mock.calls[0];
    const { properties } = event;
    expect(event.name).toBe("$exception");
    expect(properties).toMatchObject({
      exceptionType: "Error",
      handled: false,
      runtime: "node",
      source: "server",
      url: "/api/recordings",
      exceptionTags: { feature: "recording" },
      exceptionExtra: { authorization: "<redacted>", attempt: 2 },
    });
    expect(properties.exceptionMessage).not.toContain("secret-token");
    expect(properties.exceptionStack.length).toBeLessThanOrEqual(8000);
  });
});
