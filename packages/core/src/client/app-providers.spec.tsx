// @vitest-environment happy-dom

import { QueryClient } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useSessionMock = vi.fn();
vi.mock("./use-session.js", () => ({
  useSession: () => useSessionMock(),
}));

import { AppProviders } from "./app-providers.js";

let container: HTMLDivElement;
let root: Root;
let originalLocation: Location;
let replaceMock: ReturnType<typeof vi.fn>;

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

describe("AppProviders session gate", () => {
  it("renders public paths directly without resolving or redirecting a session", () => {
    useSessionMock.mockReturnValue({ session: null, isLoading: false });

    renderProviders({ isPublicPath: true });

    expect(
      container.querySelector('[data-testid="app-content"]'),
    ).not.toBeNull();
    expect(useSessionMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("gates private paths and redirects signed-out visitors after hydration", () => {
    useSessionMock.mockReturnValue({ session: null, isLoading: false });

    renderProviders({});

    expect(container.querySelector('[data-testid="app-content"]')).toBeNull();
    expect(useSessionMock).toHaveBeenCalled();
    expect(replaceMock).toHaveBeenCalledWith(
      "/_agent-native/sign-in?return=%2Finbox",
    );
  });

  it("allows token-authenticated private surfaces to bypass the session gate", () => {
    useSessionMock.mockReturnValue({ session: null, isLoading: false });

    renderProviders({ sessionBypass: true });

    expect(
      container.querySelector('[data-testid="app-content"]'),
    ).not.toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
