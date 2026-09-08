import { describe, expect, it, vi } from "vitest";

const mockResolveAccess = vi.fn();

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

vi.mock("../server/db/index.js", () => ({}));

vi.mock("./get-design-system.js", () => ({
  default: {
    run: vi.fn(async ({ id }: { id: string }) => ({
      id,
      title: "Acme",
      agentContext: "Use --brand-accent: #123456.",
    })),
  },
}));

import action, {
  buildReferenceDeckContext,
  pickLayoutPatterns,
} from "./get-deck-reference-context.js";

const slides = [
  { id: "a", layout: "title", content: "<h1>Q3 Review</h1>" },
  {
    id: "b",
    layout: "content",
    content: "<h2>Revenue</h2><ul><li>Up</li></ul>",
  },
  { id: "c", layout: "content", content: "<h2>Churn</h2>" },
  { id: "d", layout: "quote", content: "<blockquote>Ship it</blockquote>" },
];

describe("pickLayoutPatterns", () => {
  it("returns one exemplar per distinct layout", () => {
    expect(pickLayoutPatterns(slides).map((p) => p.layout)).toEqual([
      "title",
      "content",
      "quote",
    ]);
  });

  it("keeps the first example of a repeated layout", () => {
    expect(pickLayoutPatterns(slides)[1].slide.id).toBe("b");
  });
});

describe("buildReferenceDeckContext", () => {
  const context = buildReferenceDeckContext({
    id: "deck-1",
    title: "Brand Base",
    aspectRatio: "16:9",
    designSystemId: "ds-1",
    slides,
  });

  it("frames the reference as a pattern library rather than an outline", () => {
    expect(context).toContain("pattern library, NOT an outline");
    expect(context).toContain(
      "Do not reproduce the reference deck's slide order",
    );
  });

  it("withholds the reference deck's slide sequence", () => {
    expect(context).not.toContain("Slide progression");
    // No slide numbering that could be read as an order to follow.
    expect(context).not.toMatch(/^\d+\. \[/m);
  });

  it("includes one worked markup example per layout", () => {
    expect(context).toContain("#### Pattern: title");
    expect(context).toContain("#### Pattern: quote");
    expect(context).toContain("<blockquote>Ship it</blockquote>");
  });

  it("tells the agent to take no content from the reference", () => {
    expect(context).toContain("Take no wording, data, imagery, or subject");
  });

  it("points the agent at get-deck for cases the patterns miss", () => {
    expect(context).toContain("get-deck --id deck-1 --compact false");
  });
});

describe("get-deck-reference-context action", () => {
  it("falls back to the design system id stored in data when the column is null", async () => {
    mockResolveAccess.mockResolvedValue({
      resource: {
        id: "deck-2",
        title: "Reference Deck",
        designSystemId: null,
        data: JSON.stringify({ designSystemId: "ds-in-data", slides }),
      },
    });

    const result = (await action.run({ id: "deck-2" } as any)) as any;

    expect(result.designSystemId).toBe("ds-in-data");
    expect(result.designSystem).toMatchObject({
      status: "available",
      id: "ds-in-data",
    });
  });
});
