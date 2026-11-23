// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";
import { resolveRoute } from "@/routes/routing/registry";

import { NotebookPage } from "./NotebookPage";

const mocks = vi.hoisted(() => ({
  error: null as (Error & { errorCode?: string }) | null,
  data: undefined as unknown,
  calls: [] as Array<{ name: string; input: unknown }>,
}));

vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    session: { email: "qa@example.test" },
    isLoading: false,
  }),
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: { orgId: "org" }, isPending: false, isError: false }),
}));
vi.mock("react-router", async (original) => ({
  ...(await original<object>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("./WorkspaceDataContext", () => ({
  useWorkspaceData: () => ({
    shell: {
      workspace: { id: "org" },
      user: { email: "qa@example.test" },
      features: { canCreateProject: true },
    },
  }),
}));
vi.mock("@/components/notebook", () => ({
  ProjectEditor: (props: {
    canEdit?: boolean;
    isVersionPreview?: boolean;
    view?: string;
    error?: string | null;
  }) => (
    <div
      data-notebook-editor=""
      data-can-edit={String(Boolean(props.canEdit))}
      data-version-preview={String(Boolean(props.isVersionPreview))}
      data-view={props.view ?? ""}
      data-editor-error={props.error ?? ""}
    />
  ),
}));
vi.mock("@/components/agent", () => ({
  NotebookAgentComposerSuppressed: () => null,
  WorkspaceAgent: () => null,
}));
vi.mock("@agent-native/core/client/hooks", async () => {
  return {
    actionErrorCode: (value: unknown) =>
      (value as { errorCode?: unknown } | undefined)?.errorCode,
    getBrowserTabId: () => "test-tab",
    callAction: vi.fn(),
    useActionMutation: () => ({ mutateAsync: vi.fn(async () => ({})) }),
    useActionQuery: (name: string, input: unknown) => {
      mocks.calls.push({ name, input });
      if (name === "get-workspace-bootstrap")
        return { data: undefined, isError: false, isPending: true };
      if (name === "get-project") {
        const err = mocks.error;
        return {
          data: mocks.data,
          error: err,
          isError: err !== null,
          isPending: false,
          isFetching: false,
          refetch: vi.fn(async () => ({ data: undefined })),
        };
      }
      return { data: { connections: [] }, isError: false, isPending: false };
    },
  };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  mocks.error = null;
  mocks.data = undefined;
  mocks.calls = [];
});

function renderPath(path: string) {
  const route = resolveRoute(path);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  root = createRoot(container);
  act(() => {
    root!.render(
      <QueryClientProvider client={client}>
        <AgentNativeI18nProvider
          catalog={{ messages }}
          persistPreference={false}
        >
          <MemoryRouter initialEntries={[path]}>
            <NotebookPage route={route} />
          </MemoryRouter>
        </AgentNativeI18nProvider>
      </QueryClientProvider>,
    );
  });
}

function projectPayload(id = "prj-1") {
  return {
    project: {
      id,
      title: "Saved Project",
      description: "",
      orgId: "org",
      ownerEmail: "qa@example.test",
      cells: [],
      layout: [],
      publishedVersionId: null,
      workingVersionId: "ver-work",
      trashedAt: null,
      archivedAt: null,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    },
    outputs: {},
    queryStates: {},
    canEdit: true,
    capabilities: [{ controlId: "edit-project", status: "allowed" }],
    viewer: { email: "qa@example.test", orgId: "org" },
    selectedConnections: [],
  };
}

describe("NotebookPage version and sub-view routing", () => {
  it("passes an explicit saved version id to get-project and renders read-only", () => {
    mocks.data = projectPayload("prj-1");
    renderPath("/project/prj-1/ver-123");
    const getProjectCall = mocks.calls.find((c) => c.name === "get-project");
    expect(getProjectCall?.input).toEqual({
      projectId: "prj-1",
      version: "ver-123",
    });
    const editor = container.querySelector("[data-notebook-editor]");
    expect(editor?.getAttribute("data-can-edit")).toBe("false");
    expect(editor?.getAttribute("data-version-preview")).toBe("true");
  });

  it("omits version for /latest and /draft so the working notebook loads", () => {
    mocks.data = projectPayload("prj-1");
    renderPath("/project/prj-1/latest");
    const callLatest = mocks.calls.find((c) => c.name === "get-project");
    expect(callLatest?.input).toEqual({ projectId: "prj-1" });
    mocks.calls = [];
    renderPath("/project/prj-1/draft");
    const callDraft = mocks.calls.find((c) => c.name === "get-project");
    expect(callDraft?.input).toEqual({ projectId: "prj-1" });
  });

  it("renders ProjectNotFound when get-project fails with project_version_not_found", () => {
    mocks.error = Object.assign(
      new Error("That published version is not available."),
      {
        errorCode: "project_version_not_found",
      },
    );
    renderPath("/project/prj-1/missing-ver");
    expect(container.querySelector("[data-notebook-editor]")).toBeNull();
    expect(container.textContent).toContain("Project not found");
  });

  it("opens the App builder view when routed to /project/:id/latest/ui", () => {
    mocks.data = projectPayload("prj-1");
    renderPath("/project/prj-1/latest/ui");
    const editor = container.querySelector("[data-notebook-editor]");
    expect(editor?.getAttribute("data-view")).toBe("app");
  });
});
