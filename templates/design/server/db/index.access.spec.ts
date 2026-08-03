import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerShareableResource: vi.fn(),
}));

vi.mock("@agent-native/core/db", () => ({
  createGetDb: vi.fn(() => vi.fn()),
}));

vi.mock("@agent-native/core/sharing", () => ({
  registerShareableResource: mocks.registerShareableResource,
}));

vi.mock("./schema.js", () => ({
  designs: { id: "designs.id" },
  designShares: { resourceId: "designShares.resourceId" },
  designTemplates: { id: "designTemplates.id" },
  designTemplateShares: {
    resourceId: "designTemplateShares.resourceId",
  },
  designSystems: { id: "designSystems.id" },
  designSystemShares: { resourceId: "designSystemShares.resourceId" },
}));

import "./index.js";

describe("design share registration", () => {
  it("keeps owners editable after switching active organizations", () => {
    const registration = mocks.registerShareableResource.mock.calls
      .map(([value]) => value)
      .find((value) => value.type === "design");

    expect(registration?.ownerAccessIgnoresOrg).toBe(true);
  });

  const designRegistration = () =>
    mocks.registerShareableResource.mock.calls
      .map(([value]) => value)
      .find((value) => value.type === "design");

  it("registers a capability-aware public role without ambient editor access", () => {
    const registration = designRegistration();

    expect(registration).toBeDefined();
    expect(registration.publicAccessRole).toBeTypeOf("function");
    expect(
      registration.publicAccessRole(
        {
          id: "design_1",
          data: JSON.stringify({ sourceType: "localhost" }),
        },
        {},
      ),
    ).toBe("viewer");
  });
});
