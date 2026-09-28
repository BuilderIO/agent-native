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
    assets: {
      id: "image_assets.id",
      libraryId: "image_assets.library_id",
      role: "image_assets.role",
      status: "image_assets.status",
    },
    assetGenerationRuns: {
      id: "image_generation_runs.id",
      ownerEmail: "image_generation_runs.owner_email",
      libraryId: "image_generation_runs.library_id",
    },
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: vi.fn((column, value) => ({ column, value })),
  inArray: vi.fn((column, values) => ({ column, values })),
  and: vi.fn((...conditions) => ({ conditions })),
}));

import {
  assertCanApprove,
  assertCanDeleteAsset,
  assertCanDraft,
  assertCanDraftAuthoredBy,
  assertCanUseAssets,
  assertCanUseRuns,
  canReadDraftAsset,
  canReadRun,
  canReadSession,
  deleteDraftAssetIfUnchanged,
  DRAFT_ROLE,
  draftProvenanceAccess,
  draftReadFilter,
  resolveDraftReadScope,
  runReadFilter,
  sessionReadFilter,
  unrestrictedDraftReadScope,
} from "./library-access.js";

function grantRole(role: string) {
  assertAccessMock.mockImplementation(async (_type, _id, minRole) => {
    if (ROLE_ORDER.indexOf(role) < ROLE_ORDER.indexOf(minRole)) {
      throw new Error(`Requires ${minRole} role (have ${role})`);
    }
    return { role };
  });
}

