import { describe, expect, it } from "vitest";

import { filterOtherApps } from "./other-apps.js";

describe("filterOtherApps", () => {
  it("keeps available linked apps while excluding workspace apps", () => {
    expect(
      filterOtherApps(
        [
          {
            id: "slides",
            name: "Slides",
            url: "https://slides.agent-native.com",
          },
          {
            id: "analytics",
            name: "Analytics",
            description: "Explore data",
            url: "https://analytics.agent-native.com",
          },
          {
            id: "coach",
            name: "Coach",
            url: "https://workspace.example.com/coach",
            source: "workspace",
          },
          {
            id: "dispatch",
            name: "Dispatch",
            url: "https://dispatch.agent-native.com",
          },
        ],
        [{ id: "coach" }],
      ),
    ).toEqual([
      {
        id: "analytics",
        name: "Analytics",
        description: "Explore data",
        url: "https://analytics.agent-native.com",
      },
      {
        id: "slides",
        name: "Slides",
        url: "https://slides.agent-native.com",
      },
    ]);
  });

  it("drops invalid URLs and duplicate app ids", () => {
    expect(
      filterOtherApps(
        [
          {
            id: "analytics",
            name: "Analytics",
            url: "https://analytics.agent-native.com",
          },
          {
            id: "Analytics",
            name: "Analytics duplicate",
            url: "https://duplicate.example.com",
          },
          { id: "relative", name: "Relative", url: "/relative" },
        ],
        [],
      ),
    ).toEqual([
      {
        id: "analytics",
        name: "Analytics",
        url: "https://analytics.agent-native.com",
      },
    ]);
  });
});
