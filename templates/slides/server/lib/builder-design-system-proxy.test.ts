import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  values: vi.fn(),
  rows: [] as Array<{ id: string }>,
}));
vi.mock("@agent-native/core/server", () => ({
  localBuilderDesignSystemId: () => "local-system",
  createBuilderDesignSystemProxyFields: () => ({
    title: "Brand",
    description: "",
    data: "{}",
    customInstructions: "",
  }),
}));
vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => mocks.rows }) }),
    }),
    insert: () => ({ values: mocks.values }),
  }),
  schema: { designSystems: {} },
}));
import { upsertBuilderProxyDesignSystem } from "./builder-design-system-proxy";

beforeEach(() => {
  mocks.values.mockReset();
  mocks.rows = [];
});
describe("Builder prompt-context proxy creation", () => {
  it.each([false, true])(
    "honors makeDefaultIfFirst=%s on the first persisted proxy",
    async (makeDefaultIfFirst) => {
      await upsertBuilderProxyDesignSystem({
        result: {
          ok: true,
          source: "builder",
          suggestedTitle: null,
          status: "in-progress",
          designSystemId: "builder-system",
          jobId: "job",
          projectId: "project",
          builderUrl: "https://example.test/system",
        },
        ownerEmail: "owner@example.test",
        orgId: "test-org",
        makeDefaultIfFirst,
      });
      expect(mocks.values).toHaveBeenCalledWith(
        expect.objectContaining({ isDefault: makeDefaultIfFirst }),
      );
    },
  );
});
