import { describe, expect, it } from "vitest";

import { pathFromCommand, stateFromLocation } from "./use-navigation-state";

describe("Clips shared navigation", () => {
  it("describes the shared-with-me route to the agent", () => {
    expect(stateFromLocation("/shared", "")).toEqual({ view: "shared" });
  });

  it("maps agent navigation commands to the shared-with-me route", () => {
    expect(pathFromCommand({ view: "shared" })).toBe("/shared");
  });

  it("describes the focused viewer panel and requested timestamp", () => {
    expect(
      stateFromLocation("/r/recording-1", "?panel=transcript&at=42000"),
    ).toEqual({
      view: "recording",
      recordingId: "recording-1",
      panel: "transcript",
      atMs: 42_000,
    });
  });

  it("maps recording context commands to a focused viewer URL", () => {
    expect(
      pathFromCommand({
        view: "recording",
        recordingId: "recording-1",
        panel: "agent",
        atMs: 12_345.6,
      }),
    ).toBe("/r/recording-1?panel=agent&at=12346");
  });

  it("round-trips encoded resource IDs", () => {
    const cases = [
      {
        command: { view: "recording", recordingId: "clip/with space" } as const,
        expectedPath: "/r/clip%2Fwith%20space",
        expectedState: {
          view: "recording",
          recordingId: "clip/with space",
        },
      },
      {
        command: { view: "share", shareId: "share/id" } as const,
        expectedPath: "/share/share%2Fid",
        expectedState: { view: "share", shareId: "share/id" },
      },
      {
        command: { view: "space", spaceId: "team space" } as const,
        expectedPath: "/spaces/team%20space",
        expectedState: { view: "space", spaceId: "team space" },
      },
      {
        command: { view: "meeting", meetingId: "meeting/id" } as const,
        expectedPath: "/meetings/meeting%2Fid",
        expectedState: { view: "meeting", meetingId: "meeting/id" },
      },
      {
        command: { view: "library", folderId: "folder/id" } as const,
        expectedPath: "/library/folder/folder%2Fid",
        expectedState: { view: "library", folderId: "folder/id" },
      },
    ];

    for (const { command, expectedPath, expectedState } of cases) {
      const path = pathFromCommand(command);
      expect(path).toBe(expectedPath);
      expect(stateFromLocation(path, "")).toEqual(expectedState);
    }
  });

  it("rejects malformed encoded route IDs", () => {
    expect(stateFromLocation("/r/%E0%A4%A", "")).toEqual({
      view: "library",
    });
    expect(stateFromLocation("/share/%", "")).toEqual({ view: "library" });
    expect(stateFromLocation("/spaces/%E0", "")).toEqual({ view: "library" });
  });

  it("uses the recording panel URL for insights", () => {
    expect(stateFromLocation("/r/recording-1", "?panel=insights")).toEqual({
      view: "insights",
      recordingId: "recording-1",
      panel: "insights",
    });
    expect(
      pathFromCommand({ view: "insights", recordingId: "recording-1" }),
    ).toBe("/r/recording-1?panel=insights");
    expect(stateFromLocation("/r/recording-1/insights", "")).toEqual({
      view: "library",
    });
  });
});
