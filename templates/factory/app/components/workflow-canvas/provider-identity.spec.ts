import { describe, expect, it } from "vitest";

import { providerIdentity } from "./provider-identity";

describe("providerIdentity", () => {
  it("falls back to a capitalized label and its letter for an unknown provider", () => {
    expect(providerIdentity("acme")).toEqual({
      label: "Acme",
      letter: "A",
      hue: null,
      icon: null,
    });
  });

  it("uses the brand name, hue and letter of a known provider", () => {
    expect(providerIdentity("hubspot")).toMatchObject({
      label: "HubSpot",
      letter: "H",
      hue: "hubspot",
      icon: null,
    });
  });
});
