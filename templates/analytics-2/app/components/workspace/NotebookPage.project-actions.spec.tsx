// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import type { ProjectEditorProps } from "@/components/notebook/types";

import { ANALYTICS_CONTROL_IDS as ids } from "../../../shared/analytics-control-ids";
import { NotebookPage } from "./NotebookPage";

const state = vi.hoisted(() => ({
  editor: undefined as ProjectEditorProps | undefined,
  pathname: "",
  canCreateProject: true,
  language: "python" as "python" | "r",
  archivedAt: null as string | null,
  quickCreateProject: vi.fn(async () => {}),
  orgPending: false,
  orgError: false,
}));

vi.mock("./WorkspaceDataContext", () => ({
  useWorkspaceData: () => ({
    shell: {
      workspace: { id: "org" },
      user: { email: "owner@example.test" },
      features: {},
      capabilities: state.canCreateProject
        ? [{ controlId: ids.createProject, status: "allowed" }]
        : [],
    },
    quickCreateProject: state.quickCreateProject,
  }),
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    session: { email: "owner@example.test" },
    isLoading: false,
  }),
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({
    data: state.orgPending ? undefined : { orgId: "org" },
    isPending: state.orgPending,
    isError: state.orgError,
  }),
}));
vi.mock("@/components/agent", () => ({
  NotebookAgentComposerSuppressed: () => null,
  WorkspaceAgent: () => null,
}));
vi.mock("@/components/notebook", () => ({
  ProjectEditor: (props: ProjectEditorProps) => {
    state.editor = props;
    return null;
  },
}));
vi.mock("@/lib/desktop-notifications", async (original) => ({
  ...(await original<object>()),
  useDesktopNotificationsEnabled: () => false,
}));
vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<object>()),
  useActionQuery: (name: string) => {
    const ready = { isPending: false, isError: false, refetch: vi.fn() };
    if (name === "get-project")
      return {
        ...ready,
        data: {
          viewer: { email: "owner@example.test", orgId: "org" },
          project: {
            id: "project-1",
            title: "Revenue",
            language: state.language,
            favorited: false,
            archivedAt: state.archivedAt,
            cells: [],
          },
          outputs: {},
          queryStates: {},
          canEdit: true,
          capabilities: [],
        },
      };
    if (name === "list-collections")
      return {
        ...ready,
        data: { collections: [{ id: "collection-1", name: "Finance" }] },
      };
    if (name === "list-project-collections")
      return { ...ready, data: { assignments: [] } };
    return { ...ready, data: { connections: [] } };
  },
}));

type Call = { name: string; method: string; body: Record<string, unknown> };

function actionServer(respond: (call: Call) => unknown) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const call: Call = {
      name: url.pathname.split("/").pop() ?? "",
      method: init?.method ?? "GET",
      body:
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : Object.fromEntries(url.searchParams),
    };
    calls.push(call);
    return new Response(JSON.stringify(respond(call) ?? {}), {
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  return calls;
}

function LocationProbe() {
  state.pathname = useLocation().pathname;
  return null;
}

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  state.editor = undefined;
  state.canCreateProject = true;
  state.language = "python";
  state.archivedAt = null;
  state.orgPending = false;
  state.orgError = false;
  state.quickCreateProject.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderPage() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/project/project-1/latest"]}>
          <LocationProbe />
          <NotebookPage
            route={{ params: { projectLocator: "project-1" } } as never}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  cleanup = async () => {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
  };
  const editor = state.editor;
  if (!editor) throw new Error("ProjectEditor did not render");
  return { container, editor: () => state.editor ?? editor };
}

it("favorites the project through favorite-project and reports the saved value", async () => {
  const calls = actionServer((call) =>
    call.name === "favorite-project"
      ? { project: { id: "project-1", favorited: call.body.favorited } }
      : undefined,
  );
  const { editor } = await renderPage();

  let saved: boolean | undefined;
  await act(async () => {
    saved = await editor().onFavorite?.(true);
  });

  expect(saved).toBe(true);
  expect(calls).toContainEqual({
    name: "favorite-project",
    method: "POST",
    body: { projectId: "project-1", favorited: true },
  });
});

it("rejects a favorite the server did not save so the header rolls back", async () => {
  actionServer((call) =>
    call.name === "favorite-project"
      ? { project: { id: "project-1", favorited: false } }
      : undefined,
  );
  const { editor } = await renderPage();

  await expect(editor().onFavorite?.(true)).rejects.toThrow();
});

