import { afterEach, describe, expect, it } from "vitest";

import {
  registerTrackingProvider,
  track,
  unregisterTrackingProvider,
} from "./registry.js";
import {
  MAX_TRACK_EVENT_NAME_LENGTH,
  MAX_TRACK_PROPERTIES_BYTES,
  validateTrackPayload,
} from "./route.js";
import type { TrackingEvent } from "./types.js";

describe("validateTrackPayload", () => {
  it("accepts a non-empty name and trims it", () => {
    const result = validateTrackPayload({ name: "  order.completed  " });
    expect(result.ok).toBe(true);
    expect(result.name).toBe("order.completed");
    expect(result.properties).toBeUndefined();
  });

  it("accepts a plain properties object", () => {
    const result = validateTrackPayload({
      name: "meal.logged",
      properties: { calories: 350, mealName: "Salad" },
    });
    expect(result.ok).toBe(true);
    expect(result.properties).toEqual({ calories: 350, mealName: "Salad" });
  });

  it("rejects a non-object body", () => {
    expect(validateTrackPayload(undefined).ok).toBe(false);
    expect(validateTrackPayload(null).ok).toBe(false);
    expect(validateTrackPayload("nope").ok).toBe(false);
    expect(validateTrackPayload([]).ok).toBe(false);
  });

  it("rejects a missing or empty name", () => {
    expect(validateTrackPayload({}).ok).toBe(false);
    expect(validateTrackPayload({ name: "" }).ok).toBe(false);
    expect(validateTrackPayload({ name: "   " }).ok).toBe(false);
    expect(validateTrackPayload({ name: 123 }).ok).toBe(false);
  });

  it("rejects an over-long name", () => {
    const longName = "x".repeat(MAX_TRACK_EVENT_NAME_LENGTH + 1);
    expect(validateTrackPayload({ name: longName }).ok).toBe(false);
    const maxName = "x".repeat(MAX_TRACK_EVENT_NAME_LENGTH);
    expect(validateTrackPayload({ name: maxName }).ok).toBe(true);
    const paddedMaxName = `  ${maxName}  `;
    const result = validateTrackPayload({ name: paddedMaxName });
    expect(result.ok).toBe(true);
    expect(result.name).toBe(maxName);
  });

  it("rejects non-plain-object properties", () => {
    expect(validateTrackPayload({ name: "e", properties: [1, 2, 3] }).ok).toBe(
      false,
    );
    expect(validateTrackPayload({ name: "e", properties: "string" }).ok).toBe(
      false,
    );
  });

  it("rejects oversized properties", () => {
    const big = { blob: "x".repeat(MAX_TRACK_PROPERTIES_BYTES) };
    expect(validateTrackPayload({ name: "e", properties: big }).ok).toBe(false);
  });
});

describe("track route forwarding", () => {
  const captured: TrackingEvent[] = [];

  afterEach(() => {
    unregisterTrackingProvider("qa-route-capture");
    captured.length = 0;
  });

  it("forwards a validated client event to registered providers", () => {
    registerTrackingProvider({
      name: "qa-route-capture",
      track(event) {
        captured.push(event);
      },
    });

    // Mirror the route handler: validate, then forward with server-resolved
    // attribution merged into properties.
    const validation = validateTrackPayload({
      name: "checkout.completed",
      properties: { total: 49.99 },
    });
    expect(validation.ok).toBe(true);

    track(
      validation.name as string,
      { ...(validation.properties ?? {}), source: "client", org_id: "org_1" },
      { userId: "steve@builder.io" },
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      name: "checkout.completed",
      userId: "steve@builder.io",
      properties: { total: 49.99, source: "client", org_id: "org_1" },
    });
  });
});
