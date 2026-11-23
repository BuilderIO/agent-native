// @vitest-environment happy-dom
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

import { NotebookPage } from "./NotebookPage";

vi.mock("./WorkspaceDataContext", () => ({
  useWorkspaceData: () => ({
    shell: {
      workspace: { id: "org" },
      user: { email: "owner@example.test" },
      features: {},
    },
  }),
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    session: { email: "owner@example.test" },
    isLoading: false,
  }),
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: { orgId: "org" }, isPending: false, isError: false }),
}));
vi.mock("@/components/agent", () => ({
  NotebookAgentComposerSuppressed: () => null,
  WorkspaceAgent: () => null,
}));
vi.mock("@/components/notebook", () => ({
  ProjectEditor: () => <div>Notebook</div>,
}));
vi.mock("@/lib/desktop-notifications", async (original) => ({
  ...(await original<object>()),
  useDesktopNotificationsEnabled: () => false,
}));
vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<object>()),
  useActionQuery: (name: string) => {
    if (name === "get-project")
      return {
        data: {
          viewer: { email: "owner@example.test", orgId: "org" },
          project: { id: "project-1", title: "Project", cells: [] },
          outputs: {},
          queryStates: {},
          canEdit: true,
        },
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      };
    return { data: { connections: [] }, isPending: false, isError: false };
  },
}));

it("records a notebook view and refreshes recents without interrupting feature flags", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let finishTouch: (response: Response) => void = () => {
    throw new Error("touch request has not started");
  };
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finishTouch = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  let flagsAborted = false;
  let finishFlags: (value: string) => void = () => {
    throw new Error("flags request has not started");
  };
  const flags = vi.fn(
    ({ signal }: { signal: AbortSignal }) =>
      new Promise<string>((resolve) => {
        finishFlags = resolve;
        signal.addEventListener("abort", () => {
          flagsAborted = true;
        });
      }),
  );
  const activity = vi.fn(async () => "updated recents");
  function Observers() {
    useQuery({
      queryKey: ["action", "get-feature-flags"],
      queryFn: flags,
      initialData: "old flags",
      staleTime: 0,
    });
    useQuery({
      queryKey: ["action", "get-workspace-activity"],
      queryFn: activity,
      initialData: "old recents",
      staleTime: Infinity,
    });
    return null;
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <Observers />
            <NotebookPage
              route={{ params: { projectLocator: "project-1" } } as never}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
      expect(flags).toHaveBeenCalledOnce();
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/_agent-native/actions/touch-project"),
      expect.objectContaining({
        body: expect.stringContaining('"projectId":"project-1"'),
      }),
    );
    await act(async () => {
      finishTouch(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    await vi.waitFor(() => expect(activity).toHaveBeenCalledOnce());
    expect(flagsAborted).toBe(false);
    expect(flags).toHaveBeenCalledOnce();
    expect(client.getQueryData(["action", "get-workspace-activity"])).toBe(
      "updated recents",
    );
    await act(async () => finishFlags("current flags"));
    await vi.waitFor(() =>
      expect(client.getQueryData(["action", "get-feature-flags"])).toBe(
        "current flags",
      ),
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
    vi.unstubAllGlobals();
  }
});
