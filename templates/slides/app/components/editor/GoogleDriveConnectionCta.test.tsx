// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => `/agent${path}`,
}));

vi.mock("@agent-native/core/client/host", () => ({
  oauthRedirectUri: (path: string) => `https://slides.example${path}`,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "home.googleSlidesReferenceConnect":
        "Connect Google Drive to import a Slides deck.",
      "raw.googleOAuthNotConfigured": "Google Drive OAuth is not configured.",
      "home.googleSlidesReferencePicking": "Working...",
      "editorExport.connectGoogle": "Connect Google",
    })[key] ?? key,
}));

import { GoogleDriveConnectionCta } from "./GoogleDriveConnectionCta";

describe("<GoogleDriveConnectionCta>", () => {
  beforeEach(() => {
    const statusResponses = [false, true];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/status")) {
        return new Response(
          JSON.stringify({
            configured: true,
            connected: statusResponses.shift() ?? true,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          url: "https://accounts.google.com/o/oauth2/v2/auth?state=test",
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

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

  it("opens the app-owned OAuth flow and hides the CTA after connection", async () => {
    const openedTab = {
      close: vi.fn(),
      closed: false,
      location: { href: "" },
    };
    vi.spyOn(window, "open").mockReturnValue(openedTab as unknown as Window);

    render(<GoogleDriveConnectionCta />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect Google" }),
    );

    await waitFor(() => {
      expect(window.open).toHaveBeenCalledWith(
        "about:blank",
        "google-docs-oauth",
        "popup,width=520,height=720",
      );
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          "/agent/_agent-native/google-docs/auth-url?redirect_uri=",
        ),
        { credentials: "same-origin" },
      );
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Connect Google" }),
      ).toBeNull();
    });
    expect(openedTab.close).toHaveBeenCalledOnce();
  });
});
