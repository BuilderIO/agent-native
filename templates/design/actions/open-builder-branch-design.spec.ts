import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    rows: [] as Array<{ id: string; data: string; ownerEmail: string }>,
    inserted: null as Record<string, unknown> | null,
    data: "" as string,
  };
  const db = {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(state.rows) }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        state.inserted = values;
        state.data = values.data as string;
        return Promise.resolve();
      },
    }),
  };
  const mutateDesignData = vi.fn(
    async (args: { mutate: (current: string) => Record<string, unknown> }) => {
      state.data = JSON.stringify(args.mutate(state.data));
    },
  );
  return {
    state,
    db,
    mutateDesignData,
    upsertFusionScreens: vi.fn(async () => ({ screens: [] })),
    canAccessBuilderProject: vi.fn(async () => true),
  };
});

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => "org_1",
  getRequestUserEmail: () => "user@example.com",
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => undefined),
}));

vi.mock("nanoid", () => ({ nanoid: () => "design_new" }));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: { designs: { id: "id", data: "data", ownerEmail: "ownerEmail" } },
}));

vi.mock("../server/lib/builder-identity.js", () => ({
  canAccessBuilderProject: mocks.canAccessBuilderProject,
}));

vi.mock("../server/lib/design-data-mutation.js", () => ({
  mutateDesignData: mocks.mutateDesignData,
}));

vi.mock("../server/lib/fusion-screens.js", () => ({
  upsertFusionScreens: mocks.upsertFusionScreens,
}));

import { readFusionApp } from "../shared/full-app.js";
import action from "./open-builder-branch-design.js";

const PREVIEW = "https://project-1-main.example.test/";

function existingDesign(app: Record<string, unknown>) {
  const data = JSON.stringify({
    sourceType: "fusion",
    fusionApp: { projectId: "project-1", branchName: "main", ...app },
  });
  mocks.state.rows = [{ id: "design_1", data, ownerEmail: "user@example.com" }];
  mocks.state.data = data;
}

const open = (args: Record<string, unknown> = {}) =>
  action.run(
    { projectId: "project-1", branchName: "main", ...args } as never,
    {} as never,
  );

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  mocks.state.rows = [];
  mocks.state.inserted = null;
  mocks.state.data = "";
  mocks.upsertFusionScreens.mockClear();
  mocks.mutateDesignData.mockClear();
});

describe("open-builder-branch-design", () => {
  it("creates the branch's design marked as starting, with screens on the host's URL", async () => {
    await expect(open({ previewUrl: PREVIEW, paths: ["/"] })).resolves.toEqual({
      designId: "design_new",
      status: "building",
      previewUrl: PREVIEW,
    });
    expect(mocks.upsertFusionScreens).toHaveBeenCalledWith({
      designId: "design_new",
      previewUrl: PREVIEW,
      paths: ["/"],
    });
    expect(readFusionApp(mocks.state.data)).toMatchObject({
      status: "building",
      previewUrl: PREVIEW,
    });
  });

  it("opens before the app has a URL, binding screens later", async () => {
    await expect(open()).resolves.toEqual({
      designId: "design_new",
      status: "building",
    });
    expect(mocks.upsertFusionScreens).not.toHaveBeenCalled();
  });

  it("keeps an app that is running at the same URL ready", async () => {
    existingDesign({ status: "ready", previewUrl: PREVIEW });

    await expect(open({ previewUrl: PREVIEW })).resolves.toEqual({
      designId: "design_1",
      status: "ready",
      previewUrl: PREVIEW,
    });
  });

  it("marks the app as starting when the host reports a new container URL", async () => {
    existingDesign({ status: "ready", previewUrl: PREVIEW });
    const moved = "https://project-1-main-2.example.test/";

    await expect(open({ previewUrl: moved })).resolves.toMatchObject({
      status: "building",
      previewUrl: moved,
    });
    expect(readFusionApp(mocks.state.data)?.previewUrl).toBe(moved);
  });

  it("reuses the app's last URL when the host has none yet", async () => {
    existingDesign({ status: "building", previewUrl: PREVIEW });

    await expect(open()).resolves.toEqual({
      designId: "design_1",
      status: "building",
      previewUrl: PREVIEW,
    });
  });
});
