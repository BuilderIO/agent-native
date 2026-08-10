// @vitest-environment happy-dom

import { QueryClient } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useSessionMock = vi.fn();
vi.mock("./use-session.js", () => ({
  useSession: () => useSessionMock(),
}));
vi.mock("@agent-native/toolkit/ui/sonner", () => ({
  Toaster: (props: { richColors?: boolean; position?: string }) => (
    <div
      data-testid="toolkit-toaster"
      data-rich-colors={String(Boolean(props.richColors))}
      data-position={props.position}
    />
  ),
}));

import { encodeContinuation } from "../shared/sign-in-journey.js";
import { AppProviders } from "./app-providers.js";

let container: HTMLDivElement;
let root: Root;
let originalLocation: Location;
let originalFetch: typeof window.fetch;
let originalDocumentTitle: string;
let replaceMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  originalDocumentTitle = document.title;
  document.title = "";
  replaceMock = vi.fn();
  originalFetch = window.fetch;
  Object.defineProperty(window, "fetch", {
    configurable: true,
    value: vi
      .fn()
      .mockRejectedValue(new Error("configuration probe unavailable")),
  });
  originalLocation = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      pathname: "/inbox",
      search: "",
      hash: "",
      origin: "https://app.example.com",
      href: "https://app.example.com/inbox",
      replace: replaceMock,
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
  Object.defineProperty(window, "fetch", {
    configurable: true,
    value: originalFetch,
  });
  document.title = originalDocumentTitle;
  vi.clearAllMocks();
});

function renderProviders(props: {
  isPublicPath?: boolean;
  sessionBypass?: boolean;
}) {
  act(() => {
    root.render(
      <AppProviders
        queryClient={new QueryClient()}
        i18n={false}
        toaster={null}
        {...props}
      >
        <div data-testid="app-content">content</div>
      </AppProviders>,
    );
  });
}

// `RequireSession` branches on `useSession().status`, not just `isLoading` —
// every mock here must supply a status or the gate can neither redirect nor
// hold the fallback consistently with the real hook.
const SIGNED_OUT_SESSION = {
  session: null,
  isLoading: false,
  status: "unauthenticated" as const,
};

describe("AppProviders session gate", () => {
  it("uses Toolkit's theme-aware toaster by default", () => {
    useSessionMock.mockReturnValue(SIGNED_OUT_SESSION);

    act(() => {
      root.render(
        <AppProviders queryClient={new QueryClient()} i18n={false} isPublicPath>
          <div>content</div>
        </AppProviders>,
      );
    });

    const toaster = container.querySelector('[data-testid="toolkit-toaster"]');
    expect(toaster?.getAttribute("data-rich-colors")).toBe("true");
    expect(toaster?.getAttribute("data-position")).toBe("bottom-left");
  });

  it("renders public paths directly without resolving or redirecting a session", () => {
    useSessionMock.mockReturnValue(SIGNED_OUT_SESSION);

    renderProviders({ isPublicPath: true });

    expect(
      container.querySelector('[data-testid="app-content"]'),
    ).not.toBeNull();
    expect(useSessionMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("gates private paths and redirects signed-out visitors after hydration", () => {
    useSessionMock.mockReturnValue(SIGNED_OUT_SESSION);

    renderProviders({});

    expect(container.querySelector('[data-testid="app-content"]')).toBeNull();
    expect(useSessionMock).toHaveBeenCalled();
    expect(replaceMock).toHaveBeenCalledWith(
      `/sign-in?c=${encodeContinuation("/inbox")}`,
    );
  });

  it("allows token-authenticated private surfaces to bypass the session gate", () => {
    useSessionMock.mockReturnValue(SIGNED_OUT_SESSION);

    renderProviders({ sessionBypass: true });

    expect(
      container.querySelector('[data-testid="app-content"]'),
    ).not.toBeNull();
    expect(useSessionMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("repairs structured route titles before they reach the browser tab", async () => {
    useSessionMock.mockReturnValue(SIGNED_OUT_SESSION);
    document.title = "Manage agent";

    renderProviders({ isPublicPath: true });

    act(() => {
      document.title = '[{"id":"automation-1","status":"success"}]';
    });

    await vi.waitFor(() => expect(document.title).toBe("Manage agent"));
  });
});
