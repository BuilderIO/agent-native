// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  appId: "mail",
  hostProps: null as {
    appId?: string;
    navigateToTopWindow?: (href: string) => boolean | void;
  } | null,
  navigateToWorkspaceApp: vi.fn(() => true),
}));

vi.mock("react-router", () => ({
  useParams: () => ({ appId: routeState.appId }),
}));

vi.mock("../../components/workspace-app-host", () => ({
  WorkspaceAppHost: (props: typeof routeState.hostProps) => {
    routeState.hostProps = props;
    return <div data-workspace-app-id={props?.appId} />;
  },
}));

vi.mock("../../lib/workspace-apps", () => ({
  navigateToWorkspaceApp: routeState.navigateToWorkspaceApp,
}));

import WorkspaceAppRoute from "./apps.$appId";

describe("WorkspaceAppRoute", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    routeState.appId = "mail";
    routeState.hostProps = null;
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

  it("passes the route app id and top-window helper to the workspace host", async () => {
    await act(async () => {
      root.render(<WorkspaceAppRoute />);
    });

    expect(routeState.hostProps?.appId).toBe("mail");
    expect(routeState.hostProps?.navigateToTopWindow).toEqual(
      expect.any(Function),
    );

    routeState.hostProps?.navigateToTopWindow?.("/mail");

    expect(routeState.navigateToWorkspaceApp).toHaveBeenCalledWith("/mail");
  });
});
