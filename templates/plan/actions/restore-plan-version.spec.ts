import { isSaveConflict } from "@agent-native/core/save-conflict";
import { beforeEach, describe, expect, it, vi } from "vitest";

import restorePlanVersion from "./restore-plan-version.js";

const { state } = vi.hoisted(() => ({
  state: {
    updatedRows: [] as { id: string }[],
    writeError: null as Error | null,
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  inArray: (...args: unknown[]) => args,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: "version-1", snapshotJson: "{}" }],
        }),
      }),
    }),
    transaction: async (write: (tx: unknown) => Promise<void>) => {
      if (state.writeError) throw state.writeError;
      await write({
        update: () => ({
          set: () => ({
            where: () => ({ returning: async () => state.updatedRows }),
          }),
        }),
      });
    },
  }),
  schema: {
    plans: { id: "plans.id", updatedAt: "plans.updatedAt" },
    planVersions: { id: "id", planId: "planId", ownerEmail: "ownerEmail" },
  },
}));

vi.mock("../server/lib/local-identity.js", () => ({
  isLocalPlanRuntime: () => false,
}));

vi.mock("../server/lib/local-plan-files.js", () => ({
  writePlanLocalFiles: vi.fn(),
}));

vi.mock("../server/lib/plan-versions.js", () => ({
  createPlanVersionSnapshot: vi.fn(),
  parsePlanVersionSnapshot: () => ({
    plan: { title: "Plan", brief: "", status: "review", source: "local" },
    sections: [],
  }),
}));

vi.mock("../server/plan-content.js", () => ({
  serializePlanContent: (content: unknown) => JSON.stringify(content),
}));

vi.mock("../server/plans.js", () => ({
  assertPlanEditor: async () => ({
    resource: { ownerEmail: "owner@example.com", updatedAt: "revision-1" },
  }),
  buildPlanHtml: () => "<main>Plan</main>",
  loadPlanBundle: async (planId: string) => ({
    plan: {
      id: planId,
      kind: "plan",
      updatedAt: "revision-2",
      content: { blocks: [] },
    },
  }),
  newId: () => "new-id",
  nowIso: () => "2026-10-12T00:00:00.000Z",
  planDeepLink: (planId: string) => `/plans/${planId}`,
  planPath: (planId: string) => `/plans/${planId}`,
}));

const restore = () =>
  (
    restorePlanVersion as unknown as {
      run: (args: { planId: string; versionId: string }) => Promise<unknown>;
    }
  )
    .run({ planId: "plan-1", versionId: "version-1" })
    .catch((error: unknown) => error);

describe("restore-plan-version losing the race for the plan", () => {
  beforeEach(() => {
    state.updatedRows = [];
    state.writeError = null;
  });

  it("reports the shared conflict with the plan as it is now, in words for people", async () => {
    const error = await restore();
    expect(isSaveConflict(error)).toBe(true);
    expect(error).toMatchObject({
      statusCode: 409,
      details: { current: { blocks: [] }, currentRevision: "revision-2" },
    });
    expect((error as Error).message).toContain("updated by someone else");
  });

  it("leaves any other failure as it was", async () => {
    state.writeError = new Error("The database went away.");
    expect(await restore()).toBe(state.writeError);
  });
});
