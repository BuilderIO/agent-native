import { describe, expect, it } from "vitest";

import { sourcePropertyOptionsForSources } from "./_database-source-utils.js";

describe("sourcePropertyOptionsForSources", () => {
  it("preserves locally authored option descriptions by stable id during source refresh", () => {
    const options = sourcePropertyOptionsForSources(
      [
        { id: "source-a", sourceName: "Renamed source" },
        { id: "source-b", sourceName: "Second source" },
      ],
      [
        {
          id: "source-a",
          name: "Old source name",
          color: "purple",
          description: "Use this when the record came from the original feed.",
        },
        {
          id: "local",
          name: "Local",
          color: "gray",
          description: "Use for Content-only rows.",
        },
      ],
    );

    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "source-a",
          name: "Renamed source",
          description: "Use this when the record came from the original feed.",
        }),
        expect.objectContaining({
          id: "local",
          description: "Use for Content-only rows.",
        }),
      ]),
    );
    expect(
      options.find((option) => option.id === "source-b")?.description,
    ).toBeUndefined();
  });
});
