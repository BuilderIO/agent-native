import { ActionInputValidationError } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppStateForCurrentTab = vi.fn();

vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/application-state")
  >()),
  writeAppStateForCurrentTab: (...args: unknown[]) =>
    mockWriteAppStateForCurrentTab(...args),
}));

const mockGetUserLabEnabled = vi.fn();

vi.mock("@agent-native/core/labs/server", () => ({
  getUserLabEnabled: (...args: unknown[]) => mockGetUserLabEnabled(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "qa@example.com",
  getRequestOrgId: () => "org_1",
}));

import action from "./navigate";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserLabEnabled.mockResolvedValue(true);
});

describe("clips navigate action", () => {
  it("accepts the shared-with-me view", async () => {
    const result = await action.run({ view: "shared" });

    expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "shared",
    });
    expect(result).toBe("Navigating to shared");
  });

  it("accepts the renamed dictate view", async () => {
    const result = await action.run({ view: "dictate" });

    expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "dictate",
    });
    expect(result).toBe("Navigating to dictate");
  });

  it("carries meeting and dictation ids through to application state", async () => {
    await action.run({ view: "meeting", meetingId: "mtg_123" });
    await action.run({ view: "dictate", dictationId: "dct_456" });

    expect(mockWriteAppStateForCurrentTab).toHaveBeenNthCalledWith(
      1,
      "navigate",
      {
        view: "meeting",
        meetingId: "mtg_123",
      },
    );
    expect(mockWriteAppStateForCurrentTab).toHaveBeenNthCalledWith(
      2,
      "navigate",
      {
        view: "dictate",
        dictationId: "dct_456",
      },
    );
  });

  describe("with the Meetings Lab off", () => {
    beforeEach(() => {
      mockGetUserLabEnabled.mockResolvedValue(false);
    });

    it.each([
      { view: "meetings" as const },
      { view: "meeting" as const, meetingId: "mtg_123" },
      { path: "/meetings?tab=past" },
      { path: "/meetings/mtg_123" },
    ])("does not navigate to a meetings page: %j", async (args) => {
      const result = await action.run(args);

      expect(mockWriteAppStateForCurrentTab).not.toHaveBeenCalled();
      expect(result).toMatch(/Did not navigate/);
      expect(result).toMatch(/Labs/);
      expect(mockGetUserLabEnabled).toHaveBeenCalledWith(
        "qa@example.com",
        expect.objectContaining({ key: "clips.meetings" }),
        { userEmail: "qa@example.com", orgId: "org_1" },
      );
    });

    it("still navigates to non-meetings views without checking the Lab", async () => {
      const result = await action.run({ view: "library" });

      expect(mockGetUserLabEnabled).not.toHaveBeenCalled();
      expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
        view: "library",
      });
      expect(result).toBe("Navigating to library");
    });

    it("does not treat a similarly named path as a meetings page", async () => {
      await action.run({ path: "/meetings-archive" });

      expect(mockGetUserLabEnabled).not.toHaveBeenCalled();
      expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
        path: "/meetings-archive",
      });
    });
  });

  it("navigates to the past meetings tab when the Meetings Lab is on", async () => {
    const result = await action.run({ path: "/meetings?tab=past" });

    expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      path: "/meetings?tab=past",
    });
    expect(result).toBe("Navigating to /meetings?tab=past");
  });

  it("carries meetingsTab through to application state for the past meetings view", async () => {
    const result = await action.run({
      view: "meetings",
      meetingsTab: "past",
    });

    expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "meetings",
      meetingsTab: "past",
    });
    expect(result).toBe("Navigating to meetings:past");
  });

  it("carries viewer panel and playback context through to application state", async () => {
    const result = await action.run({
      view: "recording",
      recordingId: "rec_123",
      panel: "transcript",
      atMs: 42_000,
    });

    expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "recording",
      recordingId: "rec_123",
      panel: "transcript",
      atMs: 42_000,
    });
    expect(result).toBe("Navigating to recording:rec_123:transcript:42000");
  });

  it("accepts the browser diagnostics viewer panel", async () => {
    const result = await action.run({
      view: "recording",
      recordingId: "rec_123",
      panel: "debug",
    });

    expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "recording",
      recordingId: "rec_123",
      panel: "debug",
    });
    expect(result).toBe("Navigating to recording:rec_123:debug");
  });

  it.each([{}, { recordingId: "rec_123" }, { path: "" }, { path: "   " }])(
    "rejects an invalid destination before writing: %j",
    async (args) => {
      const failure = action.run(args);
      await expect(failure).rejects.toBeInstanceOf(ActionInputValidationError);
      await expect(failure).rejects.toThrow(/view|path/i);
      expect(mockWriteAppStateForCurrentTab).not.toHaveBeenCalled();
    },
  );

  it.each(["", "   ", "\t\n"])(
    "treats a blank path as absent when a view is provided: %j",
    async (path) => {
      const result = await action.run({ view: "library", path });

      expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
        view: "library",
      });
      expect(result).toBe("Navigating to library");
    },
  );

  it("accepts a raw path and preserves other navigation parameters", async () => {
    const result = await action.run({
      path: "/library?q=clips",
      spaceId: "space_123",
      folderId: "folder_123",
      shareId: "share_123",
      search: "clips",
      atMs: 0,
    });

    expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      path: "/library?q=clips",
      spaceId: "space_123",
      folderId: "folder_123",
      shareId: "share_123",
      search: "clips",
      atMs: 0,
    });
    expect(result).toBe("Navigating to /library?q=clips");
  });

  it("tells the model that view or path is required", () => {
    expect(action.tool.description).toMatch(/(?:view.*path|path.*view)/i);
    expect(action.tool.description).toMatch(/nonempty/i);
    expect(action.tool.description).toMatch(/requir/i);
    const properties = action.tool.parameters?.properties;
    expect(properties?.view.description).toMatch(/path.*requir|requir.*path/i);
    expect(properties?.view.description).toMatch(/nonempty/i);
    expect(properties?.path.description).toMatch(/view.*requir|requir.*view/i);
    expect(properties?.path.description).toMatch(/nonempty/i);
  });
});
