import { describe, expect, it } from "vitest";

import { matchBuilderCmsSafeModelIntentEntries } from "./_builder-cms-intent-lookup";
import type { BuilderCmsSourceEntry } from "./_builder-cms-source-adapter";

function entry(data: Record<string, unknown>): BuilderCmsSourceEntry {
  return {
    id: "remote-1",
    model: "agent-native-blog-article-test",
    title: String(data.title ?? "Untitled"),
    urlPath: null,
    updatedAt: "2026-07-13T00:00:00.000Z",
    sourceValues: {},
    rawEntry: { id: "remote-1", published: "draft", data },
  };
}

describe("Builder safe-model intent matching", () => {
  it("reports an existing marker separately from intended-field fidelity", () => {
    const result = matchBuilderCmsSafeModelIntentEntries(
      [
        entry({
          title: "Changed remotely",
          agentNativeTestNote: "agent-native-execution:marker",
        }),
      ],
      {
        marker: "agent-native-execution:marker",
        intendedFields: { title: "Intended title" },
      },
    );

    expect(result).toMatchObject({ count: 1, matchingIntentCount: 0 });
    expect(result.matches.map((match) => match.id)).toEqual(["remote-1"]);
  });

  it("keeps legacy title fallback constrained by every intended field", () => {
    const result = matchBuilderCmsSafeModelIntentEntries(
      [entry({ title: "Exact title", status: "changed" })],
      {
        exactTitle: "Exact title",
        intendedFields: { title: "Exact title", status: "intended" },
      },
    );
    expect(result).toMatchObject({ count: 1, matchingIntentCount: 0 });
  });
});
