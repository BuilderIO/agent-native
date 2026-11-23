// @vitest-environment happy-dom

import { act, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  compute: {
    data: {
      runtime: "Pyodide",
      runtimeVersion: "3.14.0",
      packages: [{ name: "pandas", version: "2.3.0" }],
    },
    isPending: false,
    isError: false,
  },
  groups: {
    data: [{ id: "group-1", name: "Analysts" }],
    isPending: false,
    isError: false,
    isSuccess: true,
  },
  org: {
    data: { orgId: "org-1", role: "member" } as
      | { orgId: string; role: string }
      | undefined,
    isError: false,
    isPending: false,
  },
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery: (name: string) =>
    name === "list-environment-packages" ? state.compute : state.groups,
}));
vi.mock("@agent-native/core/client/use-session", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/use-session")
  >()),
  useSession: () => ({
    session: { email: "member@example.test" },
    isLoading: false,
  }),
}));
vi.mock("@agent-native/core/client/org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/org")>()),
  useOrg: () => state.org,
}));
vi.mock("@agent-native/toolkit/app/org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/toolkit/app/org")>()),
  OrgMembersPage: () => <p>Search people</p>,
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) =>
    ({
      "analytics.settings.workspace.groups": "Groups",
      "analytics.settings.workspace.groupsLoadError": "Failed to load groups",
      "org.noGroups": "No groups yet",
    })[key] ?? key,
}));

import { resolveRoutePage } from "../workspace/pages";

const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);
afterEach(() => act(() => root.render(null)));

it("opens the Compute route and displays the runtime's packages", async () => {
  const route = { id: "settings", view: "compute" } as never;
  const Page = resolveRoutePage(route, { isAdmin: false })?.component;
  if (!Page) throw new Error("Compute route missing");
  await act(async () =>
    root.render(
      <MemoryRouter>
        <Suspense fallback={null}>
          <Page route={route} />
        </Suspense>
      </MemoryRouter>,
    ),
  );
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect(host.textContent).toContain("Pyodide 3.14.0");
  expect(host.querySelector("li")?.textContent).toBe("pandas2.3.0");
});

it("opens the Groups route for members and distinguishes empty and failed reads", async () => {
  const route = { id: "settings", view: "groups" } as never;
  const Page = resolveRoutePage(route)?.component;
  if (!Page) throw new Error("Groups route missing");
  const render = async () => {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <Suspense fallback={null}>
            <Page route={route} />
          </Suspense>
        </MemoryRouter>,
      ),
    );
    await act(async () => {
      await vi.dynamicImportSettled();
    });
  };
  await render();
  expect(host.textContent).toContain("Analysts");
  expect(host.textContent).not.toContain("Search people");

  state.groups = {
    data: [],
    isPending: false,
    isError: false,
    isSuccess: true,
  };
  await render();
  expect(host.textContent).toContain("No groups yet");

  state.groups = {
    data: [],
    isPending: false,
    isError: true,
    isSuccess: false,
  };
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "Failed to load groups",
  );
  expect(host.textContent).not.toContain("No groups yet");

  state.org = { data: undefined, isError: true, isPending: false };
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "Failed to load groups",
  );
});
