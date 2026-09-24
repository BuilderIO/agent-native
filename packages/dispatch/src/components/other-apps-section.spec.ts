import { describe, expect, it } from "vitest";

import {
  filterOtherAppEntries,
  mergeOtherAppEntries,
  otherAppEntryMatchesQuery,
} from "./other-apps-section.js";

describe("other app search", () => {
  const entries = mergeOtherAppEntries({
    templates: {
      templates: [
        {
          id: "brain",
          name: "Brain",
          description: "Search cited company knowledge",
          template: "brain",
          liveUrl: "https://brain.agent-native.com",
        },
      ],
    },
    connectedApps: [
      {
        id: "slides",
        name: "Slides",
        description: "Create presentations",
        url: "https://slides.agent-native.com",
      },
    ],
    workspaceApps: [],
  });

  it("matches linked and curated apps by name or description", () => {
    expect(
      entries.filter((entry) => otherAppEntryMatchesQuery(entry, "brain")),
    ).toHaveLength(1);
    expect(
      entries.filter((entry) =>
        otherAppEntryMatchesQuery(entry, "presentations"),
      ),
    ).toHaveLength(1);
  });

  it("filters the Other apps entries used by the page search", () => {
    expect(filterOtherAppEntries(entries, "brain")).toEqual([
      expect.objectContaining({ kind: "template" }),
    ]);
  });
});
