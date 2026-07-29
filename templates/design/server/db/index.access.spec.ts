import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerShareableResource: vi.fn(),
  isLoopback: vi.fn(() => false),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestIsLoopback: mocks.isLoopback,
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

  const localhostDesign = {
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
  };

  it("never upgrades a public localhost design for a REMOTE caller", () => {
    // The previewToken this role releases unlocks the loopback bridge. Handing
    // it to a remote viewer of a shared design would let an attacker page
    // drive the victim's local bridge through their browser.
    mocks.isLoopback.mockReturnValue(false);
    const registration = designRegistration();

    expect(registration).toBeDefined();
    expect(registration.publicAccessRole(localhostDesign)).toBe("viewer");
  });

  it("upgrades a public localhost design to editor for a LOOPBACK caller", () => {
    // /visual-edit must not require a login: the caller already owns the dev
    // server's files outright.
    mocks.isLoopback.mockReturnValue(true);

    expect(designRegistration().publicAccessRole(localhostDesign)).toBe(
      "editor",
    );
  });

  it("leaves an inline design read-only even for a loopback caller", () => {
    // Loopback alone must never unlock a design; a tunnel terminating on
    // localhost also presents as loopback.
    mocks.isLoopback.mockReturnValue(true);

    expect(
      designRegistration().publicAccessRole({
        visibility: "public",
        data: JSON.stringify({ sourceMode: "inline" }),
      }),
    ).toBe("viewer");
  });
});