function dbWithRuns(runs: Array<{ id: string; ownerEmail: string }>) {
  getDbMock.mockReturnValue({
    select: () => ({
      from: () => ({
        where: async () => runs,
      }),
    }),
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
    expect(assertAccessMock).toHaveBeenCalledWith(
      "asset-library",
      "lib-1",
      "viewer",
      undefined,
      { skipResourceBody: true },
    );
  });

  it("declares draft provenance as draft work, so a viewer can record it", async () => {
    expect(draftProvenanceAccess("lib-1")).toEqual({
      resourceType: "asset-library",
      resourceId: "lib-1",
      recordMinRole: DRAFT_ROLE,
    });
  });

  it("refuses a viewer's approval with a remedy the agent can classify", async () => {
    grantRole("viewer");

    let error: (Error & { statusCode?: number }) | undefined;
    try {
      await assertCanApprove("lib-1", "Saving a draft");
    } catch (err) {
      error = err as Error & { statusCode?: number };
    }

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

    await expect(
      assertCanDraftAuthoredBy("lib-1", null, "A session"),
    ).rejects.toThrow(/Requires editor role/);
  });

  it("narrows drafts to the caller's own where they cannot approve", async () => {
    grantRole("viewer");
    dbWithRuns([
      { id: "run-mine", ownerEmail: "viewer@example.test" },
      { id: "run-theirs", ownerEmail: "someone@example.test" },
    ]);

    const scope = await resolveDraftReadScope(["lib-1"]);

    const draft = (generationRunId: string | null) => ({
      libraryId: "lib-1",
      role: "generated",
      status: "candidate",
      generationRunId,
    });
    expect(canReadDraftAsset(scope, draft("run-mine"))).toBe(true);
    expect(canReadDraftAsset(scope, draft("run-theirs"))).toBe(false);
    expect(canReadDraftAsset(scope, draft(null))).toBe(false);
    // Saved kit content is never narrowed by the draft scope.
    expect(
      canReadDraftAsset(scope, {
        libraryId: "lib-1",
        role: "generated",
        status: "saved",
        generationRunId: "run-theirs",
      }),
    ).toBe(true);
    expect(canReadRun(scope, { id: "run-mine", libraryId: "lib-1" })).toBe(
      true,
    );
    expect(canReadRun(scope, { id: "run-theirs", libraryId: "lib-1" })).toBe(
      false,
    );
  });

  it("skips the run lookup entirely for an approver", async () => {
    grantRole("editor");
    dbWithRuns([]);

    const scope = await resolveDraftReadScope(["lib-1"]);

    expect(scope.unrestricted).toBe(true);
    expect(scope.callerEmail).toBe("viewer@example.test");
    expect(getDbMock).not.toHaveBeenCalled();
    expect(
      canReadDraftAsset(scope, {
        libraryId: "lib-1",
        role: "generated",
        status: "candidate",
        generationRunId: "run-theirs",
      }),
    ).toBe(true);
  });

  it("refuses another drafter's candidate as a generation or session input", async () => {
    grantRole("viewer");
    dbWithRuns([
      { id: "run-mine", ownerEmail: "viewer@example.test" },
      { id: "run-theirs", ownerEmail: "someone@example.test" },
    ]);
    const scope = await resolveDraftReadScope(["lib-1"]);
    const draft = (id: string, generationRunId: string) => ({
      id,
      libraryId: "lib-1",
      role: "generated",
      status: "candidate",
      generationRunId,
    });

    expect(() =>
      assertCanUseAssets(
        scope,
        "lib-1",
        "viewer",
        [draft("asset-mine", "run-mine")],
        "This generation",
      ),
    ).not.toThrow();
    expect(() =>
      assertCanUseAssets(
        scope,
        "lib-1",
        "viewer",
        [draft("asset-theirs", "run-theirs")],
        "This generation",
      ),
    ).toThrow(/Requires editor role .* draft asset-theirs/s);
    expect(() =>
      assertCanUseRuns(
        scope,
        "lib-1",
        "viewer",
        [{ id: "run-theirs", libraryId: "lib-1" }],
        "A generation session",
      ),
    ).toThrow(/generation run run-theirs/);
  });

  it("narrows drafts in SQL so paging cannot hide the caller's own", async () => {
    grantRole("viewer");
    dbWithRuns([{ id: "run-mine", ownerEmail: "viewer@example.test" }]);
    const scope = await resolveDraftReadScope(["lib-1"]);

    const table = {
      libraryId: "image_assets.library_id",
      generationRunId: "image_assets.generation_run_id",
    } as never;
    expect(draftReadFilter(scope, table)).toBeDefined();
    expect(
      draftReadFilter(unrestrictedDraftReadScope(), table),
    ).toBeUndefined();

    const emptyScope = {
      unrestricted: false,
      approvableLibraryIds: new Set<string>(),
      ownRunIds: new Set<string>(),
      callerEmail: "viewer@example.test",
    };
    expect(draftReadFilter(emptyScope, table)).toBeDefined();
  });

  it("keeps a below-approver caller to the sessions they created", async () => {
    grantRole("viewer");
    dbWithRuns([]);
    const scope = await resolveDraftReadScope(["lib-1"]);

    expect(
      canReadSession(scope, {
        libraryId: "lib-1",
        createdBy: "viewer@example.test",
      }),
    ).toBe(true);
    expect(
      canReadSession(scope, {
        libraryId: "lib-1",
        createdBy: "someone@example.test",
      }),
    ).toBe(false);
    expect(canReadSession(scope, { libraryId: "lib-1", createdBy: null })).toBe(
      false,
    );
    expect(
      canReadSession(unrestrictedDraftReadScope(), {
        libraryId: "lib-1",
        createdBy: "someone@example.test",
      }),
    ).toBe(true);
  });

  it("narrows run and session queries in SQL, not after the limit", async () => {
    grantRole("viewer");
    dbWithRuns([{ id: "run-mine", ownerEmail: "viewer@example.test" }]);
    const scope = await resolveDraftReadScope(["lib-1"]);

    expect(
      runReadFilter(scope, {
        id: "image_generation_runs.id",
        libraryId: "image_generation_runs.library_id",
      } as never),
    ).toBeDefined();
    expect(
      sessionReadFilter(scope, {
        libraryId: "image_generation_sessions.library_id",
        createdBy: "image_generation_sessions.created_by",
      } as never),
    ).toBeDefined();
    expect(
      runReadFilter(unrestrictedDraftReadScope(), {
        id: "image_generation_runs.id",
        libraryId: "image_generation_runs.library_id",
      } as never),
    ).toBeUndefined();
  });

  it("lets a concurrent approval survive a draft delete", async () => {
    const table = new Map<string, { id: string; status: string }>([
      ["asset-1", { id: "asset-1", status: "candidate" }],
    ]);
    const deleteWhere = vi.fn(async (condition: any) => {
      const clauses = condition?.conditions ?? [];
      const wantsCandidate = clauses.some(
        (clause: any) =>
          clause?.column === "image_assets.status" &&
          clause?.value === "candidate",
      );
      const row = table.get("asset-1");
      if (row && wantsCandidate && row.status === "candidate") {
        table.delete("asset-1");
      }
    });
    getDbMock.mockReturnValue({
      delete: () => ({ where: deleteWhere }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              const row = table.get("asset-1");
              return row ? [row] : [];
            },
          }),
        }),
      }),
    });

    await expect(
      deleteDraftAssetIfUnchanged({ id: "asset-1", libraryId: "lib-1" }),
    ).resolves.toBe(true);

    table.set("asset-1", { id: "asset-1", status: "saved" });
    await expect(
      deleteDraftAssetIfUnchanged({ id: "asset-1", libraryId: "lib-1" }),
    ).resolves.toBe(false);
    expect(table.get("asset-1")).toEqual({ id: "asset-1", status: "saved" });
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
