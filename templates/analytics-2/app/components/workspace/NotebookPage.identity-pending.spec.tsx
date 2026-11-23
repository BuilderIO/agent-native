// @vitest-environment happy-dom
/**
 * A project read that matches the session renders the editor (read-only) while the
 * workspace bootstrap and org reads are still in flight, instead of holding the
 * Loading shell with no SQL editor until all three reads settle.
 */
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";
import { resolveRoute } from "@/routes/routing/registry";

import { NotebookPage } from "./NotebookPage";

const mocks = vi.hoisted(() => ({
  editorProps: null as null | {
    loading?: boolean;
    canEdit?: boolean;
    project?: { id: string; cells: unknown[] };
  },
  viewerEmail: "qa@example.test",
}));

vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    session: { email: "qa@example.test" },
    isLoading: false,
  }),
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: undefined, isPending: true, isError: false }),
}));
vi.mock("react-router", async (original) => ({
  ...(await original<object>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("./WorkspaceDataContext", () => ({
  useWorkspaceData: () => undefined,
}));
vi.mock("@/components/notebook", () => ({
  ProjectEditor: (props: NonNullable<typeof mocks.editorProps>) => {
    mocks.editorProps = props;
    return <div data-notebook-editor="" />;
  },
}));
vi.mock("@/components/agent", () => ({
  NotebookAgentComposerSuppressed: () => null,
  WorkspaceAgent: () => null,
}));
vi.mock("@agent-native/core/client/hooks", async () => ({
  actionErrorCode: () => undefined,
  getBrowserTabId: () => "test-tab",
  callAction: vi.fn(),
  useActionMutation: () => ({ mutateAsync: vi.fn(async () => ({})) }),
  useActionQuery: (name: string) => {
    if (name === "get-workspace-bootstrap")
      return { data: undefined, isError: false, isPending: true };
    if (name === "get-project")
      return {
        data: {
          project: {
            id: "p1",
            title: "Project",
            cells: [],
            workingVersionId: "v1",
          },
          viewer: { email: mocks.viewerEmail, orgId: "org" },
          outputs: {},
          queryStates: {},
          canEdit: true,
          capabilities: [],
        },
        isError: false,
        isPending: false,
        isFetching: false,
        refetch: vi.fn(),
      };
    return { data: { connections: [] }, isError: false, isPending: false };
  },
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const ROUTE = resolveRoute("/project/p1") ?? {
  params: { projectLocator: "p1" },
};

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  mocks.editorProps = null;
  mocks.viewerEmail = "qa@example.test";
});

const render = async () => {
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={new QueryClient()}>
        <AgentNativeI18nProvider
          catalog={{ messages }}
          persistPreference={false}
        >
          <MemoryRouter initialEntries={["/project/p1"]}>
            <NotebookPage route={ROUTE as never} />
          </MemoryRouter>
        </AgentNativeI18nProvider>
      </QueryClientProvider>,
    );
    await Promise.resolve();
  });
};

describe("notebook while workspace identity is still resolving", () => {
  it("shows the loaded project read-only instead of the Loading shell", async () => {
    await render();
    expect(mocks.editorProps?.loading).toBe(false);
    expect(mocks.editorProps?.project?.id).toBe("p1");
    expect(mocks.editorProps?.canEdit).toBe(false);
  });
  it("keeps Loading when the read belongs to another viewer", async () => {
    mocks.viewerEmail = "other@example.test";
    await render();
    expect(mocks.editorProps?.loading).toBe(true);
  });
});
