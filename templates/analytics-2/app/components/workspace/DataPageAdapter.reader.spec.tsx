// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import { resolveRoute } from "@/routes/routing/registry";

import { ANALYTICS_CONTROL_IDS as controls } from "../../../shared/analytics-control-ids";
import { DataPageAdapter } from "./DataPageAdapter";
import { encodeScopedResourceId } from "./DataPageAdapter.model";

const mocks = vi.hoisted(() => ({
  browse: true,
  draft: false,
  manager: false,
  catalog: false,
  mutate: vi.fn(),
  refetch: vi.fn(async () => ({ data: undefined })),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(),
  useActionMutation: () => ({ mutateAsync: mocks.mutate }),
  useActionQuery: (name: string) => ({
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: mocks.refetch,
    data:
      name === "get-data-browser-catalog" && mocks.catalog
        ? {
            connectionId: "owned-reader-connection",
            refreshState: "never",
            lastRefreshed: null,
            hasSuccessfulSnapshot: false,
            bootstrapKey: "draft-1794913977",
          }
        : undefined,
  }),
}));
vi.mock("@/components/data/useDataConnectionActions", () => ({
  useDataConnectionActions: () => ({
    access: {
      isPending: false,
      isError: false,
      refetch: mocks.refetch,
      data: {
        capabilities: [
          {
            controlId: controls.dataBrowse,
            ...(mocks.browse
              ? {
                  status: "allowed",
                  target: { kind: "route", routeId: "data-browser" },
                }
              : { status: "denied", reason: "access_denied" }),
            scope: { kind: "workspace", workspaceId: "test-workspace" },
          },
        ],
        canBrowseData: true,
        canManageMetadata: mocks.manager,
        isAdministrator: false,
        aiEnabled: true,
      },
    },
    connections: {
      data: {
        connections: [
          {
            id: "owned-reader-connection",
            name: "QA reader warehouse",
            type: "bigquery",
            isDraft: mocks.draft,
          },
        ],
      },
      isPending: false,
      isError: false,
      refetch: mocks.refetch,
    },
    schemas: { data: { schemas: [] } },
    save: mocks.mutate,
    setDefault: mocks.mutate,
    getForm: mocks.mutate,
  }),
}));
vi.mock("@/components/data/AddDataConnectionDialog", () => ({
  AddDataConnectionDialog: () => null,
}));
vi.mock("@/components/data/DataBrowserPage", () => ({
  DataBrowserPage: ({
    selectedNodeDetail,
    canManageMetadata,
  }: {
    selectedNodeDetail?: ReactNode;
    canManageMetadata?: boolean;
  }) => (
    <section data-editor-enabled={String(canManageMetadata)}>
      {selectedNodeDetail}
    </section>
  ),
}));
vi.mock("./DataResourceDetail", () => ({
  DataResourceDetail: ({ node }: { node: { id: string } }) => (
    <article aria-label="Selected read-only resource">{node.id}</article>
  ),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of mounted.splice(0)) await cleanup();
  mocks.browse = true;
  mocks.draft = false;
  mocks.manager = false;
  mocks.catalog = false;
  vi.clearAllMocks();
});
async function openSelectedTable() {
  const id = encodeScopedResourceId({
    connectionId: "owned-reader-connection",
    kind: "table",
    resourceId: "table:qa-project:qa-dataset:qa-table",
  });
  const route = resolveRoute(`/home/data/all/table/${encodeURIComponent(id)}`, {
    authenticated: true,
  });
  expect(route.params.detailViewType).toBe("table");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  await act(async () =>
    root.render(
      <MemoryRouter>
        <DataPageAdapter route={route} />
      </MemoryRouter>,
    ),
  );
  return container;
}
it("opens a selected table for a browser reader without granting metadata mutations", async () => {
  const container = await openSelectedTable();
  expect(
    container.querySelector('[aria-label="Selected read-only resource"]')
      ?.textContent,
  ).toBe("table:qa-project:qa-dataset:qa-table");
  expect(
    container.querySelector("section")?.getAttribute("data-editor-enabled"),
  ).toBe("false");
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it("keeps a directly opened table hidden when the scoped browse decision denies access", async () => {
  mocks.browse = false;
  const container = await openSelectedTable();
  expect(
    container.querySelector('[aria-label="Selected read-only resource"]'),
  ).toBeNull();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(mocks.mutate).not.toHaveBeenCalled();
});

it("report 1794913977.330369: does not bootstrap a draft connection's catalog", async () => {
  mocks.draft = true;
  mocks.manager = true;
  mocks.catalog = true;
  await openSelectedTable();
  expect(mocks.mutate).not.toHaveBeenCalled();
});
