import { isAgentActionStopError } from "@agent-native/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertAnalysis = vi.fn();
const hasDataQueryAttempt = vi.fn(() => true);

vi.mock("@agent-native/core/server", () => ({
  getRequestRunContext: () => ({ toolResults: [{ name: "hubspot-deals" }] }),
  getRequestUserEmail: () => "brent@builder.io",
  getRequestOrgId: () => "org-1",
  buildDeepLink: vi.fn(
    ({
      app,
      view,
      params,
    }: {
      app: string;
      view: string;
      params?: { analysisId?: string };
    }) => {
    const suffix = params?.analysisId ? `/${params.analysisId}` : "";
    return `/${app}/${view}${suffix}`;
    },
  ),
}));

vi.mock("../server/lib/dashboards-store", () => ({
  upsertAnalysis,
}));

vi.mock("../server/lib/real-data-actions", () => ({
  hasDataQueryAttempt,
}));

const { default: saveAnalysis } = await import("./save-analysis");

describe("save-analysis action", () => {
  beforeEach(() => {
    upsertAnalysis.mockReset();
    hasDataQueryAttempt.mockClear();
    hasDataQueryAttempt.mockReturnValue(true);
  });

  it("rejects oversized structured evidence instead of saving raw payload dumps", async () => {
    await expect(
      saveAnalysis.run({
        id: "the-knot-deep-dive",
        name: "The Knot deep dive",
        description: "Deal context",
        question: "Deep dive on The Knot",
        instructions: "Search HubSpot and Gong, then summarize.",
        dataSources: ["hubspot", "gong"],
        resultMarkdown: "## Findings\n\nLegal and procurement are open.",
        resultData: {
          transcript: "A".repeat(90_000),
        },
      }),
    ).rejects.toSatisfy((err: unknown) => isAgentActionStopError(err));

    expect(upsertAnalysis).not.toHaveBeenCalled();
  });

  it("saves compact evidence", async () => {
    await saveAnalysis.run({
      id: "the-knot-deep-dive",
      name: "The Knot deep dive",
      description: "Deal context",
      question: "Deep dive on The Knot",
      instructions: "Search HubSpot and Gong, then summarize.",
      dataSources: ["hubspot", "gong"],
      resultMarkdown: "## Findings\n\nLegal and procurement are open.",
      resultData: {
        calls: [{ id: "call-1", excerpt: "Legal is reviewing." }],
        themes: { legal_review: 1 },
      },
    });

    expect(upsertAnalysis).toHaveBeenCalledWith(
      "the-knot-deep-dive",
      expect.objectContaining({
        resultData: {
          calls: [{ id: "call-1", excerpt: "Legal is reviewing." }],
          themes: { legal_review: 1 },
        },
      }),
      { email: "brent@builder.io", orgId: "org-1" },
    );
  });
});
