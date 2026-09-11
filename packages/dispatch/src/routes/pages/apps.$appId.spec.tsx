// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  appId: "mail",
  routeSplat: undefined as string | undefined,
  location: { pathname: "/apps/mail", search: "", hash: "" },
  hostProps: null as {
    appId?: string;
    navigateToTopWindow?: (href: string) => boolean | void;
    initialPath?: string;
    onChildRouteChange?: (path: string) => void;
  } | null,
  navigateToWorkspaceApp: vi.fn(() => true),
  navigate: vi.fn(),
}));

vi.mock("react-router", () => ({
  useParams: () => ({ appId: routeState.appId, "*": routeState.routeSplat }),
  useLocation: () => routeState.location,
  useNavigate: () => routeState.navigate,
}));

vi.mock("../../components/workspace-app-host", () => ({
  WorkspaceAppHost: (props: typeof routeState.hostProps) => {
    routeState.hostProps = props;
    return <div data-workspace-app-id={props?.appId} />;
  },
}));

vi.mock("../../lib/workspace-apps", () => ({
  navigateToWorkspaceApp: routeState.navigateToWorkspaceApp,
  workspaceAppInitialPathFromSplat: (
    routeSplat: string | undefined,
    search: string,
    hash: string,
  ) =>
    routeSplat || search || hash
      ? `/${routeSplat ?? ""}${search}${hash}`
      : undefined,
}));

import WorkspaceAppRoute from "./apps.$appId";

describe("WorkspaceAppRoute", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    routeState.appId = "mail";
    routeState.routeSplat = undefined;
    routeState.location = { pathname: "/apps/mail", search: "", hash: "" };
    routeState.hostProps = null;
    routeState.navigateToWorkspaceApp.mockClear();
    routeState.navigate.mockClear();
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

  it("keeps the iframe synchronized with standalone deep-link navigation", async () => {
    routeState.routeSplat = "foobar";
    routeState.location = {
      pathname: "/apps/mail/foobar",
      search: "?view=all",
      hash: "#top",
    };

    await act(async () => {
      root.render(<WorkspaceAppRoute />);
    });

    expect(routeState.hostProps?.initialPath).toBe("/foobar?view=all#top");

    routeState.routeSplat = "sent";
    routeState.location = {
      pathname: "/apps/mail/sent",
      search: "",
      hash: "",
    };
    await act(async () => {
      root.render(<WorkspaceAppRoute />);
    });

    expect(routeState.hostProps?.initialPath).toBe("/sent");
    routeState.hostProps?.onChildRouteChange?.("/apps/mail/archive");
    expect(routeState.navigate).toHaveBeenCalledWith("/apps/mail/archive", {
      replace: true,
    });
  });
});
