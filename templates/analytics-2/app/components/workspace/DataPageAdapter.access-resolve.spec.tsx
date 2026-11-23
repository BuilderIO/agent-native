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

function tree() {
  return (
    <MemoryRouter>
      <DataPageAdapter
        route={resolveRoute("/home/data", { authenticated: true })}
      />
    </MemoryRouter>
  );
}

it("renders the data browser when the access read resolves after pending", async () => {
  mocks.access = { isPending: true, isError: false, data: undefined };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  await act(async () => root.render(tree()));
  expect(
    container.querySelector(
      '[role="status"][aria-label="Loading data browser"]',
    ),
  ).not.toBeNull();

  mocks.access = {
    isPending: false,
    isError: false,
    refetch: mocks.refetch,
    data: {
      capabilities: [{ controlId: "data-browse", status: "allowed" }],
      canManageMetadata: false,
      isAdministrator: false,
      aiEnabled: true,
    },
  };
  await act(async () => root.render(tree()));
  expect(container.textContent).not.toContain("do not have permissions");
  expect(
    container.querySelector(
      '[role="status"][aria-label="Loading data browser"]',
    ),
  ).toBeNull();
});
