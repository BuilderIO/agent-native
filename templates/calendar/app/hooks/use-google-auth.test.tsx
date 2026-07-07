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

function Harness({
  onError,
  onSuccess,
}: {
  onError: (issue: DesktopAuthIssue) => void;
  onSuccess?: (result: unknown) => void;
}) {
  const auth = useGoogleDesktopAuth({ onError, onSuccess });

  useEffect(() => {
    controls = auth;
  }, [auth]);

  return null;
}

function renderHarness(
  onError = vi.fn(),
  onSuccess?: (result: unknown) => void,
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Harness onError={onError} onSuccess={onSuccess} />);
  });
  return onError;
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

  it("reports missing credentials without opening the browser to JSON", async () => {
    const onError = renderHarness();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
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

    expect(open).not.toHaveBeenCalled();
  });

  it("opens the browser after receiving a valid auth URL", async () => {
    renderHarness();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
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
      expect(open).toHaveBeenCalledWith(
        "https://accounts.google.com/o/oauth2/v2/auth?state=ok",
        "_blank",
      );
    });
  });

  it("detects the desktop preload even when the user agent marker is missing", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0",
      configurable: true,
    });
    vi.stubGlobal("agentNativeDesktop", {});

    renderHarness();

    expect(controls?.isDesktopGoogleAuth).toBe(true);
  });

  it("claims a desktop exchange token and reports success", async () => {
    const onSuccess = vi.fn();
    renderHarness(vi.fn(), onSuccess);
    vi.spyOn(window, "open").mockImplementation(() => null);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/_agent-native/google/auth-url")) {
        return new Response(
          JSON.stringify({
            url: "https://accounts.google.com/o/oauth2/v2/auth?state=ok",
          }),
          { status: 200 },
        );
      }
      if (url.startsWith("/_agent-native/auth/desktop-exchange")) {
        return new Response(
          JSON.stringify({ token: "token-1", email: "owner@example.com" }),
          { status: 200 },
        );
      }
      if (url.startsWith("/_agent-native/auth/session")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ connected: false }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      expect(controls?.startDesktopGoogleAuth()).toBe(true);
    });

    await vi.waitFor(
      () => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/_agent-native/auth/session?_session=token-1",
          { credentials: "include" },
        );
      },
      { timeout: 4_000 },
    );
    expect(onSuccess).toHaveBeenCalledWith({
      token: "token-1",
      email: "owner@example.com",
    });
  });
});
