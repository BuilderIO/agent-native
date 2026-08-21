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
  let originalUserAgent: string;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    originalLocation = window.location;
    originalUserAgent = window.navigator.userAgent;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        hostname: "beta.plan.agent-native.com",
        href: "https://beta.plan.agent-native.com/inbox?tab=all#runs",
        replace: vi.fn(),
      },
    });
    window.localStorage?.removeItem("agent-native:beta-opt-out-until");
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: originalUserAgent,
    });
    vi.clearAllMocks();
  });

  it("renders the beta chip for signed-out visitors", () => {
    useSessionMock.mockReturnValue({
      session: null,
      status: "unauthenticated",
    });

    act(() => root.render(<EnvironmentBadge />));

    const trigger = container.querySelector("button");
    expect(trigger?.textContent).toContain("beta");
    expect(trigger?.className).toContain("border-primary/80");
    expect(trigger?.className).toContain("bottom-3");
    expect(trigger?.className).toContain("left-3");
    expect(trigger?.className).not.toContain("top-3");
    expect(trigger?.className).not.toContain("right-3");
    expect(trigger?.className).not.toContain("bg-background/95");
    expect(container.textContent).toContain("beta");
  });

  it("renders the beta chip for non-builder users", () => {
    useSessionMock.mockReturnValue({
      session: { email: "person@example.com" },
      status: "authenticated",
    });

    act(() => root.render(<EnvironmentBadge />));

    expect(container.querySelector("button")?.textContent).toContain("beta");
    expect(container.textContent).toContain("beta");
  });

  it("keeps the beta chip linked to production for every visitor", () => {
    useSessionMock.mockReturnValue({
      session: null,
      status: "unauthenticated",
    });

    act(() => root.render(<EnvironmentBadge />));
    const trigger = container.querySelector("button");
    expect(trigger).not.toBeNull();

    act(() => {
      trigger?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
      trigger?.click();
    });

    const popover = document.body.querySelector('[data-side="top"]');
    expect(popover?.getAttribute("data-align")).toBe("start");

    const productionLink = [...document.body.querySelectorAll("a")].find(
      (link) => link.textContent?.includes("Switch to production"),
    );
    const productionHref = productionLink?.getAttribute("href");
    expect(productionHref).toContain(
      "https://plan.agent-native.com/inbox?tab=all&agentNativeBetaOptOut=",
    );
    const expiry = Number(
      new URL(productionHref!).searchParams.get("agentNativeBetaOptOut"),
    );
    expect(expiry).toBeGreaterThan(Date.now());
  });

  it("hides the production chip for non-employee sessions", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        hostname: "plan.agent-native.com",
        href: "https://plan.agent-native.com/inbox?tab=all#runs",
        replace: vi.fn(),
      },
    });
    useSessionMock.mockReturnValue({
      session: { email: "person@example.com" },
      status: "authenticated",
    });

    act(() => root.render(<EnvironmentBadge />));

    expect(container.querySelector("button")).toBeNull();
  });

  it("automatically redirects an employee from production to beta", () => {
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        hostname: "plan.agent-native.com",
        href: "https://plan.agent-native.com/inbox?tab=all#runs",
        replace,
      },
    });
    useSessionMock.mockReturnValue({
      session: { email: "employee@builder.io" },
      status: "authenticated",
    });

    act(() => root.render(<EnvironmentBadge />));

    expect(replace).toHaveBeenCalledWith(
      "https://beta.plan.agent-native.com/inbox?tab=all#runs",
    );
  });

  it("keeps an Electron employee on production after sign-in", () => {
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        hostname: "plan.agent-native.com",
        href: "https://plan.agent-native.com/inbox?tab=all#runs",
        replace,
      },
    });
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 AgentNative/0.1.150-nightly.253 Electron/43.4.0 AgentNativeDesktop/0.1.150-nightly.253",
    });
    useSessionMock.mockReturnValue({
      session: { email: "employee@builder.io" },
      status: "authenticated",
    });

    act(() => root.render(<EnvironmentBadge />));

    expect(replace).not.toHaveBeenCalled();
  });

  it("does not redirect when production carries a valid opt-out", () => {
    const replace = vi.fn();
    const expiry = Date.now() + 60 * 60 * 1000;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        hostname: "plan.agent-native.com",
        href: `https://plan.agent-native.com/inbox?agentNativeBetaOptOut=${expiry}`,
        replace,
      },
    });
    useSessionMock.mockReturnValue({
      session: { email: "employee@builder.io" },
      status: "authenticated",
    });

    act(() => root.render(<EnvironmentBadge />));

    expect(replace).not.toHaveBeenCalled();
    expect(window.history.replaceState).toBeDefined();
  });
});
