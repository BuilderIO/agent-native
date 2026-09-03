import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getRequestUserEmail: vi.fn(),
  getRequestOrgId: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
  getRequestOrgId: mocks.getRequestOrgId,
}));

import {
  assertGenerationArtifactAccessProof,
  createGenerationArtifactAccessCapability,
  verifyGenerationArtifactAccessCapability,
} from "./generation-artifact-access.js";

const originalKey = process.env.CREATIVE_CONTEXT_A2A_KEY;
const identity = {
  appId: "slides",
  artifactType: "deck",
  artifactId: "deck-1",
};

describe("generation artifact access capabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CREATIVE_CONTEXT_A2A_KEY = "test-capability-signing-key";
    mocks.getRequestUserEmail.mockReturnValue("alice@example.test");
    mocks.getRequestOrgId.mockReturnValue("org-1");
    mocks.assertAccess.mockResolvedValue({ role: "editor" });
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CREATIVE_CONTEXT_A2A_KEY;
    else process.env.CREATIVE_CONTEXT_A2A_KEY = originalKey;
  });

  it("mints a short-lived capability only after host artifact access succeeds", async () => {
    const token = await createGenerationArtifactAccessCapability(
      identity,
      { resourceType: "deck", resourceId: "deck-1" },
      "record",
    );
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "deck",
      "deck-1",
      "editor",
      undefined,
      { skipResourceBody: true },
    );

    const proof = await verifyGenerationArtifactAccessCapability(
      token,
      identity,
      "record",
    );
    expect(() =>
      assertGenerationArtifactAccessProof(identity, proof, "editor"),
    ).not.toThrow();
  });

  it("binds the capability to caller, artifact identity, and operation", async () => {
    const token = await createGenerationArtifactAccessCapability(
      identity,
      { resourceType: "deck", resourceId: "deck-1" },
      "read",
    );

    await expect(
      verifyGenerationArtifactAccessCapability(
        token,
        { ...identity, artifactId: "guessed-deck" },
        "read",
      ),
    ).rejects.toThrow(/invalid generation artifact access capability/i);
    await expect(
      verifyGenerationArtifactAccessCapability(token, identity, "record"),
    ).rejects.toThrow(/invalid generation artifact access capability/i);
    mocks.getRequestUserEmail.mockReturnValue("mallory@example.test");
    await expect(
      verifyGenerationArtifactAccessCapability(token, identity, "read"),
    ).rejects.toThrow(/invalid generation artifact access capability/i);
  });

  it("rejects forged capability bytes", async () => {
    const token = await createGenerationArtifactAccessCapability(
      identity,
      { resourceType: "deck", resourceId: "deck-1" },
      "read",
    );
    const forged = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

    await expect(
      verifyGenerationArtifactAccessCapability(forged, identity, "read"),
    ).rejects.toThrow(/invalid generation artifact access capability/i);
  });
});
