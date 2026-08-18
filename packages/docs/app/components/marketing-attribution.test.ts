import { describe, expect, it } from "vitest";

import { appendFirstTouchAttribution } from "./marketing-attribution";

describe("appendFirstTouchAttribution", () => {
  it("passes first-touch referral fields to the app URL", () => {
    const target = appendFirstTouchAttribution(
      "https://clips.agent-native.com",
      {
        ref: "newsletter",
        via: "owner_42",
        utm_source: "email",
        utm_medium: "lifecycle",
        utm_campaign: "launch",
      },
    );

    const url = new URL(target);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      ref: "newsletter",
      via: "owner_42",
      utm_source: "email",
      utm_medium: "lifecycle",
      utm_campaign: "launch",
    });
  });

  it("preserves explicit destination attribution values", () => {
    const target = appendFirstTouchAttribution(
      "https://clips.agent-native.com/?utm_source=destination",
      { utm_source: "first-touch", utm_campaign: "launch" },
    );

    const url = new URL(target);
    expect(url.searchParams.get("utm_source")).toBe("destination");
    expect(url.searchParams.get("utm_campaign")).toBe("launch");
  });

  it("leaves invalid URLs unchanged", () => {
    expect(
      appendFirstTouchAttribution("not a URL", { utm_source: "email" }),
    ).toBe("not a URL");
  });
});
