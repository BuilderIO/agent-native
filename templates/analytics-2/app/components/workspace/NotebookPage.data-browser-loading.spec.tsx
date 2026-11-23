// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

import { ANALYTICS_CONTROL_IDS } from "../../../shared/analytics-control-ids";
import { capabilityDecisionSchema } from "../../../shared/capabilities";
import { NotebookPage } from "./NotebookPage";

vi.mock(
  "@agent-native/core/client/i18n",
  async () => (await import("@/skins/reference/testing/i18n")).i18nMock,
);

const mocks = vi.hoisted(() => ({ data: undefined as unknown }));
const browseDecision = capabilityDecisionSchema.parse({
  controlId: ANALYTICS_CONTROL_IDS.dataBrowse,
  scope: { kind: "workspace", workspaceId: "org" },
  status: "allowed",
  target: { kind: "route", routeId: "data-browser" },
});
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({ session: { email: "qa@example.test" } }),
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: { orgId: "org" }, isPending: false, isError: false }),
}));
vi.mock("@agent-native/core/client/application-state", () => ({
  compareAndSetClientAppState: vi.fn(async () => {}),
}));
vi.mock("@agent-native/core/client/resources/use-resources", () => ({
  useResources: () => ({ data: [] }),
  useResource: () => ({ data: undefined }),
}));
vi.mock("@agent-native/toolkit/app/shared", () => ({
  AgentNativeIcon: () => <span />,
  useDocumentTitle: () => {},
}));
vi.mock("./WorkspaceDataContext", () => ({
  useWorkspaceData: () => ({
    shell: {
      workspace: { id: "org" },
      user: { email: "qa@example.test" },
      features: { canCreateProject: true },
      capabilities: [browseDecision],
    },
  }),
}));
vi.mock("@/components/agent", () => ({
  NotebookAgentComposerSuppressed: () => null,
  WorkspaceAgent: () => null,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorCode: () => null,
  actionErrorMessage: () => null,
  callAction: vi.fn(),
  getBrowserTabId: () => "test-tab",
  writeClientAppState: vi.fn(async () => {}),
  compareAndSetClientAppState: vi.fn(async () => {}),
  useActionMutation: () => ({ mutateAsync: vi.fn(async () => ({})) }),
  useActionQuery: (name: string) =>
    name === "get-project"
      ? {
          data: mocks.data,
          isPending: !mocks.data,
          isError: false,
          refetch: vi.fn(),
        }
      : { data: undefined, isPending: false, isError: false },
}));

it("report A2-LIVE-NOTEBOOK-DATA-BROWSER keeps the opened data browser while the project read completes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.data = undefined;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const render = () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <NotebookPage
            route={{ params: { projectLocator: "project-1" } } as never}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  try {
    await act(async () => render());
    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Data browser"]',
    );
    expect(button).not.toBeNull();
    await act(async () => button?.click());
    expect(
      host.querySelector('aside[aria-label="Data browser"]'), // oracle-change: the opened notebook data browser is a side panel
    ).not.toBeNull();
    mocks.data = {
      project: {
        id: "project-1",
        title: "Project",
        description: "",
        language: "python",
        ownerEmail: "qa@example.test",
        statusId: null,
        favorited: false,
        trashedAt: null,
        archivedAt: null,
        lastOpenedAt: null,
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
        collectionIds: [],
        cells: [],
        workingVersionId: "v1",
        publishedVersionId: null,
      },
      viewer: { email: "qa@example.test", orgId: "org" },
      outputs: {},
      queryStates: {},
      canEdit: true,
      capabilities: [browseDecision],
    };
    await act(async () => render());
    expect(
      host.querySelector('aside[aria-label="Data browser"]'), // oracle-change: the project read retains the notebook side panel
    ).not.toBeNull();
    mocks.data = {
      ...(mocks.data as object),
      project: {
        ...(mocks.data as { project: object }).project,
        workingVersionId: "v2",
      },
    };
    await act(async () => render());
    expect(
      host.querySelector('aside[aria-label="Data browser"]'), // oracle-change: a new working version closes the notebook side panel
    ).toBeNull();
    const reopened = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Data browser"]',
    );
    expect(reopened).not.toBeNull();
    await act(async () => reopened?.click());
    expect(
      host.querySelector('aside[aria-label="Data browser"]'), // oracle-change: reopening the browser mounts the notebook side panel
    ).not.toBeNull();
    mocks.data = {
      ...(mocks.data as object),
      capabilities: [
        capabilityDecisionSchema.parse({
          controlId: browseDecision.controlId,
          scope: browseDecision.scope,
          status: "denied",
          reason: "access_denied",
        }),
      ],
    };
    await act(async () => render());
    expect(host.querySelector('aside[aria-label="Data browser"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Data browser"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    vi.unstubAllGlobals();
  }
});
