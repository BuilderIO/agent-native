// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useSessionMock = vi.fn();
vi.mock("@agent-native/core/client/use-session", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/use-session")
  >()),
  useSession: () => useSessionMock(),
}));

import { buildSignInReturnHref } from "@agent-native/core/client/sign-in-return";
import { useActionQuery } from "@agent-native/core/client/use-action";
import {
  navigateForSession,
  useSessionPreloading,
} from "@agent-native/core/client/use-session";
import {
  decodeContinuation,
  SIGN_IN_ENTRY_PATH,
  SIGN_IN_LEGACY_ENTRY_PATH,
} from "@agent-native/core/shared/sign-in-journey";
import { SESSION_NAVIGATION_STALL_MS } from "@agent-native/core/shared/ssr-session-bootstrap";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { RequireSession } from "./RequireSession.js";

function stubLocation(pathname: string, search = "", hash = "") {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      pathname,
      search,
      hash,
      origin: "https://mail.example.com",
      href: `https://mail.example.com${pathname}${search}${hash}`,
      replace: replaceMock,
      assign: vi.fn(),
      reload: vi.fn(),
    },
  });
}

function continuationOf(href: string): string | null {
  return decodeContinuation(
    new URL(href, "https://mail.example.com").searchParams.get("c"),
  );
}

let container: HTMLDivElement;
let root: Root;
let replaceMock: ReturnType<typeof vi.fn>;
let originalLocation: Location;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  replaceMock = vi.fn();
  originalLocation = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      pathname: "/inbox",
      search: "?label=important",
      hash: "",
      origin: "https://mail.example.com",
      href: "https://mail.example.com/inbox?label=important",
      replace: replaceMock,
      assign: vi.fn(),
      reload: vi.fn(),
    },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
  delete window.__agentNativeNavigationStarted;
  vi.clearAllMocks();
});

function render(ui: React.ReactElement) {
  act(() => {
    root.render(ui);
  });
}

const Child = () => <div data-testid="protected">inbox</div>;

