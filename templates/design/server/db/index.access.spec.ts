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
  designSystems: { id: "designSystems.id" },
  designSystemShares: { resourceId: "designSystemShares.resourceId" },
}));

import "./index.js";

describe("design share registration", () => {
  it("never upgrades a public loopback design above viewer", () => {
    const registration = mocks.registerShareableResource.mock.calls
      .map(([value]) => value)
      .find((value) => value.type === "design");

    expect(registration).toBeDefined();
    expect(
      registration.publicAccessRole({
        visibility: "public",
        data: JSON.stringify({
          sourceMode: "localhost",
          screenMetadata: {
            home: {
              sourceType: "localhost",
              url: "http://localhost:5173/",
              bridgeUrl: "http://127.0.0.1:7331",
            },
          },
        }),
      }),
    ).toBe("viewer");
  });
});
