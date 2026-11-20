import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  email: "qa-fleet@builder.io" as string | null,
  orgId: "qa-org",
  values: new Map<string, Record<string, unknown>>(),
  disposition: "allowed",
  denied: new Set<string>(),
  memberships: [] as { sourceId: string }[],
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => state.email,
  getRequestOrgId: () => state.orgId,
}));
vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: async () => null,
  mutateOrgSetting: async () => undefined,
  getUserSetting: async (email: string, key: string) =>
    state.values.get(`${email}:${key}`) ?? null,
  mutateUserSetting: async (
    email: string,
    key: string,
    fn: (value: Record<string, unknown> | null) => Record<string, unknown>,
  ) => {
    const next = fn(state.values.get(`${email}:${key}`) ?? null);
    state.values.set(`${email}:${key}`, next);
    return next;
  },
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: async (_type: string, id: string) => {
    if (state.denied.has(id)) throw new Error("Access denied");
  },
}));
vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => state.memberships }) }),
    }),
  }),
  schema: {
    brainProjectSources: { projectId: "projectId", sourceId: "sourceId" },
  },
}));
vi.mock("./brain.js", () => ({ readBrainSettings: async () => ({}) }));
vi.mock("./capture-sanitization.js", () => ({
  sanitizeCaptureForStorage: async (input: { content: string }) => ({
    content: input.content,
    decision: { disposition: state.disposition },
  }),
}));

import {
  listPersonalMemories,
  managePersonalMemory,
  listRecipes,
  manageRecipe,
  prepareRecipe,
} from "./personal-intelligence.js";

beforeEach(() => {
  state.values.clear();
  state.email = "qa-fleet@builder.io";
  state.orgId = "qa-org";
  state.disposition = "allowed";
  state.denied.clear();
  state.memberships = [];
  vi.restoreAllMocks();
});

describe("personal context", () => {
  it("edits and deletes the current user's saved preference without touching other records", async () => {
    vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2026-11-18T12:00:00.000Z"),
    );
    const first = await managePersonalMemory({
      operation: "save",
      content: "Prefer concise work updates.",
    });
    const second = await managePersonalMemory({
      operation: "save",
      content: "Use bullet points for project summaries.",
    });
    const revision = (await listPersonalMemories()).memories.find(
      (row) => row.id === first.id,
    )?.updatedAt;
    await managePersonalMemory({
      operation: "save",
      id: first.id,
      expectedRevision: revision,
      content: "Prefer detailed work updates.",
    });
    const updated = (await listPersonalMemories()).memories.find(
      (row) => row.id === first.id,
    );
    expect(updated?.content).toBe("Prefer detailed work updates.");
    await expect(
      managePersonalMemory({
        operation: "delete",
        id: first.id,
        expectedRevision: revision,
      }),
    ).rejects.toMatchObject({ errorCode: "save_conflict" });
    await managePersonalMemory({
      operation: "delete",
      id: first.id,
      expectedRevision: updated?.updatedAt,
    });
    expect(
      (await listPersonalMemories()).memories.map((row) => row.id),
    ).toEqual([second.id]);
  });

  it("keeps context isolated when the same QA user switches organizations", async () => {
    const created = await managePersonalMemory({
      operation: "save",
      content: "Prefer concise project updates.",
    });
    state.orgId = "other-qa-org";
    expect((await listPersonalMemories()).memories).toEqual([]);
    await expect(
      managePersonalMemory({ operation: "delete", id: created.id }),
    ).rejects.toMatchObject({ errorCode: "not_found" });
    state.orgId = "qa-org";
    expect((await listPersonalMemories()).memories).toHaveLength(1);
    state.email = null;
    await expect(listPersonalMemories()).rejects.toMatchObject({
      errorCode: "unauthenticated",
    });
  });

  it("rejects privacy-restricted text before storing anything", async () => {
    state.disposition = "quarantined";
    await expect(
      managePersonalMemory({
        operation: "save",
        content: "Restricted context.",
      }),
    ).rejects.toMatchObject({ errorCode: "privacy_restricted" });
    expect(state.values.size).toBe(0);
  });

  it("reports corrupt saved context rather than treating it as empty", async () => {
    await managePersonalMemory({
      operation: "save",
      content: "Prefer source links.",
    });
    const key = [...state.values.keys()][0];
    if (!key) throw new Error("Missing test setting");
    state.values.set(key, { records: "invalid" });
    await expect(listPersonalMemories()).rejects.toMatchObject({
      errorCode: "stored_data_invalid",
    });
  });
});

describe("source-scoped recipes", () => {
  it("revalidates current source access at execution and preserves the stored prompt", async () => {
    const saved = await manageRecipe({
      operation: "save",
      title: "Project decisions",
      prompt: "Summarize source-backed project decisions.",
      sourceIds: ["source-a"],
    });
    expect((await prepareRecipe(saved.id)).scope.sourceIds).toEqual([
      "source-a",
    ]);
    state.denied.add("source-a");
    await expect(prepareRecipe(saved.id)).rejects.toThrow("Access denied");
    expect((await listRecipes()).recipes[0]?.prompt).toBe(
      "Summarize source-backed project decisions.",
    );
  });

  it("intersects explicit sources with live project membership and rejects empty scopes", async () => {
    state.memberships = [{ sourceId: "source-a" }, { sourceId: "source-b" }];
    const saved = await manageRecipe({
      operation: "save",
      title: "Project brief",
      prompt: "Read project evidence.",
      sourceIds: ["source-a", "source-c"],
      projectId: "project-a",
    });
    expect((await prepareRecipe(saved.id)).scope.sourceIds).toEqual([
      "source-a",
    ]);
    state.memberships = [{ sourceId: "source-b" }];
    await expect(prepareRecipe(saved.id)).rejects.toMatchObject({
      errorCode: "scope_empty",
    });
    const empty = await manageRecipe({
      operation: "save",
      title: "Empty project",
      prompt: "Read project evidence.",
      projectId: "project-b",
    });
    state.memberships = [];
    await expect(prepareRecipe(empty.id)).rejects.toMatchObject({
      errorCode: "scope_empty",
    });
  });

  it("allows an explicitly unscoped recipe but checks revisions before deletion", async () => {
    const saved = await manageRecipe({
      operation: "save",
      title: "Research",
      prompt: "Compare company evidence.",
    });
    expect((await prepareRecipe(saved.id)).scope.sourceIds).toBeNull();
    await expect(
      manageRecipe({
        operation: "delete",
        id: saved.id,
        expectedRevision: "stale",
      }),
    ).rejects.toMatchObject({ errorCode: "save_conflict" });
    const current = (await listRecipes()).recipes.find(
      (row) => row.id === saved.id,
    );
    if (!current) throw new Error("Saved recipe was not returned");
    await manageRecipe({
      operation: "delete",
      id: saved.id,
      expectedRevision: current.updatedAt,
    });
    expect((await listRecipes()).recipes).toEqual([]);
  });
});
