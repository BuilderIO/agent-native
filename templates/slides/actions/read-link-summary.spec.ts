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
  schema: { decks: { id: "id", title: "title" } },
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: mocks.rows }) }),
    }),
  }),
}));

import action from "./read-link-summary.js";

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.basePath.mockReturnValue("");
});

describe("read-link-summary (Slides)", () => {
  it("answers each deck link form the caller can open, below the app's mount", async () => {
    mocks.basePath.mockReturnValue("/slides");
    mocks.access.mockResolvedValue({ role: "owner", resource: { id: "k1" } });
    mocks.rows.mockResolvedValue([{ title: "Q3 review" }]);
    const links = [
      "https://ws.example.com/slides/deck/k1",
      "https://ws.example.com/slides/deck/k1/present",
      "https://ws.example.com/slides/p/k1",
    ];
    const result = await action.run({ links });
    expect(result.summaries).toEqual(
      links.map((url) => ({
        status: "available",
        app: "slides",
        kind: "deck",
        title: "Q3 review",
        url,
      })),
    );
    expect(mocks.access).toHaveBeenCalledWith("deck", "k1", undefined, {
      skipResourceBody: true,
    });
  });

  it("answers a private or missing deck exactly like a malformed link", async () => {
    mocks.access.mockResolvedValue(null);
    const result = await action.run({
      links: [
        "https://slides.example.com/deck/private-deck",
        "https://slides.example.com/deck/missing-deck",
        "https://slides.example.com/deck/k1/edit",
      ],
    });
    expect(result.summaries).toEqual([
      { status: "unavailable" },
      { status: "unavailable" },
      { status: "unavailable" },
    ]);
    expect(mocks.rows).not.toHaveBeenCalled();
  });
});