describe("RequireSession", () => {
  it("shows a loading fallback while the session resolves and never redirects", () => {
    useSessionMock.mockReturnValue({
      session: null,
      isLoading: true,
      status: "loading",
    });
    render(
      <RequireSession>
        <Child />
      </RequireSession>,
    );
    expect(container.querySelector('[data-testid="protected"]')).toBeNull();
    expect(
      container.querySelector('[data-agent-native-app-skeleton="true"]'),
    ).not.toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("renders children once a session is present", () => {
    useSessionMock.mockReturnValue({
      session: { userId: "u1", email: "a@b.com" },
      isLoading: false,
      status: "authenticated",
    });
    render(
      <RequireSession>
        <Child />
      </RequireSession>,
    );
    expect(container.querySelector('[data-testid="protected"]')).not.toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("redirects to the framework sign-in page carrying an opaque continuation", () => {
    useSessionMock.mockReturnValue({
      session: null,
      isLoading: false,
      status: "unauthenticated",
    });
    render(
      <RequireSession>
        <Child />
      </RequireSession>,
    );
    expect(container.querySelector('[data-testid="protected"]')).toBeNull();
    expect(replaceMock).toHaveBeenCalledTimes(1);
    const href = replaceMock.mock.calls[0][0] as string;
    expect(href).toContain(`${SIGN_IN_ENTRY_PATH}?c=`);
    expect(href).not.toContain("%2F");
    expect(continuationOf(href)).toBe("/inbox?label=important");
  });

  it("never redirects when already on the sign-in page (no infinite loop)", () => {
    stubLocation(SIGN_IN_ENTRY_PATH, "?c=abc");
    useSessionMock.mockReturnValue({
      session: null,
      isLoading: false,
      status: "unauthenticated",
    });
    render(
      <RequireSession>
        <Child />
      </RequireSession>,
    );
    expect(replaceMock).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="protected"]')).toBeNull();
  });

  it("still recognizes the legacy sign-in alias without redirecting", () => {
    stubLocation(SIGN_IN_LEGACY_ENTRY_PATH, "?c=abc");
    useSessionMock.mockReturnValue({
      session: null,
      isLoading: false,
      status: "unauthenticated",
    });
    render(
      <RequireSession>
        <Child />
      </RequireSession>,
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("never redirects from /login or /signup under a base-path deploy", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/myapp");
    useSessionMock.mockReturnValue({
      session: null,
      isLoading: false,
      status: "unauthenticated",
    });
    for (const path of ["/myapp/login", "/myapp/signup"]) {
      stubLocation(path);
      render(
        <RequireSession>
          <Child />
        </RequireSession>,
      );
      expect(replaceMock).not.toHaveBeenCalled();
    }
    vi.unstubAllEnvs();
  });

  it("keeps an authenticated app mounted when a lane switch it never left on is claimed", () => {
    useSessionMock.mockReturnValue({
      session: { userId: "u1", email: "a@builder.io" },
      isLoading: false,
      status: "authenticated",
    });
    const mounts = vi.fn();
    function Editor() {
      React.useEffect(() => mounts(), []);
      return <div data-testid="protected">editor</div>;
    }
    render(
      <RequireSession>
        <Editor />
      </RequireSession>,
    );

    // The badge claims the page for the beta lane; a beforeunload "Stay"
    // (unsaved edits) keeps the document here.
    act(() => {
      navigateForSession("https://beta.mail.example.com/inbox");
    });
    render(
      <RequireSession>
        <Editor />
      </RequireSession>,
    );

    expect(container.querySelector('[data-testid="protected"]')).not.toBeNull();
    expect(mounts).toHaveBeenCalledTimes(1);
  });

  it("holds the app while a navigation claimed before it rendered is in flight, then renders it if the page stays", () => {
    vi.useFakeTimers();
    try {
      useSessionMock.mockReturnValue({
        session: { userId: "u1", email: "a@builder.io" },
        isLoading: false,
        status: "authenticated",
      });
      // The inline lane script claimed the page before React rendered.
      navigateForSession("https://beta.mail.example.com/inbox");
      render(
        <RequireSession>
          <Child />
        </RequireSession>,
      );
      expect(container.querySelector('[data-testid="protected"]')).toBeNull();

      act(() => {
        vi.advanceTimersByTime(SESSION_NAVIGATION_STALL_MS);
      });

      expect(
        container.querySelector('[data-testid="protected"]'),
      ).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not redirect twice across re-renders", () => {
    useSessionMock.mockReturnValue({
      session: null,
      isLoading: false,
      status: "unauthenticated",
    });
    render(
      <RequireSession>
        <Child />
      </RequireSession>,
    );
    render(
      <RequireSession>
        <Child />
      </RequireSession>,
    );
    expect(replaceMock).toHaveBeenCalledTimes(1);
  });

  it("renders `signedOut` instead of redirecting when redirect is disabled", () => {
    useSessionMock.mockReturnValue({
      session: null,
      isLoading: false,
      status: "unauthenticated",
    });
    render(
      <RequireSession redirect={false} signedOut={<div>please sign in</div>}>
        <Child />
      </RequireSession>,
    );
    expect(container.textContent).toContain("please sign in");
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("shows a recoverable notice when the session is unreadable", () => {
    useSessionMock.mockReturnValue({
      session: null,
      isLoading: true,
      status: "unavailable",
      error: new Error("Could not read the session after 4 attempts."),
      retry: vi.fn(),
    });
    render(
      <RequireSession>
        <Child />
      </RequireSession>,
    );
    expect(replaceMock).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="protected"]')).toBeNull();
    expect(container.querySelector('[aria-label="Loading"]')).toBeNull();
    expect(container.textContent).toContain("Retry connection");
    expect(container.textContent).toContain("Reload page starts the app over");
  });

  it("unmounts the app shell while signing out without redirecting", () => {
    // Sign-out owns the navigation: it must finish revoking the server session
    // before the browser leaves, so a redirect from here would race it. But the
    // shell has to come down immediately — this is the window where its queries
    // had no cookie and painted "Couldn't load data" over the app.
    useSessionMock.mockReturnValue({
      session: null,
      isLoading: true,
      status: "signing-out",
      error: null,
      retry: vi.fn(),
    });
    render(
      <RequireSession>
        <Child />
      </RequireSession>,
    );
    expect(container.querySelector('[data-testid="protected"]')).toBeNull();
    expect(
      container.querySelector('[data-agent-native-app-skeleton="true"]'),
    ).not.toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("bypass renders children even with no session", () => {
    useSessionMock.mockReturnValue({
      session: null,
      isLoading: false,
      status: "unauthenticated",
    });
    render(
      <RequireSession bypass>
        <Child />
      </RequireSession>,
    );
    expect(container.querySelector('[data-testid="protected"]')).not.toBeNull();
    expect(useSessionMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

describe("RequireSession action reads while the session resolves", () => {
  let queryClient: QueryClient;

  function setSessionHintCookie(present: boolean) {
    document.cookie = present
      ? "an_session_hint=1; path=/"
      : "an_session_hint=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  }

  function designsRequests(fetchMock: ReturnType<typeof vi.fn>): number {
    return fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/_agent-native/actions/list-designs"),
    ).length;
  }

  function DesignsChild() {
    const designs = useActionQuery("list-designs");
    return (
      <div data-testid="protected">
        {designs.isSuccess ? "designs" : "pending"}
      </div>
    );
  }

  function renderShell() {
    render(
      <QueryClientProvider client={queryClient}>
        <RequireSession>
          <DesignsChild />
        </RequireSession>
      </QueryClientProvider>,
    );
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function designsFetch(status = 200) {
    return vi.fn(
      async () =>
        new Response(JSON.stringify(status === 200 ? [{ id: "d1" }] : {}), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
    );
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    queryClient = new QueryClient();
  });

  afterEach(() => {
    setSessionHintCookie(false);
    queryClient.clear();
    vi.unstubAllGlobals();
  });

  it("starts the action read before the session resolves when a hint exists", async () => {
    setSessionHintCookie(true);
    const fetchMock = designsFetch();
    vi.stubGlobal("fetch", fetchMock);
    useSessionMock.mockReturnValue({
      session: null,
      isLoading: true,
      status: "loading",
    });

    renderShell();
    await settle();

    expect(designsRequests(fetchMock)).toBe(1);
    expect(
      container.querySelector('[data-agent-native-app-skeleton="true"]'),
    ).not.toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("keeps the app tree mounted when the session resolves, so the early read is not repeated", async () => {
    setSessionHintCookie(true);
    const fetchMock = designsFetch();
    vi.stubGlobal("fetch", fetchMock);
    useSessionMock.mockReturnValue({
      session: null,
      isLoading: true,
      status: "loading",
    });
    renderShell();
    await settle();

    useSessionMock.mockReturnValue({
      session: { userId: "u1", email: "a@b.com" },
      isLoading: false,
      status: "authenticated",
    });
    renderShell();
    await settle();

    expect(
      container.querySelector('[data-testid="protected"]')?.textContent,
    ).toBe("designs");
    expect(designsRequests(fetchMock)).toBe(1);
  });

  it("marks the hidden preload so identity-scoped reads wait for the session", () => {
    setSessionHintCookie(true);
    vi.stubGlobal("fetch", designsFetch());
    function PreloadProbe() {
      return (
        <div data-testid="preloading">{String(useSessionPreloading())}</div>
      );
    }
    const probe = () =>
      container.querySelector('[data-testid="preloading"]')?.textContent;
    useSessionMock.mockReturnValue({
      session: null,
      isLoading: true,
      status: "loading",
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RequireSession>
          <PreloadProbe />
        </RequireSession>
      </QueryClientProvider>,
    );
    expect(probe()).toBe("true");

    useSessionMock.mockReturnValue({
      session: { userId: "u1", email: "a@b.com" },
      isLoading: false,
      status: "authenticated",
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RequireSession>
          <PreloadProbe />
        </RequireSession>
      </QueryClientProvider>,
    );
    expect(probe()).toBe("false");
  });

  it("does not start the action read before the session resolves without a hint", async () => {
    const fetchMock = designsFetch();
    vi.stubGlobal("fetch", fetchMock);
    useSessionMock.mockReturnValue({
      session: null,
      isLoading: true,
      status: "loading",
    });

    renderShell();
    await settle();

    expect(designsRequests(fetchMock)).toBe(0);
    expect(container.querySelector('[data-testid="protected"]')).toBeNull();
  });

  it("still redirects to sign-in when a hinted read is refused and the session resolves signed out", async () => {
    setSessionHintCookie(true);
    const fetchMock = designsFetch(401);
    vi.stubGlobal("fetch", fetchMock);
    useSessionMock.mockReturnValue({
      session: null,
      isLoading: true,
      status: "loading",
    });
    renderShell();
    await settle();

    useSessionMock.mockReturnValue({
      session: null,
      isLoading: false,
      status: "unauthenticated",
    });
    renderShell();
    await settle();

    expect(designsRequests(fetchMock)).toBe(1);
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock.mock.calls[0][0]).toContain(`${SIGN_IN_ENTRY_PATH}?c=`);
    expect(container.querySelector('[data-testid="protected"]')).toBeNull();
  });
});

describe("buildSignInReturnHref", () => {
  it("honours an explicit returnTo", () => {
    expect(
      continuationOf(buildSignInReturnHref({ returnTo: "/a/b?c=1#d" })),
    ).toBe("/a/b?c=1#d");
  });

  it("refuses to build an open redirect", () => {
    for (const evil of [
      "https://evil.com/path",
      "//evil.com",
      "/\\evil.com/path",
      "/foo\r\nLocation: /evil",
    ]) {
      expect(buildSignInReturnHref({ returnTo: evil })).toBe(
        SIGN_IN_ENTRY_PATH,
      );
    }
  });

  it("rejects a continuation escaping the app base path", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/mail");
    stubLocation("/mail/inbox");
    expect(buildSignInReturnHref()).toContain(`/mail${SIGN_IN_ENTRY_PATH}?c=`);
    expect(buildSignInReturnHref({ returnTo: "/otherapp/admin" })).toBe(
      `/mail${SIGN_IN_ENTRY_PATH}`,
    );
    vi.unstubAllEnvs();
  });
});
