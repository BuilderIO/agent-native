import { describe, expect, it } from "vitest";

import { webCaptureSenderAllowed, webCaptureUrl } from "./web-capture";

describe("prepared extension web capture", () => {
  it("carries the frozen session and explicit history consent without putting source evidence in the URL", () => {
    const url = new URL(
      webCaptureUrl({
        clipsBaseUrl: "https://clips.example.com",
        extensionId: "extension",
        sessionId: "frozen-source",
        mode: "screen",
        surface: "browser",
        developerLogs: true,
        diagnosticConsent: true,
        requestedHistorySeconds: 300,
      }),
    );
    expect(url.pathname).toBe("/record");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      mode: "screen",
      surface: "browser",
      clipsExtensionId: "extension",
      clipsCaptureSessionId: "frozen-source",
      developerLogs: "1",
      privateContextConsent: "1",
      privateContextHistorySeconds: "300",
    });
  });

  it("requires the prepared recorder tab and configured Clips origin for every bridge message", () => {
    const input = {
      clipsBaseUrl: "https://clips.example.com",
      recorderTabId: 21,
      senderTabId: 21,
      senderUrl: "https://clips.example.com/record",
    };
    expect(webCaptureSenderAllowed(input)).toBe(true);
    expect(webCaptureSenderAllowed({ ...input, senderTabId: 22 })).toBe(false);
    expect(
      webCaptureSenderAllowed({
        ...input,
        senderUrl: "https://other.example.com/record",
      }),
    ).toBe(false);
    expect(webCaptureSenderAllowed({ ...input, senderUrl: undefined })).toBe(
      false,
    );
  });
});
