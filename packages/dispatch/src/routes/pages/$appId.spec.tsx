// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  navigateToWorkspaceApp: vi.fn(() => false),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  appPath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: [
      {
        id: "mail",
        name: "Mail",
        path: "/mail",
        url: null,
        status: "ready",
      },
    ],
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/shared/builder-link-tracking", () => ({
  withBuilderUtmTrackingParams: (href: string) => href,
}));

vi.mock("react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  Navigate: () => null,
  redirect: (target: string) => target,
  useParams: () => ({ appId: "mail" }),
}));

vi.mock("../../components/action-query-error", () => ({
  ActionQueryError: ({ onRetry }: { onRetry: () => unknown }) => (
    <button data-navigation-retry onClick={onRetry}>
      retry
    </button>
  ),
}));

vi.mock("../../components/dispatch-shell", () => ({
  DispatchShell: ({ children }: { children: React.ReactNode }) => (
    <div data-dispatch-shell>{children}</div>
  ),
}));

vi.mock("../../lib/catch-all-target", () => ({
  resolveServerCatchAllTarget: vi.fn(),
}));

vi.mock("../../lib/workspace-apps", () => ({
  navigateToWorkspaceApp: routeState.navigateToWorkspaceApp,
  workspaceAppHref: (app: { path?: string | null }) => app.path ?? null,
}));

vi.mock("../../components/ui/badge", () => ({ Badge: () => null }));
vi.mock("../../components/ui/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
}));
vi.mock("../../components/ui/spinner", () => ({ Spinner: () => null }));

import WorkspaceAppCatchAllRoute from "./$appId";

describe("WorkspaceAppCatchAllRoute", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    routeState.navigateToWorkspaceApp.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows a retryable error when navigation cannot reach the target", async () => {
    await act(async () => {
      root.render(<WorkspaceAppCatchAllRoute />);
      await Promise.resolve();
    });

    expect(routeState.navigateToWorkspaceApp).toHaveBeenCalledWith("/mail");
    expect(container.querySelector("[data-navigation-retry]")).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("[data-navigation-retry]")
        ?.click();
      await Promise.resolve();
    });

    expect(routeState.navigateToWorkspaceApp).toHaveBeenCalledTimes(2);
  });
});
