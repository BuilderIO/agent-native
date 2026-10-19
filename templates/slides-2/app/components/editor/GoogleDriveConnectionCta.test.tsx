// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getGoogleDocsStatusMock } = vi.hoisted(() => ({
  getGoogleDocsStatusMock: vi.fn(),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => `/agent${path}`,
}));

vi.mock("@agent-native/core/client/host", () => ({
  oauthRedirectUri: (path: string) => `https://slides.example${path}`,
}));

vi.mock("@agent-native/core/client/integrations", () => ({
  startWorkspaceProviderOAuth: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => {
  const messages: Record<string, string> = {
    "home.googleSlidesReferenceConnect":
      "Connect Google Drive to import a Slides deck.",
    "raw.googleOAuthNotConfigured": "Google Drive OAuth is not configured.",
    "home.googleSlidesReferencePicking": "Working...",
    "editorExport.connectGoogle": "Connect Google",
    "comments.close": "Close",
  };
  const translate = (key: string) => messages[key] ?? key;
  return { useT: () => translate };
});

vi.mock("@/lib/google-docs-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/google-docs-client")>()),
  getGoogleDocsStatus: getGoogleDocsStatusMock,
}));

import { startWorkspaceProviderOAuth } from "@agent-native/core/client/integrations";

import { GoogleDriveConnectionCta } from "./GoogleDriveConnectionCta";

describe("<GoogleDriveConnectionCta>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGoogleDocsStatusMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { configured: true, connected: false },
      unreadable: false,
    });

    const realSetTimeout = window.setTimeout.bind(window);
    vi.spyOn(window, "setTimeout").mockImplementation(((
      handler: TimerHandler,
      _timeout?: number,
      ...args: any[]
    ) => realSetTimeout(handler, 0, ...args)) as typeof window.setTimeout);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a direct Connect Google button when Drive is disconnected", async () => {
    render(<GoogleDriveConnectionCta />);

    expect(
      await screen.findByRole("button", { name: "Connect Google" }),
    ).toBeTruthy();
  });

  it("stays quiet until a pasted Slides link is detected", async () => {
    render(<GoogleDriveConnectionCta active={false} />);

    expect(getGoogleDocsStatusMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Connect Google" })).toBeNull();
  });

  it("checks the connection when a pasted Slides link becomes active", async () => {
    const { rerender } = render(<GoogleDriveConnectionCta active={false} />);

    rerender(<GoogleDriveConnectionCta active />);

    expect(
      await screen.findByRole("button", { name: "Connect Google" }),
    ).toBeTruthy();
    expect(getGoogleDocsStatusMock).toHaveBeenCalledTimes(1);
    expect(getGoogleDocsStatusMock).toHaveBeenCalledWith();
  });

  it("can be dismissed without starting OAuth", async () => {
    render(<GoogleDriveConnectionCta />);

    fireEvent.click(await screen.findByRole("button", { name: "Close" }));

    expect(screen.queryByRole("button", { name: "Connect Google" })).toBeNull();
    expect(getGoogleDocsStatusMock).toHaveBeenCalledTimes(1);
  });

  it("shows the reconnect button for a connected account without URL-import access", async () => {
    getGoogleDocsStatusMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        configured: true,
        connected: true,
        googleSlidesUrlImportReady: false,
      },
      unreadable: false,
    });

    render(<GoogleDriveConnectionCta />);

    expect(
      await screen.findByRole("button", { name: "Connect Google" }),
    ).toBeTruthy();
  });

  it("keeps the reconnect button available when managed OAuth needs repair", async () => {
    getGoogleDocsStatusMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        configured: true,
        connected: true,
        googleSlidesUrlImportReady: false,
        googleSlidesUrlImportError: "Google authorization expired",
      },
      unreadable: false,
    });

    render(<GoogleDriveConnectionCta />);

    expect(
      await screen.findByText("Google authorization expired"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect Google" })).toBeTruthy();
  });

  it("starts the managed Drive OAuth flow", async () => {
    render(<GoogleDriveConnectionCta />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect Google" }),
    );

    await waitFor(() => {
      expect(startWorkspaceProviderOAuth).toHaveBeenCalledWith(
        "google_drive",
        expect.objectContaining({ appId: "slides", scope: "user" }),
      );
    });
  });

  it("surfaces a status failure instead of hiding the connection problem", async () => {
    getGoogleDocsStatusMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      data: {
        error: "OAuth status unavailable",
        message: "OAuth status unavailable",
      },
      unreadable: false,
    });

    render(<GoogleDriveConnectionCta />);

    expect(await screen.findByText("OAuth status unavailable")).toBeTruthy();
  });
});