it("downloads export-project-yaml output as a YAML file for a Python project", async () => {
  const calls = actionServer((call) =>
    call.name === "export-project-yaml"
      ? { content: "title: Revenue\n", filename: "Revenue.yaml" }
      : undefined,
  );
  const blobs: Blob[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return "blob:revenue";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const downloads: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    },
  );
  const { editor } = await renderPage();

  await act(async () => {
    await editor().onExportYaml?.();
  });

  expect(calls).toContainEqual({
    name: "export-project-yaml",
    method: "GET",
    body: { projectId: "project-1" },
  });
  expect(downloads).toEqual(["Revenue.yaml"]);
  expect(await blobs[0]?.text()).toBe("title: Revenue\n");
});

it("offers YAML export for non-Python projects too", async () => {
  actionServer(() => undefined);
  state.language = "r";
  const { editor } = await renderPage();

  expect(editor().onExportYaml).toBeTypeOf("function");
});

it("adds the project to a chosen collection through add-project-to-collection", async () => {
  const calls = actionServer((call) =>
    call.name === "add-project-to-collection" ? call.body : undefined,
  );
  const { container, editor } = await renderPage();

  await act(async () => editor().onAddToCollection?.());
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain("Finance");
  await act(async () =>
    dialog?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click(),
  );
  await act(async () =>
    dialog?.querySelector<HTMLButtonElement>(".ws-projects-primary")?.click(),
  );

  await vi.waitFor(() =>
    expect(calls).toContainEqual({
      name: "add-project-to-collection",
      method: "POST",
      body: { projectId: "project-1", collectionId: "collection-1" },
    }),
  );
  await vi.waitFor(() =>
    expect(container.querySelector('[role="dialog"]')).toBeNull(),
  );
});

it("archives the project through archive-project and lands on Projects", async () => {
  const calls = actionServer((call) =>
    call.name === "archive-project"
      ? {
          project: { id: "project-1", archivedAt: "2026-11-19T00:00:00.000Z" },
        }
      : undefined,
  );
  const { editor } = await renderPage();

  await act(async () => {
    await editor().onArchive?.();
  });

  expect(calls).toContainEqual({
    name: "archive-project",
    method: "POST",
    body: { projectId: "project-1" },
  });
  expect(state.pathname).toBe("/home/all");
});

it("does not offer Archive for a project that is already archived", async () => {
  actionServer(() => undefined);
  state.archivedAt = "2026-11-18T00:00:00.000Z";
  const { editor } = await renderPage();

  expect(editor().onArchive).toBeUndefined();
});

it("creates a new project from the project menu when the workspace allows it", async () => {
  actionServer(() => undefined);
  const { editor } = await renderPage();

  await act(async () => {
    await editor().onNewProject?.();
  });

  expect(state.quickCreateProject).toHaveBeenCalledOnce();
});

it("hides New project without the create-project capability", async () => {
  actionServer(() => undefined);
  state.canCreateProject = false;
  const { editor } = await renderPage();

  expect(editor().onNewProject).toBeUndefined();
});

it("keeps New project available while the active org read is still pending", async () => {
  actionServer(() => undefined);
  state.orgPending = true;
  const { editor } = await renderPage();

  await act(async () => {
    await editor().onNewProject?.();
  });

  expect(state.quickCreateProject).toHaveBeenCalledOnce();
  expect(editor().onDuplicate).toBeUndefined();
});

it("pastes a copied cell after the target cell through paste-project-cell", async () => {
  const calls = actionServer((call) =>
    call.name === "paste-project-cell"
      ? { project: { id: "project-1" }, createdCellId: "cell-2" }
      : undefined,
  );
  const { editor } = await renderPage();
  const contents = { kind: "markdown", markdown: "# Notes" } as never;

  await act(async () => {
    await editor().onPasteCell?.("cell-1", contents);
  });

  expect(calls).toContainEqual({
    name: "paste-project-cell",
    method: "POST",
    body: {
      projectId: "project-1",
      afterCellId: "cell-1",
      contents: { kind: "markdown", markdown: "# Notes" },
    },
  });
});

it("creates a component from the selected cells through manage-component", async () => {
  const calls = actionServer((call) =>
    call.name === "manage-component"
      ? { component: { id: "component-1" } }
      : undefined,
  );
  const { editor } = await renderPage();

  await act(async () => {
    await editor().onCreateComponent?.("Revenue model", ["cell-1", "cell-2"]);
  });

  expect(calls).toContainEqual({
    name: "manage-component",
    method: "POST",
    body: {
      operation: "create",
      projectId: "project-1",
      name: "Revenue model",
      cellIds: ["cell-1", "cell-2"],
    },
  });
});
