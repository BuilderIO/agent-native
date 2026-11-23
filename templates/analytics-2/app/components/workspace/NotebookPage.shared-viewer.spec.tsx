// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveRoute } from "@/routes/routing/registry";

import { NotebookPage } from "./NotebookPage";

const PROJECT_ID = "prj_00000000000000000000000000000001";
const SHARE_PATH = `/project/${PROJECT_ID}/latest`;

const mocks = vi.hoisted(() => ({
  projectInputs: [] as unknown[],
  data: undefined as unknown,
}));

vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    session: { email: "viewer@example.test" },
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
      user: { email: "viewer@example.test" },
      features: { canCreateProject: false },
    },
  }),
}));
vi.mock("@/components/notebook", () => ({
  ProjectEditor: (props: { readOnly?: boolean }) => (
    <div data-notebook-editor="" data-read-only={String(props.readOnly)} />
  ),
}));
vi.mock("@/components/agent", () => ({
  NotebookAgentComposerSuppressed: () => null,
  WorkspaceAgent: () => null,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorCode: (value: unknown) =>
    (value as { errorCode?: unknown } | undefined)?.errorCode,
  callAction: vi.fn(),
  getBrowserTabId: () => "test-tab",
  useActionMutation: () => ({ mutateAsync: vi.fn(async () => ({})) }),
  useActionQuery: (name: string, input: unknown) => {
    if (name === "get-workspace-bootstrap")
      return { data: undefined, isError: false, isPending: true };
    if (name === "get-project") {
      mocks.projectInputs.push(input);
      return {
        data: mocks.data,
        error: null,
        isError: false,
        isPending: false,
        isFetching: false,
        refetch: vi.fn(),
      };
    }
    return { data: { connections: [] }, isError: false, isPending: false };
  },
}));

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
  mocks.projectInputs.length = 0;
  mocks.data = undefined;
});

describe("the shared project link /project/:id/latest", () => {
  it("resolves to the project page and reads the project without a version", async () => {
    const route = resolveRoute(SHARE_PATH);
    expect(route).toMatchObject({
      params: { projectLocator: PROJECT_ID, version: "latest" },
    });
    mocks.data = {
      project: {
        id: PROJECT_ID,
        title: "Shared unpublished notebook",
        cells: [],
        workingVersionId: "ver_1",
        publishedVersionId: null,
      },
      viewer: { email: "viewer@example.test", orgId: "org" },
      outputs: {},
      queryStates: {},
      canEdit: false,
      selectedConnections: [],
      capabilities: [],
    };
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={[SHARE_PATH]}>
            <NotebookPage route={route as never} />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
    expect(mocks.projectInputs.length).toBeGreaterThan(0);
    expect(mocks.projectInputs[0]).toEqual({ projectId: PROJECT_ID });
    for (const input of mocks.projectInputs)
      expect(input).not.toMatchObject({ version: "latest" });
    expect(container.querySelector("[data-notebook-editor]")).not.toBeNull();
    expect(container.querySelector("[data-project-not-found]")).toBeNull();
    expect(container.textContent).not.toContain("Page not found");
  });
});
