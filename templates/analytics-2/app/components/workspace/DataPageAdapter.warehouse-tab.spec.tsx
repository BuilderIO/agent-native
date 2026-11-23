// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import { resolveRoute } from "@/routes/routing/registry";

import { DataPageAdapter } from "./DataPageAdapter";

const mocks = vi.hoisted(() => ({
  access: {} as Record<string, unknown>,
  refetch: vi.fn(async () => ({ data: undefined })),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(),
  useActionMutation: () => ({ mutateAsync: vi.fn() }),
  useActionQuery: () => ({
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: mocks.refetch,
    data: undefined,
  }),
}));
vi.mock("@/components/data/useDataConnectionActions", () => ({
  useDataConnectionActions: () => ({
    access: mocks.access,
    connections: {
      data: undefined,
      isPending: true,
      isError: false,
      refetch: mocks.refetch,
    },
    schemas: { data: undefined },
    save: vi.fn(),
    getForm: vi.fn(),
  }),
}));
vi.mock("@/components/data/AddDataConnectionDialog", () => ({
  AddDataConnectionDialog: () => null,
}));
vi.mock("@/components/data/DataBrowserPage", () => ({
  DataBrowserPage: () => null,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of mounted.splice(0)) await cleanup();
  vi.clearAllMocks();
});

async function render() {
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
        <DataPageAdapter
          route={resolveRoute("/home/data", { authenticated: true })}
        />
      </MemoryRouter>,
    ),
  );
  return container;
}

it("keeps the Warehouse tab on screen while the access read is pending", async () => {
  mocks.access = { isPending: true, isError: false, data: undefined };
  const container = await render();
  const tabs = [...container.querySelectorAll('[role="tab"]')].map((tab) =>
    tab.textContent?.trim(),
  );
  expect(tabs).toEqual(["Warehouse"]);
  expect(
    container.querySelector(
      '[role="status"][aria-label="Loading data browser"]',
    ),
  ).not.toBeNull();
});

it("keeps the Warehouse tab and shows the typed error with Retry when the access read fails", async () => {
  mocks.access = {
    isPending: false,
    isError: true,
    error: new Error("Workspace access could not be read."),
    refetch: mocks.refetch,
    data: undefined,
  };
  const container = await render();
  expect(container.querySelector('[role="tab"]')?.textContent).toBe(
    "Warehouse",
  );
  const alert = container.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("Workspace access could not be read.");
  const retry = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  );
  await act(async () => retry?.click());
  expect(mocks.refetch).toHaveBeenCalledOnce();
});

it("shows no Warehouse tab to a member without data access", async () => {
  mocks.access = {
    isPending: false,
    isError: false,
    refetch: mocks.refetch,
    data: {
      capabilities: [],
      canManageMetadata: false,
      isAdministrator: false,
      aiEnabled: true,
    },
  };
  const container = await render();
  expect(container.querySelector('[role="tab"]')).toBeNull();
  expect(container.textContent).toContain("do not have permissions");
});
