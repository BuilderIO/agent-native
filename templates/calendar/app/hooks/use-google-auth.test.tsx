// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client", () => ({
  agentNativePath: (path: string) => path,
  isInBuilderFrame: () => false,
  oauthRedirectUri: (path: string) => `http://localhost${path}`,
}));

import { useGoogleDesktopAuth, type DesktopAuthIssue } from "./use-google-auth";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type DesktopAuthControls = ReturnType<typeof useGoogleDesktopAuth>;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let controls: DesktopAuthControls | null = null;

function Harness({ onError }: { onError: (issue: DesktopAuthIssue) => void }) {
  const auth = useGoogleDesktopAuth({ onError });

  useEffect(() => {
    controls = auth;
  }, [auth]);

  return null;
}

function renderHarness(onError = vi.fn()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Harness onError={onError} />);
  });
  return onError;
}

function popupWindow() {
  const popup = {
    closed: false,
    location: { href: "about:blank" },
    close: vi.fn(() => {
      popup.closed = true;
    }),
  };
  return popup;
}

describe("useGoogleDesktopAuth", () => {
  beforeEach(() => {
    controls = null;
    Object.defineProperty(window.navigator, "userAgent", {
      value: "AgentNativeDesktop",
      configurable: true,
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports missing credentials without navigating the popup to JSON", async () => {
    const popup = popupWindow();
    const onError = renderHarness();
    const open = vi
      .spyOn(window, "open")
      .mockImplementation(() => popup as unknown as Window);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error: "missing_credentials",
            message:
              "Google Calendar OAuth credentials are not configured. Save GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in settings.",
          }),
          { status: 422 },
        );
      }),
    );

    act(() => {
      expect(controls?.startDesktopGoogleAuth()).toBe(true);
    });

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "missing_credentials",
          error: "missing_credentials",
          message:
            "Google Calendar OAuth credentials are not configured. Save GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in settings.",
        }),
      );
    });

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(popup.location.href).toBe("about:blank");
    expect(popup.close).toHaveBeenCalled();
  });

  it("navigates the temporary popup after receiving a valid auth URL", async () => {
    const popup = popupWindow();
    renderHarness();
    vi.spyOn(window, "open").mockImplementation(
      () => popup as unknown as Window,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).startsWith("/_agent-native/google/auth-url")) {
          return new Response(
            JSON.stringify({
              url: "https://accounts.google.com/o/oauth2/v2/auth?state=ok",
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ pending: true }), {
          status: 200,
        });
      }),
    );

    act(() => {
      expect(controls?.startDesktopGoogleAuth()).toBe(true);
    });

    await vi.waitFor(() => {
      expect(popup.location.href).toBe(
        "https://accounts.google.com/o/oauth2/v2/auth?state=ok",
      );
    });
  });
});
