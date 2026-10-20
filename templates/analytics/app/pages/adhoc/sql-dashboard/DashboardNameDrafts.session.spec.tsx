// @vitest-environment happy-dom

import { notifySessionInvalidated } from "@agent-native/core/client/hooks";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import {
  DashboardNameDraftRouterBridge,
  DashboardNameDrafts,
  NameDraftDashboardContext,
  useDashboardNameDraft,
} from "./DashboardNameDrafts";

const sessionHook = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/hooks")>();
  return {
    ...actual,
    useSession: () => {
      sessionHook();
      return actual.useSession();
    },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it.each([
  "/status",
  "/status/service",
  "/sessions/recording?frame=1&agent_access=fake-test-token&capture_through_ms=0",
])(
  "does not subscribe or fetch on public first mount %s, then scopes dashboard drafts",
  async (path) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let email = "viewer@example.com";
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ email, userId: email, orgId: "org-a" }),
    );
    vi.stubGlobal("fetch", fetcher);
    await notifySessionInvalidated();
    sessionHook.mockClear();
    let setDraft!: ReturnType<typeof useDashboardNameDraft<string>>[1];
    function Draft() {
      const [name, setName] = useDashboardNameDraft<string>(
        "preset",
        "",
        "app",
      );
      setDraft = setName;
      return <output>{name}</output>;
    }
    function Layout({ children }: { children: ReactNode }) {
      return (
        <>
          <DashboardNameDraftRouterBridge />
          {children}
        </>
      );
    }
    const router = createMemoryRouter(
      [
        {
          element: (
            <Layout>
              <Outlet />
            </Layout>
          ),
          children: [
            { path: "/status/*", element: <main>Public status</main> },
            { path: "/sessions/:id", element: <main>Public frame</main> },
            {
              path: "/dashboards/:id",
              element: (
                <NameDraftDashboardContext value="dash-a">
                  <Draft />
                </NameDraftDashboardContext>
              ),
            },
          ],
        },
      ],
      { initialEntries: [path] },
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <DashboardNameDrafts>
            <RouterProvider router={router} />
          </DashboardNameDrafts>,
        ),
      );
      expect(sessionHook).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
      await act(async () => {
        await router.navigate("/dashboards/dash-a");
      });
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
      expect(sessionHook).toHaveBeenCalled();
      expect(String(fetcher.mock.calls[0]?.[0])).toContain(
        "/_agent-native/auth/session",
      );
      await act(async () => {
        await notifySessionInvalidated();
      });
      act(() => setDraft("Account A draft"));
      expect(container.querySelector("output")!.textContent).toBe(
        "Account A draft",
      );
      email = "other@example.com";
      await act(async () => {
        await notifySessionInvalidated();
      });
      expect(container.querySelector("output")!.textContent).toBe("");
      act(() => setDraft("Account B draft"));
      expect(container.querySelector("output")!.textContent).toBe(
        "Account B draft",
      );
      await act(async () => {
        await router.navigate(path);
      });
      const calls = sessionHook.mock.calls.length;
      const requests = fetcher.mock.calls.length;
      await act(async () => {
        await notifySessionInvalidated();
      });
      expect(sessionHook).toHaveBeenCalledTimes(calls);
      expect(fetcher).toHaveBeenCalledTimes(requests);
      await act(async () => {
        await router.navigate("/dashboards/dash-a");
      });
      expect(container.querySelector("output")!.textContent).toBe("");
    } finally {
      act(() => root.unmount());
      router.dispose();
      container.remove();
      await notifySessionInvalidated();
    }
  },
);
