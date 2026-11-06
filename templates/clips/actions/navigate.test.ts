import { ActionInputValidationError } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppStateForCurrentTab = vi.fn();

vi.mock("@agent-native/core/application-state", () => ({
  writeAppStateForCurrentTab: (...args: unknown[]) =>
    mockWriteAppStateForCurrentTab(...args),
}));

import action from "./navigate";

beforeEach(() => {
  vi.clearAllMocks();
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

  it.each([
    {},
    { recordingId: "rec_123" },
    { path: "" },
    { path: "   " },
    { view: "library" as const, path: "" },
  ])("rejects an invalid destination before writing: %j", async (args) => {
    const failure = action.run(args);
    await expect(failure).rejects.toBeInstanceOf(ActionInputValidationError);
    await expect(failure).rejects.toThrow(/view|path/i);
    expect(mockWriteAppStateForCurrentTab).not.toHaveBeenCalled();
  });

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
    expect(properties?.view?.description).toMatch(/path.*requir|requir.*path/i);
    expect(properties?.view?.description).toMatch(/nonempty/i);
    expect(properties?.path?.description).toMatch(/view.*requir|requir.*view/i);
    expect(properties?.path?.description).toMatch(/nonempty/i);
  });
});
