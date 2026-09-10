import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  recordLocal: vi.fn(),
  getLocal: vi.fn(),
  hasA2A: vi.fn(),
  callA2A: vi.fn(),
  readAppState: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
}));

vi.mock("../store/generation.js", () => ({
  recordGenerationCreativeContext: mocks.recordLocal,
  getGenerationCreativeContext: mocks.getLocal,
}));

vi.mock("../store/index.js", () => ({
  getContextPack: vi.fn(),
  getCreativeContextItem: vi.fn(),
  listAccessibleSearchDocuments: vi.fn(),
  listCreativeContexts: vi.fn(),
  getCreativeContextById: vi.fn(),
  getCreativeContextAppBinding: vi.fn(),
  createContextPack: vi.fn(),
}));

vi.mock("./retrieval.js", () => ({
  performCreativeContextSearch: vi.fn(),
}));

vi.mock("./isolated-a2a.js", () => ({
  callIsolatedCreativeContextA2A: mocks.callA2A,
  hasIsolatedCreativeContextA2A: mocks.hasA2A,
  isolatedResolvePayload: vi.fn((input) => input),
}));

import {
  getGenerationCreativeContext,
  recordGenerationCreativeContext,
} from "./generation-context.js";

const RANK = {
  viewer: 1,
  commenter: 1,
  editor: 2,
  admin: 3,
  owner: 4,
} as const;

/** Stand in for core's real role check, including its exact refusal wording. */
function grantRole(role: keyof typeof RANK) {
  mocks.assertAccess.mockImplementation(
    async (resourceType: string, resourceId: string, minRole: string) => {
      if (RANK[role] < RANK[minRole as keyof typeof RANK]) {
        throw new Error(
          `Requires ${minRole} role on ${resourceType} ${resourceId} (have ${role})`,
        );
      }
      return { role };
    },
  );
}

const draftRun = {
  appId: "assets",
  artifactType: "generation-run",
  artifactId: "run-1",
  contextMode: "auto" as const,
  contextPackId: null,
  reuseLabels: [],
};

const kit = { resourceType: "asset-library", resourceId: "lib-1" };

describe("generation provenance record role", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestOrgId.mockReturnValue("org-1");
    mocks.getRequestUserEmail.mockReturnValue("viewer@example.test");
    mocks.hasA2A.mockReturnValue(false);
    mocks.readAppState.mockResolvedValue({ contextMode: "auto" });
    mocks.recordLocal.mockResolvedValue({ id: "ccgr-1" });
    mocks.getLocal.mockResolvedValue(null);
    grantRole("editor");
  });

  it("still requires editor by default, so deck/design/document hosts are unchanged", async () => {
    grantRole("viewer");

    await expect(
      recordGenerationCreativeContext(
        { ...draftRun, appId: "slides", artifactType: "deck" },
        { artifactAccess: { resourceType: "deck", resourceId: "deck-1" } },
      ),
    ).rejects.toThrow(/Requires editor role on deck deck-1 \(have viewer\)/);
  });

  it("lets a host declare that recording provenance only needs draft access", async () => {
    grantRole("viewer");

    await recordGenerationCreativeContext(draftRun, {
      artifactAccess: { ...kit, recordMinRole: "viewer" },
    });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "asset-library",
      "lib-1",
      "viewer",
      undefined,
      { skipResourceBody: true },
    );
    // Recorded against the org, not the caller, so an editor reviewing the
    // draft later still sees where it came from.
    expect(mocks.recordLocal).toHaveBeenCalledWith(
      draftRun,
      expect.objectContaining({
        artifactAccess: expect.objectContaining({
          operation: "record",
          verifiedRole: "viewer",
        }),
      }),
    );
  });

  it("still refuses a caller who cannot even read the kit", async () => {
    grantRole("viewer");
    mocks.assertAccess.mockRejectedValue(
      new Error("No access to asset-library lib-1"),
    );

    await expect(
      recordGenerationCreativeContext(draftRun, {
        artifactAccess: { ...kit, recordMinRole: "viewer" },
      }),
    ).rejects.toThrow(/No access to asset-library lib-1/);
    expect(mocks.recordLocal).not.toHaveBeenCalled();
  });

  it("reads a draft's provenance with viewer access, as before", async () => {
    grantRole("viewer");

    await getGenerationCreativeContext(
      { appId: "assets", artifactType: "generation-run", artifactId: "run-1" },
      { artifactAccess: kit },
    );

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "asset-library",
      "lib-1",
      "viewer",
      undefined,
      { skipResourceBody: true },
    );
  });
});
