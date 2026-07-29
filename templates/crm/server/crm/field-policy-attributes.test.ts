import { describe, expect, it } from "vitest";

import {
  crmAttributeAuthorityFor,
  crmAttributeColumnsFor,
} from "./field-policy-attributes.js";

describe("crmAttributeAuthorityFor", () => {
  it("maps local-owned storage policies to matching authority, everything else to provider", () => {
    expect(crmAttributeAuthorityFor("local-authoritative")).toBe(
      "local-authoritative",
    );
    expect(crmAttributeAuthorityFor("derived-local")).toBe("derived-local");
    expect(crmAttributeAuthorityFor("mirrored")).toBe("provider");
    expect(crmAttributeAuthorityFor("remote-only")).toBe("provider");
    expect(crmAttributeAuthorityFor("redacted")).toBe("provider");
  });
});

describe("crmAttributeColumnsFor", () => {
  const baseField = {
    name: "amount",
    label: "Amount",
    valueType: "currency" as const,
    storagePolicy: "local-authoritative" as const,
    sensitive: false,
    readable: true,
    createable: true,
    updateable: true,
    required: false,
  };

  it("falls back to text/no-config for a field with no declared attribute type", () => {
    expect(crmAttributeColumnsFor(baseField, "mirrored")).toEqual({
      attributeType: "text",
      multi: false,
      authority: "provider",
      configJson: "{}",
    });
  });

  it("carries a declared attribute type, multi flag, and config through", () => {
    const field = {
      ...baseField,
      attributeType: "currency" as const,
      config: { currency: { code: "USD" } },
    };
    expect(crmAttributeColumnsFor(field, "local-authoritative")).toEqual({
      attributeType: "currency",
      multi: false,
      authority: "local-authoritative",
      configJson: JSON.stringify({ currency: { code: "USD" } }),
    });
  });
});
