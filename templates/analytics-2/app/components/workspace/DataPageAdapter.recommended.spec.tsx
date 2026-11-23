// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveRoute } from "@/routes/routing/registry";

import { ANALYTICS_CONTROL_IDS as controls } from "../../../shared/analytics-control-ids";
import { DataPageAdapter } from "./DataPageAdapter";
import { resolveDataBrowserView } from "./DataPageAdapter.model";

const mocks = vi.hoisted(() => ({
  queryData: {} as Record<string, unknown>,
  refetch: vi.fn(async () => ({ data: undefined })),
  mutateAsync: vi.fn(async () => ({})),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(),
  useActionMutation: () => ({ mutateAsync: mocks.mutateAsync }),
  useActionQuery: (name: string) => ({
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: mocks.refetch,
    data: mocks.queryData[name],
  }),
}));

vi.mock("@/components/data/useDataConnectionActions", () => ({
  useDataConnectionActions: () => ({
    access: {
      isPending: false,
      isError: false,
      refetch: mocks.refetch,
      data: {
        capabilities: [{ controlId: controls.dataBrowse, status: "allowed" }],
        canManageMetadata: true,
        isAdministrator: true,
        aiEnabled: true,
      },
    },
    connections: {
      data: { connections: [] },
      isPending: false,
      isError: false,
      refetch: mocks.refetch,
    },
    schemas: { data: { schemas: [] } },
    save: vi.fn(),
    getForm: vi.fn(),
    testConnection: vi.fn(),
    onInviteAdmin: vi.fn(),
  }),
}));

vi.mock("@/components/data/AddDataConnectionDialog", () => ({
  AddDataConnectionDialog: () => null,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of mounted.splice(0)) await cleanup();
  mocks.queryData = {};
  vi.clearAllMocks();
});

async function renderAt(pathname: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[pathname]}>
        <DataPageAdapter
          route={resolveRoute(pathname, { authenticated: true })}
        />
      </MemoryRouter>,
    ),
  );
  return container;
}

describe("DataPageAdapter Recommended tab", () => {
  it("resolves /home/data/recommended to the recommended view", () => {
    expect(resolveDataBrowserView("recommended")).toBe("recommended");
  });

  it("renders the Recommended tab alongside Warehouse on /home/data", async () => {
    const container = await renderAt("/home/data");
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((tab) =>
      tab.textContent?.trim(),
    );
    expect(tabs).toContain("Recommended");
    expect(tabs).toContain("Warehouse");
  });

  it("renders Endorsed data, Recently used and Favorites on /home/data/recommended", async () => {
    mocks.queryData = {
      "list-data-endorsed-catalog": {
        itemTypes: ["view", "model", "table", "schema"],
        groups: {
          view: [],
          model: [],
          table: [
            {
              id: "conn-1:table:table:sample:PUBLIC:orders",
              connectionId: "conn-1",
              resourceId: "table:sample:PUBLIC:orders",
              resourceKind: "table",
              group: "table",
              name: "orders",
              description: "Endorsed orders table",
              pinned: false,
              status: { id: "sts-1", name: "Endorsed" },
              categories: [],
              connection: { id: "conn-1", name: "Sample", type: "sample" },
            },
          ],
          schema: [
            {
              id: "conn-1:schema:schema:PUBLIC",
              connectionId: "conn-1",
              resourceId: "schema:PUBLIC",
              resourceKind: "schema",
              group: "schema",
              name: "PUBLIC",
              description: "",
              pinned: false,
              status: { id: "sts-1", name: "Endorsed" },
              categories: [],
              connection: { id: "conn-1", name: "Sample", type: "sample" },
            },
          ],
        },
        items: [
          {
            id: "conn-1:table:table:sample:PUBLIC:orders",
            connectionId: "conn-1",
            resourceId: "table:sample:PUBLIC:orders",
            resourceKind: "table",
            group: "table",
            name: "orders",
            description: "Endorsed orders table",
            pinned: false,
            status: { id: "sts-1", name: "Endorsed" },
            categories: [],
            connection: { id: "conn-1", name: "Sample", type: "sample" },
          },
          {
            id: "conn-1:schema:schema:PUBLIC",
            connectionId: "conn-1",
            resourceId: "schema:PUBLIC",
            resourceKind: "schema",
            group: "schema",
            name: "PUBLIC",
            description: "",
            pinned: false,
            status: { id: "sts-1", name: "Endorsed" },
            categories: [],
            connection: { id: "conn-1", name: "Sample", type: "sample" },
          },
        ],
        statuses: [{ id: "sts-1", name: "Endorsed" }],
        categories: [],
      },
      "list-data-recents": { recents: [] },
      "list-data-favorites": { favorites: [] },
    };

    const container = await renderAt("/home/data/recommended");
    const recTab = [...container.querySelectorAll('[role="tab"]')].find(
      (tab) => tab.textContent?.trim() === "Recommended",
    );
    expect(recTab?.getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("Endorsed data");
    expect(container.textContent).toContain("orders");
    expect(container.textContent).toContain("PUBLIC");
    expect(container.textContent).toContain("Recently used");
    expect(container.textContent).toContain("Favorites");
  });
});
