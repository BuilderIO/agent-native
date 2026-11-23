// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

import { NotebookPage } from "./NotebookPage";

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  removeFromPage: null as null | ((id: string) => Promise<void>),
}));
vi.mock("./WorkspaceDataContext", () => ({
  useWorkspaceData: () => ({
    shell: {
      workspace: { id: "org" },
      user: { email: "owner@example.test" },
      features: { canCreateProject: true },
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
  ProjectEditor: (props: {
    project: { cells: { id: string }[] };
    onDeleteCell: (id: string) => Promise<void>;
  }) => {
    mocks.removeFromPage = props.onDeleteCell;
    return (
      <div>
        {props.project.cells.map((cell) => (
          <div key={cell.id}>{cell.id}</div>
        ))}
      </div>
    );
  },
}));
vi.mock("@agent-native/core/client/hooks", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    actionErrorCode: () => null,
    getBrowserTabId: () => "test-tab",
    useActionMutation: (name: string) => ({
      mutateAsync:
        name === "delete-project-cell" ? mocks.remove : async () => ({}),
    }),
    useActionQuery: (name: string, params: unknown) =>
      name === "get-project"
        ? useQuery({
            queryKey: ["action", name, params],
            queryFn: async () => {
              throw new Error("unexpected read");
            },
            staleTime: Infinity,
            enabled: false,
          })
        : { data: { connections: [] }, isPending: false, isError: false },
  };
});

it("report SAYA-1117-DELETE-LATENCY: hides a pending deletion and restores it on failure without losing other changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const client = new QueryClient();
  const key = ["action", "get-project", { projectId: "project-1" }];
  const data = {
    viewer: { email: "owner@example.test", orgId: "org" },
    canEdit: true,
    capabilities: [],
    outputs: {},
    queryStates: {},
    project: {
      id: "project-1",
      title: "Project",
      cells: [
        { id: "a", contents: { kind: "text" } },
        { id: "b", contents: { kind: "text" } },
      ],
    },
  };
  client.setQueryData(key, data);
  let rejectDelete: (error: Error) => void = () => {
    throw new Error("delete not started");
  };
  mocks.remove.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectDelete = reject;
      }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <NotebookPage
              route={{ params: { projectLocator: "project-1" } } as never}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    expect(container.textContent).toBe("ab");
    let deletion: Promise<void> = Promise.reject(
      new Error("delete not started"),
    );
    void deletion.catch(() => {});
    await act(async () => {
      if (!mocks.removeFromPage) throw new Error("editor not mounted");
      deletion = mocks.removeFromPage("a");
    });
    expect(container.textContent).toBe("b");
    await act(async () => {
      client.setQueryData(key, {
        ...data,
        project: {
          ...data.project,
          cells: [
            ...data.project.cells,
            { id: "c", contents: { kind: "text" } },
          ],
        },
      });
    });
    await vi.waitFor(() => expect(container.textContent).toBe("bc"));
    await act(async () => {
      rejectDelete(new Error("delete failed"));
      await expect(deletion).rejects.toThrow("delete failed");
    });
    expect(container.textContent).toBe("abc");

    let resolveDelete: () => void = () => {
      throw new Error("delete not started");
    };
    mocks.remove.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = () => resolve({ project: data.project });
        }),
    );
    await act(async () => {
      if (!mocks.removeFromPage) throw new Error("editor not mounted");
      deletion = mocks.removeFromPage("a");
    });
    await vi.waitFor(() => expect(container.textContent).toBe("bc"));
    await act(async () => {
      resolveDelete();
      await deletion;
    });
    await vi.waitFor(() => expect(container.textContent).toBe("bc"));
    expect(
      client
        .getQueryData<typeof data>(key)
        ?.project.cells.map((cell) => cell.id),
    ).toEqual(["b", "c"]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
  }
});

it("report QA-1794949748.404759: a confirmed deletion settles without waiting for the project refetch", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const client = new QueryClient();
  const key = ["action", "get-project", { projectId: "project-1" }];
  const data = {
    viewer: { email: "owner@example.test", orgId: "org" },
    canEdit: true,
    capabilities: [],
    outputs: {},
    queryStates: {},
    project: {
      id: "project-1",
      title: "Project",
      cells: [
        { id: "a", contents: { kind: "text" } },
        { id: "b", contents: { kind: "text" } },
      ],
    },
  };
  client.setQueryData(key, data);
  mocks.remove.mockResolvedValue({ project: data.project });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <NotebookPage
              route={{ params: { projectLocator: "project-1" } } as never}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    vi.spyOn(client, "invalidateQueries").mockImplementation(
      () => new Promise<void>(() => {}),
    );
    let settled = false;
    await act(async () => {
      if (!mocks.removeFromPage) throw new Error("editor not mounted");
      void mocks.removeFromPage("a").then(() => {
        settled = true;
      });
    });
    await vi.waitFor(() => expect(settled).toBe(true));
    expect(container.textContent).toBe("b");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
  }
});
