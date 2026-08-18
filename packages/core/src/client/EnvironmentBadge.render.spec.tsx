// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useSessionMock = vi.fn();

vi.mock("./use-session.js", () => ({
  useSession: () => useSessionMock(),
}));
vi.mock("./app-config.js", () => ({
  injectedAgentNativeConfig: () => ({}),
}));

import { EnvironmentBadge } from "./EnvironmentBadge.js";

describe("EnvironmentBadge render", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalLocation: Location;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        hostname: "beta.plan.agent-native.com",
        href: "https://beta.plan.agent-native.com/inbox?tab=all#runs",
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

  it("renders the beta chip only for an authenticated builder.io user", () => {
    useSessionMock.mockReturnValue({
      session: { email: "employee@builder.io" },
      status: "authenticated",
    });

    act(() => root.render(<EnvironmentBadge />));

    expect(container.querySelector("button")?.textContent).toContain("beta");
    expect(container.textContent).toContain("beta");
  });

  it("hides the chip for non-employee sessions", () => {
    useSessionMock.mockReturnValue({
      session: { email: "person@example.com" },
      status: "authenticated",
    });

    act(() => root.render(<EnvironmentBadge />));

    expect(container.querySelector("button")).toBeNull();
  });
});
