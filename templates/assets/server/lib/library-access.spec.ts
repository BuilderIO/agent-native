import { beforeEach, describe, expect, it, vi } from "vitest";

const assertAccessMock = vi.hoisted(() => vi.fn());
const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());

const ROLE_ORDER = ["viewer", "commenter", "editor", "admin", "owner"];

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
  roleSatisfies: (actual: string, minimum: string) =>
    ROLE_ORDER.indexOf(actual) >= ROLE_ORDER.indexOf(minimum),
  ForbiddenError: class ForbiddenError extends Error {
    statusCode = 403;
  },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: getRequestUserEmailMock,
}));

vi.mock("../db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    assetGenerationRuns: {
      id: "image_generation_runs.id",
      ownerEmail: "image_generation_runs.owner_email",
    },
  },
}));

import {
  assertCanApprove,
  assertCanDeleteAsset,
  assertCanDraft,
  assertCanDraftAuthoredBy,
} from "./library-access.js";

function grantRole(role: string) {
  assertAccessMock.mockImplementation(async (_type, _id, minRole) => {
    if (ROLE_ORDER.indexOf(role) < ROLE_ORDER.indexOf(minRole)) {
      throw new Error(`Requires ${minRole} role (have ${role})`);
    }
    return { role };
  });
}

function dbWithRunAuthor(ownerEmail: string | null) {
  getDbMock.mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (ownerEmail === null ? [] : [{ ownerEmail }]),
        }),
      }),
    }),
  });
}

describe("library-access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestUserEmailMock.mockReturnValue("viewer@example.test");
  });

  it("lets a viewer draft, and says they cannot approve", async () => {
    grantRole("viewer");

    await expect(assertCanDraft("lib-1")).resolves.toEqual({
      role: "viewer",
      canApprove: false,
    });
    // Drafting must not cost more than reading the kit.
    expect(assertAccessMock).toHaveBeenCalledWith(
      "asset-library",
      "lib-1",
      "viewer",
      undefined,
      { skipResourceBody: true },
    );
  });

  it("refuses a viewer's approval with a remedy the agent can classify", async () => {
    grantRole("viewer");

    let error: (Error & { statusCode?: number }) | undefined;
    try {
      await assertCanApprove("lib-1", "Saving a draft");
    } catch (err) {
      error = err as Error & { statusCode?: number };
    }

    // The leading clause is load-bearing: core's permanent-precondition
    // classifier matches `requires <role> role` and ends the turn instead of
    // retrying a grant the model cannot obtain.
    expect(error?.message).toMatch(/^Requires editor role on asset-library/);
    expect(error?.message).toContain("(have viewer)");
    expect(error?.message).toContain("Saving a draft");
    expect(error?.statusCode).toBe(403);
  });

  it("lets an editor approve", async () => {
    grantRole("editor");

    await expect(assertCanApprove("lib-1", "Saving a draft")).resolves.toEqual({
      role: "editor",
      canApprove: true,
    });
  });

  it("keeps a viewer out of someone else's drafting session", async () => {
    grantRole("viewer");

    await expect(
      assertCanDraftAuthoredBy("lib-1", "viewer@example.test", "A session"),
    ).resolves.toMatchObject({ canApprove: false });

    await expect(
      assertCanDraftAuthoredBy("lib-1", "someone@example.test", "A session"),
    ).rejects.toThrow(/Requires editor role/);

    // Legacy rows with no recorded author are not up for grabs.
    await expect(
      assertCanDraftAuthoredBy("lib-1", null, "A session"),
    ).rejects.toThrow(/Requires editor role/);
  });

  it("lets a draft author discard their own unsaved candidate only", async () => {
    grantRole("viewer");
    dbWithRunAuthor("viewer@example.test");

    await expect(
      assertCanDeleteAsset({
        libraryId: "lib-1",
        role: "generated",
        status: "candidate",
        generationRunId: "run-1",
      }),
    ).resolves.toMatchObject({ canApprove: false });

    // Saved kit content is approving-class no matter who generated it.
    await expect(
      assertCanDeleteAsset({
        libraryId: "lib-1",
        role: "generated",
        status: "saved",
        generationRunId: "run-1",
      }),
    ).rejects.toThrow(/Requires editor role/);

    dbWithRunAuthor("someone@example.test");
    await expect(
      assertCanDeleteAsset({
        libraryId: "lib-1",
        role: "generated",
        status: "candidate",
        generationRunId: "run-1",
      }),
    ).rejects.toThrow(/Requires editor role/);
  });
});
