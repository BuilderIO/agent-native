import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accessFilter: vi.fn(),
  assertAccess: vi.fn(),
  getDb: vi.fn(),
  getText: vi.fn(),
  hasCollabState: vi.fn(),
  roleSatisfies: vi.fn((actual: string, minimum: string) => {
    const rank: Record<string, number> = {
      viewer: 1,
      commenter: 2,
      editor: 3,
      admin: 4,
      owner: 5,
    };
    return rank[actual] >= rank[minimum];
  }),
  resolveAccess: vi.fn(),
  schema: {
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
    },
    designShares: {},
    designs: { id: "designs.id" },
    designState: {
      id: "designState.id",
      designId: "designState.designId",
      kind: "designState.kind",
      name: "designState.name",
      breakpoint: "designState.breakpoint",
      route: "designState.route",
      fixtureData: "designState.fixtureData",
      captureData: "designState.captureData",
      previewRef: "designState.previewRef",
    },
  },
}));

vi.mock("@agent-native/core/collab", () => ({
  getText: mocks.getText,
  hasCollabState: mocks.hasCollabState,
}));
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: mocks.accessFilter,
  assertAccess: mocks.assertAccess,
  roleSatisfies: mocks.roleSatisfies,
  resolveAccess: mocks.resolveAccess,
}));
// raw-sql-ok: inert stand-in for drizzle's sql tag; this spec never builds SQL.
vi.mock("drizzle-orm", () => ({
  and: (...parts: unknown[]) => parts,
  eq: (left: unknown, right: unknown) => ({ left, right }),
  inArray: vi.fn(),
  sql: vi.fn(),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: mocks.schema,
}));

import action from "./get-design-surface-index.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveAccess.mockResolvedValue({
    resource: { data: '{"sourceType":"inline"}' },
    role: "viewer",
  });
  mocks.assertAccess.mockRejectedValue(new Error("editor access required"));
  mocks.accessFilter.mockReturnValue("public-view");
  mocks.hasCollabState.mockResolvedValue(false);
});

// oracle-change: the review snapshot option was removed with the design review tools
// oracle-change(templates/design/actions/run-design-audit.spec.ts): audit action removed with the design review tools
// oracle-change(templates/design/actions/apply-a11y-fix.spec.ts): a11y fix action removed with the design review tools
// oracle-change(templates/design/actions/apply-a11y-fix.interleave.spec.ts): a11y fix action removed with the design review tools
// oracle-change(templates/design/app/components/design/ReviewPanel.test.tsx): Review panel removed with the design review tools
// oracle-change(templates/design/e2e/review-panel.spec.ts): Review panel removed with the design review tools
// oracle-change(templates/design/shared/design-flags.spec.ts): review panel flag removed with the design review tools
describe("get-design-surface-index", () => {
  it.each(["viewer", "commenter"] as const)(
    "omits captured-state metadata for %s access",
    async (role) => {
      mocks.resolveAccess.mockResolvedValue({
        resource: { data: '{"sourceType":"inline"}' },
        role,
      });

      const file = {
        id: "file_1",
        designId: "design_1",
        filename: "index.html",
        fileType: "html",
        content: "<html><body><main>Public design</main></body></html>",
      };
      const fileQuery = {
        from: vi.fn(),
        innerJoin: vi.fn(),
        where: vi.fn(),
        limit: vi.fn().mockResolvedValue([file]),
      };
      fileQuery.from.mockReturnValue(fileQuery);
      fileQuery.innerJoin.mockReturnValue(fileQuery);
      fileQuery.where.mockReturnValue(fileQuery);

      const stateQuery = {
        from: vi.fn(),
        where: vi.fn().mockResolvedValue([
          {
            id: "state_1",
            kind: "capture",
            name: "Private account",
            breakpoint: "mobile",
            route: "/private/account",
            fixtureData: '{"email":"private@example.test"}',
            captureData: '{"accountId":"private"}',
            previewRef: "https://example.test/private-preview.png",
          },
        ]),
      };
      stateQuery.from.mockReturnValue(stateQuery);

      const db = {
        select: vi
          .fn()
          .mockReturnValueOnce(fileQuery)
          .mockReturnValueOnce(stateQuery),
      };
      mocks.getDb.mockReturnValue(db);

      const result = await action.run(
        {
          designId: "design_1",
          filename: "index.html",
          includeNodes: false,
        } as never,
        {} as never,
      );

      expect(db.select).toHaveBeenCalledTimes(1);
      expect(stateQuery.where).not.toHaveBeenCalled();
      expect(result.index.states).toBeUndefined();
      expect(result.summary.stateCount).toBe(0);
    },
  );
});
