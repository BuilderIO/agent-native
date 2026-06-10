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

import { RequireSession } from "./require-session.js";

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
    useSessionMock.mockReturnValue({ session: null, isLoading: true });
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
    });
    render(
      <RequireSession>
        <Child />
      </RequireSession>,
    );
    expect(container.querySelector('[data-testid="protected"]')).not.toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("redirects to the framework sign-in page with a return path when signed out", () => {
    useSessionMock.mockReturnValue({ session: null, isLoading: false });
    render(
      <RequireSession>
        <Child />
      </RequireSession>,
    );
    // Shows the fallback rather than flashing app chrome the visitor can't use.
    expect(container.querySelector('[data-testid="protected"]')).toBeNull();
    expect(replaceMock).toHaveBeenCalledTimes(1);
    const href = replaceMock.mock.calls[0][0] as string;
    expect(href).toContain("/_agent-native/sign-in?return=");
    expect(href).toContain(encodeURIComponent("/inbox?label=important"));
  });

  it("does not redirect twice across re-renders", () => {
    useSessionMock.mockReturnValue({ session: null, isLoading: false });
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
    useSessionMock.mockReturnValue({ session: null, isLoading: false });
    render(
      <RequireSession redirect={false} signedOut={<div>please sign in</div>}>
        <Child />
      </RequireSession>,
    );
    expect(container.textContent).toContain("please sign in");
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("bypass renders children even with no session", () => {
    useSessionMock.mockReturnValue({ session: null, isLoading: false });
    render(
      <RequireSession bypass>
        <Child />
      </RequireSession>,
    );
    expect(container.querySelector('[data-testid="protected"]')).not.toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
