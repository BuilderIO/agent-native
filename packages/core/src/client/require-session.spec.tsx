// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Control the session state directly so the gate's behaviour is tested in
// isolation from the session-fetch plumbing.
const useSessionMock = vi.fn();
vi.mock("./use-session.js", () => ({
  useSession: () => useSessionMock(),
}));

import { decodeContinuation } from "../shared/sign-in-journey.js";
import { RequireSession, buildSignInReturnHref } from "./require-session.js";

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
    expect(container.querySelector('[aria-label="Loading"]')).not.toBeNull();
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
    // Shows the fallback rather than flashing app chrome the visitor can't use.
    expect(container.querySelector('[data-testid="protected"]')).toBeNull();
    expect(replaceMock).toHaveBeenCalledTimes(1);
    const href = replaceMock.mock.calls[0][0] as string;
    expect(href).toContain("/_agent-native/sign-in?c=");
    // A PATH, not a re-encoded URL: nothing downstream can nest it.
    expect(href).not.toContain("%2F");
    expect(continuationOf(href)).toBe("/inbox?label=important");
  });

  it("never redirects when already on the sign-in page (no infinite loop)", () => {
    // The base-path deploy case where the app shell is served at the sign-in
    // path. Redirecting here used to nest the sign-in URL as a fresh
    // `?return=` and loop forever. `signInJourney` returns `signInHref: null`
    // here, which is the only thing left standing between this surface and a
    // same-URL replace loop — it must never gain a fallback.
    stubLocation("/_agent-native/sign-in", "?c=abc");
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

  it("never redirects from /login or /signup under a base-path deploy", () => {
    // `/myapp/login` carries no `/_agent-native` marker, so the login page's
    // old marker-only base resolver returned "" and failed to recognise it as
    // an auth entry path — a live, reproducible infinite bounce.
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
    // A transient 5xx must read as neither "signed out" (which bounces a
    // signed-in user to sign-in) nor "still loading" (which strands them).
    useSessionMock.mockReturnValue({
      session: null,
      // The real hook keeps isLoading true for "unavailable" so legacy
      // isLoading-only consumers never misread it as signed-out.
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
    expect(container.textContent).toContain("Try again");
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
        "/_agent-native/sign-in",
      );
    }
  });

  it("rejects a continuation escaping the app base path", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/mail");
    stubLocation("/mail/inbox");
    expect(buildSignInReturnHref()).toContain("/mail/_agent-native/sign-in?c=");
    // Same-origin sibling app on a multi-app workspace host.
    expect(buildSignInReturnHref({ returnTo: "/otherapp/admin" })).toBe(
      "/mail/_agent-native/sign-in",
    );
    vi.unstubAllEnvs();
  });
});
