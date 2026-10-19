// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ callAction: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
}));

import {
  getGoogleDocsStatus,
  getGooglePickerToken,
} from "./google-docs-client";

describe("Google Docs action client", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reads status through the UI-only action with the current app origin", async () => {
    const status = { configured: true, connected: true };
    mocks.callAction.mockResolvedValue(status);

    await expect(getGoogleDocsStatus()).resolves.toEqual({
      ok: true,
      status: 200,
      data: status,
      unreadable: false,
    });
    expect(mocks.callAction).toHaveBeenCalledWith(
      "get-google-docs-status",
      { origin: window.location.origin },
      { method: "GET", uiOnly: true },
    );
  });

  it("reads the Picker token through the UI-only action", async () => {
    const token = {
      accessToken: "short-lived-token",
      accountEmail: "picker@example.com",
      apiKey: "picker-api-key",
      appId: "picker-app-id",
    };
    mocks.callAction.mockResolvedValue(token);

    await expect(getGooglePickerToken()).resolves.toMatchObject({
      ok: true,
      status: 200,
      data: token,
      unreadable: false,
    });
    expect(mocks.callAction).toHaveBeenCalledWith(
      "get-google-picker-token",
      {},
      { method: "GET", uiOnly: true },
    );
  });

  it("preserves action status and readable error details for callers", async () => {
    mocks.callAction.mockRejectedValue(
      Object.assign(new Error("Action get-google-picker-token failed."), {
        status: 422,
        actionMessage: "Google Picker is not configured.",
        errorCode: "missing_picker_config",
      }),
    );

    await expect(getGooglePickerToken()).resolves.toEqual({
      ok: false,
      status: 422,
      data: {
        error: "missing_picker_config",
        message: "Google Picker is not configured.",
      },
      unreadable: false,
    });
  });

  it("preserves unreadable action responses and lets transport failures reject", async () => {
    mocks.callAction.mockRejectedValueOnce(
      Object.assign(
        new Error(
          "Action get-google-docs-status returned 503 but the body could not be read: interrupted",
        ),
        { status: 503 },
      ),
    );
    await expect(getGoogleDocsStatus()).resolves.toMatchObject({
      ok: false,
      status: 503,
      data: null,
      unreadable: true,
    });

    mocks.callAction.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(getGoogleDocsStatus()).rejects.toThrow("Failed to fetch");
  });
});
