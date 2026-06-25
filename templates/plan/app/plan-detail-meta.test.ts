import { describe, expect, it, vi } from "vitest";

vi.mock("../server/lib/plan-meta.server", () => ({
  fetchPublicPlanMeta: vi.fn(),
}));

import { meta as planMeta } from "./routes/plans.$id";
import { meta as recapMeta } from "./routes/recaps.$id";

type MetaEntry = Record<string, string>;

function titleFrom(entries: MetaEntry[]): string | undefined {
  return entries.find((entry) => "title" in entry)?.title;
}

function propertyFrom(
  entries: MetaEntry[],
  property: string,
): string | undefined {
  return entries.find((entry) => entry.property === property)?.content;
}

describe("plan detail route meta", () => {
  it("uses the plan name as the document title", () => {
    const entries = planMeta({
      loaderData: {
        planMeta: {
          title: "Hosted-First Visual Plan Sync",
          brief: "Keep the hosted and local plan surfaces aligned.",
          kind: "plan",
        },
      },
    } as Parameters<typeof planMeta>[0]) as MetaEntry[];

    expect(titleFrom(entries)).toBe("Hosted-First Visual Plan Sync");
    expect(propertyFrom(entries, "og:title")).toBe(
      "Hosted-First Visual Plan Sync",
    );
  });

  it("uses the recap name as the document title", () => {
    const entries = recapMeta({
      loaderData: {
        planMeta: {
          title: "Provider API Body Cursors Recap",
          brief: "Summarize the provider API cursor changes.",
          kind: "recap",
        },
      },
    } as Parameters<typeof recapMeta>[0]) as MetaEntry[];

    expect(titleFrom(entries)).toBe("Provider API Body Cursors Recap");
    expect(propertyFrom(entries, "og:title")).toBe(
      "Provider API Body Cursors Recap",
    );
  });
});
