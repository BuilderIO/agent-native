// @vitest-environment happy-dom
/**
 * A project URL whose id does not resolve must render the app's not-found copy,
 * not an editable "Untitled project".
 *
 * Reproduced live on served 3ffbe05de3 and 57cf6bf2: /analytics-2/project/zzz-not-a-project
 * rendered the project editor titled "Untitled project". The server answers 404 with
 * errorCode project_not_found (server/lib/project-action-access.ts:63), and the frame
 * passed pendingProject(projectId) to the editor whenever the read failed.
 *
 * Two cases, because the distinction is the whole fix:
 *   - project_not_found  -> not-found copy, no editor, no Retry (the request can never succeed)
 *   - any other error    -> the editor keeps its error banner and Retry (a transient failure)
 */
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
  refetch: vi.fn(async () => ({ data: undefined })),
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
// The editor itself is not what is under test: the fix is which branch the frame
// takes. A marker keeps the assertion exact (rendered vs not) without mounting
// the whole notebook.
vi.mock("@/components/notebook", () => ({
  ProjectEditor: (props: {
    error?: string | null;
    onRetryLoad?: () => void;
  }) => (
    <div data-notebook-editor="" data-editor-error={props.error ?? ""}>
      {props.error && <button onClick={props.onRetryLoad}>Retry</button>}
    </div>
  ),
}));
vi.mock("@/components/agent", () => ({
  NotebookAgentComposerSuppressed: () => null,
  WorkspaceAgent: () => null,
}));
vi.mock("@agent-native/core/client/hooks", async () => {
  const error = () => mocks.error;
  return {
    actionErrorCode: (value: unknown) =>
      (value as { errorCode?: unknown } | undefined)?.errorCode,
    getBrowserTabId: () => "test-tab",
    callAction: vi.fn(),
    useActionMutation: () => ({ mutateAsync: vi.fn(async () => ({})) }),
    useActionQuery: (name: string) => {
      if (name === "get-workspace-bootstrap")
        return { data: undefined, isError: false, isPending: true };
      if (name === "get-project") {
        const err = error();
        return {
          data: mocks.data,
          error: err,
          isError: err !== null,
          isPending: false,
          isFetching: false,
          refetch: mocks.refetch,
        };
      }
      return { data: { connections: [] }, isError: false, isPending: false };
    },
  };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const ROUTE = resolveRoute("/project/zzz-not-a-project") ?? {
  params: { projectLocator: "zzz-not-a-project" },
};

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
  mocks.refetch.mockClear();
});

const render = async () => {
  root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () => {
    root?.render(
      <QueryClientProvider client={client}>
        <AgentNativeI18nProvider
          catalog={{ messages }}
          persistPreference={false}
        >
          <MemoryRouter initialEntries={["/project/zzz-not-a-project"]}>
            <NotebookPage route={ROUTE as never} />
          </MemoryRouter>
        </AgentNativeI18nProvider>
      </QueryClientProvider>,
    );
    await Promise.resolve();
  });
  const text = (container.textContent ?? "").replace(/\s+/g, " ");
  return text;
};

describe("a project id that does not resolve", () => {
  it.each(["project_not_found", "internal_error"])(
    "report A2-EXTERNAL-DELETE-CACHED-PROJECT handles %s after a cached project",
    async (code) => {
      mocks.data = {
        project: {
          id: "zzz-not-a-project",
          title: "Cached project",
          cells: [],
          workingVersionId: "v1",
        },
        viewer: { email: "qa@example.test", orgId: "org" },
        outputs: {},
        queryStates: {},
        canEdit: true,
        capabilities: [],
      };
      await render();
      expect(container.querySelector("[data-notebook-editor]")).not.toBeNull();
      mocks.error = Object.assign(new Error("Project read failed"), {
        errorCode: code,
      });
      await act(async () => {
        root?.render(
          <QueryClientProvider client={new QueryClient()}>
            <MemoryRouter>
              <NotebookPage route={ROUTE as never} />
            </MemoryRouter>
          </QueryClientProvider>,
        );
      });
      const editor = container.querySelector("[data-notebook-editor]");
      if (code === "project_not_found") {
        expect(
          container.querySelector("[data-project-not-found]"),
        ).not.toBeNull();
        expect(editor).toBeNull();
      } else {
        expect(container.querySelector("[data-project-not-found]")).toBeNull();
        expect(editor?.getAttribute("data-editor-error")).toBe(
          "Project read failed",
        );
        const retry = editor?.querySelector("button");
        expect(retry).not.toBeNull();
        await act(async () => retry?.click());
        expect(mocks.refetch).toHaveBeenCalledOnce();
      }
    },
  );
  it("renders the app's not-found copy instead of an editable Untitled project", async () => {
    mocks.error = Object.assign(
      new Error("That project is not in this workspace."),
      { errorCode: "project_not_found" },
    );
    const text = await render();

    expect(container.querySelector("[data-project-not-found]")).not.toBeNull();
    expect(text).toContain("Project not found");
    expect(text).toContain("You don’t have access to this page.");
    expect(text).toContain("Back to Projects");
    // The two things the bug produced: an editable placeholder project and an editor.
    expect(text).not.toContain("Untitled project");
    expect(container.querySelector("[data-notebook-editor]")).toBeNull();
  });

  it("keeps the editor and its Retry for a transient failure", async () => {
    mocks.error = Object.assign(new Error("Could not reach the workspace."), {
      errorCode: "internal_error",
    });
    const text = await render();

    expect(container.querySelector("[data-project-not-found]")).toBeNull();
    // The transient path still renders the editor, with its own error text (which is
    // what carries the Retry), and never the 404 copy.
    const editor = container.querySelector("[data-notebook-editor]");
    expect(editor).not.toBeNull();
    expect(editor?.getAttribute("data-editor-error")).toContain(
      "Could not reach the workspace.",
    );
    expect(text).not.toContain("App unavailable");
  });
});
