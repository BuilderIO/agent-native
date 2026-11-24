import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  rows: vi.fn(),
  basePath: vi.fn(() => ""),
}));
vi.mock("@agent-native/core/sharing", () => ({ resolveAccess: mocks.access }));
vi.mock("@agent-native/core/server", () => ({
  getConfiguredAppBasePath: mocks.basePath,
}));
vi.mock(
  "@agent-native/core/shared",
  () => import("../../../packages/core/src/shared/link-summary.js"),
);
vi.mock(
  "@agent-native/core/a2a",
  () => import("../../../packages/core/src/a2a/link-summary.js"),
);
vi.mock("../server/db/index.js", () => ({
  schema: { designs: { id: "id", title: "title" } },
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: mocks.rows }) }),
    }),
  }),
}));

import action from "./read-link-summary.js";

const LINK = "https://design.example.com/design/d1";

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.basePath.mockReturnValue("");
});

describe("read-link-summary (Design)", () => {
  it("answers a design the caller can open with its title", async () => {
    mocks.access.mockResolvedValue({ role: "viewer", resource: { id: "d1" } });
    mocks.rows.mockResolvedValue([{ title: "Launch page" }]);
    await expect(action.run({ links: [LINK] })).resolves.toEqual({
      summaries: [
        {
          status: "available",
          app: "design",
          kind: "design",
          title: "Launch page",
          url: LINK,
        },
      ],
    });
    expect(mocks.access).toHaveBeenCalledWith("design", "d1", undefined, {
      skipResourceBody: true,
    });
  });

  it("answers a design the caller can't open, or that doesn't exist, as unavailable without reading it", async () => {
    mocks.access.mockResolvedValue(null);
    await expect(action.run({ links: [LINK] })).resolves.toEqual({
      summaries: [{ status: "unavailable" }],
    });
    expect(mocks.rows).not.toHaveBeenCalled();
  });

  it("answers a link that names no design, or a failing read, as unavailable", async () => {
    mocks.access.mockRejectedValue(new Error("database is down"));
    await expect(
      action.run({
        links: [
          "https://design.example.com/templates",
          "https://design.example.com/design/../secret",
          LINK,
        ],
      }),
    ).resolves.toEqual({
      summaries: [
        { status: "unavailable" },
        { status: "unavailable" },
        { status: "unavailable" },
      ],
    });
    expect(mocks.access).toHaveBeenCalledTimes(1);
  });

  it("refuses more links than one card batch holds", () => {
    expect(
      action.schema.safeParse({ links: Array.from({ length: 21 }, () => LINK) })
        .success,
    ).toBe(false);
  });
});
