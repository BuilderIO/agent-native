// @vitest-environment happy-dom

import type React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  surface: vi.fn(),
  state: "configured" as "configured" | "missing" | "unknown" | "unavailable",
  isAdmin: false,
}));

vi.mock("@agent-native/core/client/use-agent-engine-configured", () => ({
  useAgentEngineConfigured: () => ({
    canChat: mocks.state === "configured",
    missing: mocks.state === "missing",
    state: mocks.state,
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("../workspace/WorkspaceDataContext", () => ({
  useWorkspaceData: () => ({
    shell: { features: { isAdmin: mocks.isAdmin } },
  }),
}));
vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentChatHome: (props: Record<string, unknown>) => {
    mocks.surface(props);
    return (props.composerProviderSetupSlot as React.ReactNode) ?? null;
  },
  AgentChatSurface: (props: Record<string, unknown>) => {
    mocks.surface(props);
    return (props.composerProviderSetupSlot as React.ReactNode) ?? null;
  },
}));

import { WorkspaceAgent } from "./WorkspaceAgent";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-pathname">{location.pathname}</output>;
}

describe("home provider notice", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    mocks.surface.mockClear();
    mocks.isAdmin = false;
  });

  const slot = (state: typeof mocks.state) => {
    mocks.state = state;
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        <MemoryRouter>
          <WorkspaceAgent mode="home" orgId="org-1" />
        </MemoryRouter>,
      ),
    );
    const props = mocks.surface.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    act(() => root.unmount());
    return props.composerProviderSetupSlot;
  };

  it.each(["configured", "unknown", "unavailable"] as const)(
    "never offers the connect notice while readiness is %s",
    (state) => {
      expect(slot(state)).toBeFalsy();
    },
  );

  it.each(["configured", "unknown", "unavailable"] as const)(
    "leaves the surface's own setup card enabled while readiness is %s, so Enter never fails silently (849)",
    (state) => {
      expect(slot(state)).not.toBe(false);
      expect(slot(state)).toBeFalsy();
    },
  );

  it("offers the connect notice only when the server confirms no provider", () => {
    expect(slot("missing")).toBeTruthy();
  });

  it("lets the connect notice wrap so its message and action stay clear of the composer", () => {
    const notice = slot("missing") as React.ReactElement<{
      className: string;
      children: React.ReactElement<{ className: string }>[];
    }>;
    const tokens = notice.props.className.split(" ");
    expect(tokens).toContain("flex-wrap");
    expect(tokens).not.toContain("overflow-visible");
    const message = notice.props.children[0];
    expect(message?.props.className.split(" ")).toContain("min-w-0");
  });

  it("navigates Connect AI to /settings/model in the same tab so desktop webview navigation is not blocked (852)", () => {
    mocks.state = "missing";
    mocks.isAdmin = true;
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        <MemoryRouter initialEntries={["/home"]}>
          <LocationProbe />
          <WorkspaceAgent mode="home" orgId="org-1" />
        </MemoryRouter>,
      ),
    );
    const link = host.querySelector<HTMLAnchorElement>(
      'a[href="/settings/model"]',
    );
    expect(link).not.toBeNull();
    expect(link?.getAttribute("target")).toBeNull();
    expect(link?.getAttribute("rel")).toBeNull();
    act(() => {
      link?.click();
    });
    expect(
      host.querySelector('[data-testid="location-pathname"]')?.textContent,
    ).toBe("/settings/model");
    act(() => root.unmount());
  });
});
