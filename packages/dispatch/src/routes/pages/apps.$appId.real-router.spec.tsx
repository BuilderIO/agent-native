// @vitest-environment happy-dom
/**
 * The sibling spec (apps.$appId.spec.tsx) mocks useParams/useLocation and the
 * splat helper, so it cannot see how a real router delivers a deep workspace-app
 * URL. This file mounts the real route component in a real memory router with
 * the real route path and the real helper, and asserts what the host receives.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  initialPath: undefined as string | undefined,
  appId: undefined as string | undefined,
}));

vi.mock("../../components/workspace-app-host", () => ({
  WorkspaceAppHost: (props: { appId?: string; initialPath?: string }) => {
    captured.appId = props.appId;
    captured.initialPath = props.initialPath;
    return <div data-workspace-app-id={props.appId} />;
  },
}));

import WorkspaceAppRoute from "./apps.$appId";

function routes(): RouteObject[] {
  return [
    { path: "apps", element: <div>apps-list</div> },
    { path: "apps/:appId/*", element: <WorkspaceAppRoute /> },
  ];
}

async function renderAt(url: string, basename = "/"): Promise<{ root: Root }> {
  const router = createMemoryRouter(routes(), {
    initialEntries: [url],
    basename,
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<RouterProvider router={router} />);
  });
  return { root };
}

describe("WorkspaceAppRoute with a real router", () => {
  beforeEach(() => {
    captured.initialPath = undefined;
    captured.appId = undefined;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hands the host the deep path a splat URL carries", async () => {
    const { root } = await renderAt(
      "/apps/content-2/settings/integrations/notion",
    );
    expect(captured.appId).toBe("content-2");
    expect(captured.initialPath).toBe("/settings/integrations/notion");
    await act(async () => root.unmount());
  });

  it("hands the host the documented deep path when the query parameter carries it", async () => {
    const { root } = await renderAt(
      "/apps/content-2?__workspace_app_path=%2Fsent",
    );
    expect(captured.initialPath).toBe("/sent");
    await act(async () => root.unmount());
  });

  it("leaves the path undefined at the app root so the host can use its home path", async () => {
    const { root } = await renderAt("/apps/content-2");
    expect(captured.initialPath).toBeUndefined();
    await act(async () => root.unmount());
  });

  it("hands the host the deep path under the Dispatch basename too", async () => {
    const { root } = await renderAt(
      "/dispatch/apps/content-2/settings/integrations/notion",
      "/dispatch",
    );
    expect(captured.appId).toBe("content-2");
    expect(captured.initialPath).toBe("/settings/integrations/notion");
    await act(async () => root.unmount());
  });
});
