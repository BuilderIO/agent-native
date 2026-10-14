import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveAccess = vi.fn();
const mockLimit = vi.fn();

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: mockLimit }) }),
    }),
  }),
  schema: { designSystems: { id: "id" } },
}));

import { readDeckLinkedDesignSystem } from "./_linked-design-system.js";

const privateRow = { id: "ds-private", data: "{}" };

describe("readDeckLinkedDesignSystem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccess.mockResolvedValue(null);
    mockLimit.mockResolvedValue([privateRow]);
  });

  it("uses direct access when the reader can open the design system", async () => {
    mockResolveAccess.mockResolvedValue({ resource: privateRow });

    await expect(
      readDeckLinkedDesignSystem({ designSystemId: "other" }, "ds-private"),
    ).resolves.toEqual({ resource: privateRow, viaDeck: false });
    expect(mockLimit).not.toHaveBeenCalled();
  });

  it("lets a deck reader read the design system that deck links", async () => {
    await expect(
      readDeckLinkedDesignSystem(
        { designSystemId: "ds-private" },
        "ds-private",
      ),
    ).resolves.toEqual({ resource: privateRow, viaDeck: true });
  });

  it("honors a link stored only in the deck data", async () => {
    await expect(
      readDeckLinkedDesignSystem(
        { data: JSON.stringify({ designSystemId: "ds-private" }) },
        "ds-private",
      ),
    ).resolves.toEqual({ resource: privateRow, viaDeck: true });
  });

  it("refuses a design system the deck does not link", async () => {
    await expect(
      readDeckLinkedDesignSystem({ designSystemId: "ds-other" }, "ds-private"),
    ).resolves.toBeNull();
    expect(mockLimit).not.toHaveBeenCalled();
  });

  it("refuses when the deck data cannot be parsed", async () => {
    await expect(
      readDeckLinkedDesignSystem({ data: "{not json" }, "ds-private"),
    ).resolves.toBeNull();
  });
});
