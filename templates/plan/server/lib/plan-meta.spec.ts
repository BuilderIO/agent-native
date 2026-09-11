import { describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the privacy-gated plan meta helper.
 *
 * Mirrors the mock style used in public-plans-viewer.spec.ts: stub getDb and
 * drizzle-orm so no real DB is needed and the server-only import chain is safe.
 */

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

type SelectRow = {
  title: string;
  brief: string;
  visibility: string;
  kind: string;
};

const selectMock = vi.fn<() => Promise<SelectRow[]>>();

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => selectMock(),
        }),
      }),
    }),
  }),
  schema: {
    plans: {
      title: "plans.title",
      brief: "plans.brief",
      visibility: "plans.visibility",
      kind: "plans.kind",
      id: "plans.id",
    },
  },
}));

const { fetchPublicPlanMeta } = await import("./plan-meta.server.js");
const { buildPlanMetaDescription } =
  await import("../../shared/plan-meta-format.js");

describe("fetchPublicPlanMeta", () => {
  it("returns title and brief for a public plan", async () => {
    selectMock.mockResolvedValue([
      {
        title: "My Plan",
        brief: "A brief description of the plan.",
        visibility: "public",
        kind: "plan",
      },
    ]);
    const meta = await fetchPublicPlanMeta("plan-123");
    expect(meta).toEqual({
      title: "My Plan",
      brief: "A brief description of the plan.",
      kind: "plan",
    });
  });

  it("returns null for a private plan — does not leak the title", async () => {
    selectMock.mockResolvedValue([
      {
        title: "Secret Plan",
        brief: "Top secret.",
        visibility: "private",
        kind: "plan",
      },
    ]);
    const meta = await fetchPublicPlanMeta("plan-456");
    expect(meta).toBeNull();
  });

  it("returns null when the plan does not exist", async () => {
    selectMock.mockResolvedValue([]);
    const meta = await fetchPublicPlanMeta("plan-ghost");
    expect(meta).toBeNull();
  });

  it("returns null on a DB error — never throws", async () => {
    selectMock.mockRejectedValue(new Error("DB unavailable"));
    await expect(fetchPublicPlanMeta("plan-err")).resolves.toBeNull();
  });

  it("exposes kind from the row", async () => {
    selectMock.mockResolvedValue([
      {
        title: "My Recap",
        brief: "A brief recap.",
        visibility: "public",
        kind: "recap",
      },
    ]);
    const meta = await fetchPublicPlanMeta("recap-abc");
    expect(meta?.kind).toBe("recap");
  });
});

describe("buildPlanMetaDescription", () => {
  it("returns the brief unchanged when it is ≤160 chars", () => {
    const brief = "Short description.";
    expect(buildPlanMetaDescription(brief)).toBe(brief);
  });

  it("truncates to ≤160 chars with an ellipsis when brief is long", () => {
    // 200-char string
    const brief = "A".repeat(100) + " " + "B".repeat(99);
    const result = buildPlanMetaDescription(brief);
    expect(result.length).toBeLessThanOrEqual(160);
    expect(result.endsWith("…")).toBe(true);
  });

  it("trims leading/trailing whitespace before truncating", () => {
    const brief = "  Hello world.  ";
    expect(buildPlanMetaDescription(brief)).toBe("Hello world.");
  });
});
