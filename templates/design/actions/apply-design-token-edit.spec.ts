import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.fn();
const mockSelectWhere = vi.fn();
const mockUpdateWhere = vi.fn();
const mockSet = vi.fn();
const designStore = vi.hoisted(() => ({
  row: {
    data: "{}",
    updatedAt: "2026-07-09T00:00:00.000Z",
  },
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: () => "agent-native://design/editor?designId=design_1",
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ kind: "and", conditions })),
  eq: vi.fn(() => ({ kind: "eq" })),
  isNull: vi.fn(() => ({ kind: "isNull" })),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => {
    const db = {
      select: () => ({
        from: () => ({
          where: async (...args: unknown[]) => {
            mockSelectWhere(...args);
            return [{ ...designStore.row }];
          },
        }),
      }),
      update: () => ({
        set: (values: { data: string; updatedAt: string }) => {
          mockSet(values);
          return {
            where: async (...args: unknown[]) => {
              designStore.row = { ...designStore.row, ...values };
              mockUpdateWhere(...args);
            },
          };
        },
      }),
    };
    return {
      ...db,
      transaction: <T>(callback: (tx: typeof db) => Promise<T>) => callback(db),
    };
  },
  schema: {
    designs: {
      data: "data",
      id: "id",
      updatedAt: "updatedAt",
    },
  },
}));

import action from "./apply-design-token-edit.js";

describe("apply-design-token-edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertAccess.mockResolvedValue(undefined);
    designStore.row = {
      data: "{}",
      updatedAt: "2026-07-09T00:00:00.000Z",
    };
  });

  it("persists and resolves arbitrary CSS vars stored by raw key", async () => {
    designStore.row.data = JSON.stringify({
      tweaks: [
        {
          id: "theme-accent",
          label: "Accent",
          type: "color-swatch",
          defaultValue: "#0EA5E9",
          cssVar: "--color-accent",
        },
      ],
      tweakSelections: {},
    });

    const glow = "0 0 24px rgba(14, 165, 233, 0.4)";
    const result = await action.run({
      designId: "design_1",
      edits: [{ cssVar: "--shadow-glow", value: glow }],
    });

    expect(result.resolvedCssVars).toEqual({
      "--color-accent": "#0EA5E9",
      "--shadow-glow": glow,
    });
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "design",
      "design_1",
      "editor",
    );
    expect(mockSet).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(designStore.row.data) as {
      tweakSelections: Record<string, string>;
    };
    expect(persisted.tweakSelections["--shadow-glow"]).toBe(glow);
    expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe CSS custom property names and token values", () => {
    expect(
      action.schema.safeParse({
        designId: "design_1",
        edits: [{ cssVar: "--color-accent;body", value: "#2563eb" }],
      }).success,
    ).toBe(false);

    expect(
      action.schema.safeParse({
        designId: "design_1",
        edits: [{ cssVar: "--color-accent", value: "red; color: black" }],
      }).success,
    ).toBe(false);
  });
});
