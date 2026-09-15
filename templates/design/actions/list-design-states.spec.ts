import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const schema = {
    designState: {
      id: "designState.id",
      designId: "designState.designId",
      sourceRef: "designState.sourceRef",
      name: "designState.name",
      kind: "designState.kind",
      breakpoint: "designState.breakpoint",
      route: "designState.route",
      fixtureData: "designState.fixtureData",
      captureData: "designState.captureData",
      previewRef: "designState.previewRef",
      createdAt: "designState.createdAt",
      updatedAt: "designState.updatedAt",
    },
    designs: { id: "designs.id" },
  };
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  const db = { select: vi.fn(() => query) };
  const events: string[] = [];
  return {
    schema,
    query,
    db,
    events,
    assertAccess: vi.fn(async () => {
      events.push("access");
    }),
    and: vi.fn((...parts: unknown[]) => ({ parts })),
    desc: vi.fn((value: unknown) => value),
    eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));
vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  desc: mocks.desc,
  eq: mocks.eq,
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => {
    mocks.events.push("select");
    return mocks.db;
  },
  schema: mocks.schema,
}));

import action from "./list-design-states.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.events.length = 0;
  mocks.query.orderBy.mockResolvedValue([
    {
      id: "state_1",
      designId: "design_1",
      sourceRef: "file_1",
      name: "Loading",
      kind: "state",
      breakpoint: "mobile",
      route: "/plans",
      fixtureData: '{"loading":true}',
      captureData: null,
      previewRef: null,
      createdAt: "2026-09-11T00:00:00.000Z",
      updatedAt: "2026-09-11T00:00:01.000Z",
    },
  ]);
});

describe("list-design-states access", () => {
  it("authorizes the parent design before listing child states", async () => {
    const result = await action.run({
      designId: "design_1",
      kind: "state",
    });

    expect(mocks.events).toEqual(["access", "select"]);
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design_1",
      "viewer",
    );
    expect(result).toMatchObject({
      count: 1,
      states: [
        expect.objectContaining({
          id: "state_1",
          fixtureData: { loading: true },
          captureData: null,
        }),
      ],
    });
  });
});
