import { describe, expect, it, vi } from "vitest";

import { openMeetingJoinUrl } from "./open-meeting-join-url";

describe("openMeetingJoinUrl", () => {
  const zoomUrl = "https://zoom.us/j/123456789?pwd=fake-passcode";
  const nativeZoomUrl =
    "zoommtg://zoom.us/join?action=join&confno=123456789&pwd=fake-passcode";

  it("opens Zoom in its native desktop app first", async () => {
    const open = vi.fn().mockResolvedValue(undefined);

    await openMeetingJoinUrl(zoomUrl, open);

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(nativeZoomUrl);
  });

  it("falls back to the original browser URL when native Zoom is unavailable", async () => {
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error("No application can open zoommtg"))
      .mockResolvedValueOnce(undefined);

    await openMeetingJoinUrl(zoomUrl, open);

    expect(open).toHaveBeenNthCalledWith(1, nativeZoomUrl);
    expect(open).toHaveBeenNthCalledWith(2, zoomUrl);
  });

  it("opens non-Zoom links only once", async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    const joinUrl = "https://meet.google.com/abc-defg-hij";

    await openMeetingJoinUrl(joinUrl, open);

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(joinUrl);
  });

  it("surfaces an error when the browser fallback also cannot open", async () => {
    const fallbackError = new Error("Browser unavailable");
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error("No application can open zoommtg"))
      .mockRejectedValueOnce(fallbackError);

    await expect(openMeetingJoinUrl(zoomUrl, open)).rejects.toThrow(
      fallbackError,
    );
  });
});
