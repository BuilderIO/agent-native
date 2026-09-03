import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const selectChain = { from: vi.fn(), where: vi.fn() };
  selectChain.from.mockReturnValue(selectChain);
  const insertChain = { values: vi.fn() };
  return {
    initialData: {} as Record<string, unknown>,
    latestData: {} as Record<string, unknown>,
    files: [] as Array<{ id: string; filename: string; content: string }>,
    events: [] as string[],
    selectChain,
    insertChain,
    db: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
    },
    assertAccess: vi.fn(),
    resolveAccess: vi.fn(),
    runBuilderAgent: vi.fn(),
    mutateDesignData: vi.fn(),
    nanoid: vi.fn(),
  };
});

vi.mock("@agent-native/core/server", () => ({
  resolveIsBuilderBranchingEnabled: vi.fn(async () => true),
  resolveBuilderBranchProjectId: vi.fn(async () => "builder-project"),
  runBuilderAgent: state.runBuilderAgent,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(() => "example.user@example.com"),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: state.assertAccess,
  resolveAccess: state.resolveAccess,
}));

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ left, right }),
  sql: vi.fn(),
}));

vi.mock("nanoid", () => ({ nanoid: state.nanoid }));

vi.mock("../server/db/index.js", () => ({
  getDb: () => state.db,
  schema: {
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      content: "designFiles.content",
    },
    designVersions: "designVersions",
  },
}));

vi.mock("../server/lib/design-data-mutation.js", () => ({
  mutateDesignData: state.mutateDesignData,
}));

vi.mock("../shared/capability-resolver.js", () => ({
  resolveSourceCapabilities: vi.fn(() => ({})),
  resolveFusionCapabilities: vi.fn(() => ({})),
}));

vi.mock("../shared/design-source-capabilities.js", () => ({
  hasCapability: vi.fn(() => true),
}));

vi.mock("../shared/source-mode.js", () => ({
  designSourceTypeFromData: vi.fn(() => "fusion"),
}));

import createDesignBranch from "./create-design-branch.js";
import deployDesignPreview from "./deploy-design-preview.js";

function branch(branchName: string, extra: Record<string, unknown> = {}) {
  return {
    branchName,
    projectId: "builder-project",
    url: `https://builder.example/${branchName}`,
    status: "ready",
    createdAt: "2026-07-09T00:00:00.000Z",
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.events = [];
  state.files = [{ id: "file-1", filename: "index.html", content: "<main />" }];
  state.selectChain.where.mockImplementation(async () => state.files);
  state.insertChain.values.mockImplementation(async () => {
    state.events.push("snapshot");
  });
  state.nanoid.mockReturnValue("snapshot-id");
  state.initialData = {
    sourceType: "fusion",
    branches: [branch("main")],
  };
  state.latestData = structuredClone(state.initialData);
  state.resolveAccess.mockImplementation(async () => ({
    resource: {
      title: "Example design",
      data: JSON.stringify(state.initialData),
    },
  }));
  state.mutateDesignData.mockImplementation(
    async (options: {
      mutate: (
        current: Record<string, unknown>,
        context: { updatedAt: string },
      ) => Record<string, unknown>;
      isApplied: (current: Record<string, unknown>) => boolean;
    }) => {
      state.events.push("mutate");
      const updatedAt = "2026-07-09T12:00:00.000Z";
      state.latestData = options.mutate(state.latestData, { updatedAt });
      expect(options.isApplied(state.latestData)).toBe(true);
      return { data: state.latestData, updatedAt };
    },
  );
});

describe("Builder branch designs.data mutations", () => {
  it("appends a created branch to the latest revision after snapshot and Builder work", async () => {
    state.latestData = {
      ...state.latestData,
      branches: [branch("main"), branch("concurrent-branch")],
      concurrentCanvasWrite: { keep: true },
    };
    state.runBuilderAgent.mockImplementation(async () => {
      state.events.push("builder");
      return {
        branchName: "new-direction",
        projectId: "builder-project",
        url: "https://builder.example/new-direction",
        status: "ready",
      };
    });

    const result = await createDesignBranch.run({
      designId: "design-1",
      purpose: "Explore a new direction",
    });

    expect(result).toMatchObject({
      ctaRequired: false,
      versionId: "dv_snapshot-id",
      branch: { branchName: "new-direction" },
    });
    expect(state.events).toEqual(["snapshot", "builder", "mutate"]);
    expect(state.latestData.concurrentCanvasWrite).toEqual({ keep: true });
    expect(
      (state.latestData.branches as Array<{ branchName: string }>).map(
        (entry) => entry.branchName,
      ),
    ).toEqual(["main", "concurrent-branch", "new-direction"]);
  });

  it("updates only the latest matching branch after Builder preview work", async () => {
    state.initialData = {
      sourceType: "fusion",
      branches: [branch("target", { purpose: "initial" })],
    };
    state.latestData = {
      sourceType: "fusion",
      branches: [
        branch("target", { purpose: "changed concurrently" }),
        branch("concurrent-branch"),
      ],
      concurrentCanvasWrite: { keep: true },
    };
    state.runBuilderAgent.mockImplementation(async () => {
      state.events.push("builder");
      return {
        branchName: "target",
        projectId: "builder-project",
        url: "https://preview.example/target",
        status: "building",
      };
    });

    await deployDesignPreview.run({
      designId: "design-1",
      branchName: "target",
    });

    expect(state.events).toEqual(["builder", "mutate"]);
    expect(state.latestData.concurrentCanvasWrite).toEqual({ keep: true });
    const branches = state.latestData.branches as Array<
      Record<string, unknown>
    >;
    expect(branches).toHaveLength(2);
    expect(branches[0]).toMatchObject({
      branchName: "target",
      purpose: "changed concurrently",
      previewUrl: "https://preview.example/target",
      deployStatus: "building",
    });
    expect(branches[1]).toMatchObject({ branchName: "concurrent-branch" });
  });

  it("fails loud rather than resurrecting a concurrently removed branch", async () => {
    state.initialData = {
      sourceType: "fusion",
      branches: [branch("removed")],
    };
    state.latestData = {
      sourceType: "fusion",
      branches: [branch("survivor")],
    };
    state.runBuilderAgent.mockImplementation(async () => {
      state.events.push("builder");
      return {
        branchName: "removed",
        projectId: "builder-project",
        url: "https://preview.example/removed",
        status: "building",
      };
    });

    await expect(
      deployDesignPreview.run({
        designId: "design-1",
        branchName: "removed",
      }),
    ).rejects.toThrow("was removed while its preview was building");
    expect(state.events).toEqual(["builder", "mutate"]);
    expect(state.latestData.branches).toEqual([branch("survivor")]);
  });
});
