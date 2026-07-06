import { describe, expect, it } from "vitest";

import { ownerDisplayName, visibilityLabelKey } from "./resource-metadata";

describe("resource metadata labels", () => {
  it("uses the email local part as the compact owner label", () => {
    expect(ownerDisplayName("steve@builder.io")).toBe("steve");
    expect(ownerDisplayName("  devrel@example.com  ")).toBe("devrel");
  });

  it("omits blank owner labels", () => {
    expect(ownerDisplayName(null)).toBeNull();
    expect(ownerDisplayName("   ")).toBeNull();
  });

  it("maps visibility states to sidebar label keys", () => {
    expect(visibilityLabelKey("private")).toBe("sidebar.visibilityPrivate");
    expect(visibilityLabelKey("org")).toBe("sidebar.visibilityOrg");
    expect(visibilityLabelKey("public")).toBe("sidebar.visibilityPublic");
  });
});
