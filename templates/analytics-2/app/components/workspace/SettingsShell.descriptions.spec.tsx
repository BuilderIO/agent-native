// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

import enUS from "../../i18n/en-US";

function lookupEn(key: string): string {
  const parts = key.split(".");
  let current: unknown = enUS;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  return typeof current === "string" ? current : key;
}

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => lookupEn(key),
}));
vi.mock("@agent-native/core/client/org", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/org")>()),
  useOrg: () => ({
    data: { orgId: "org-1", role: "member" },
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@agent-native/core/client/use-session", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/use-session")>()),
  useSession: () => ({
    session: { email: "member@example.test" },
    isLoading: false,
  }),
}));
vi.mock("@agent-native/core/client/resources/use-resources", () => ({
  useResources: () => ({ data: [], isPending: false }),
  useResource: () => ({ data: null, isPending: false }),
  useCreateResource: () => ({ mutateAsync: vi.fn() }),
  useUpdateResource: () => ({ mutateAsync: vi.fn() }),
}));

import { AnalyticsGroupsPage } from "../settings/AnalyticsWorkspaceSettings";
import {
  ApiKeysSettingsPage,
  NotificationsSettingsPage,
} from "../settings/SettingsShellBridgedPages";
import { SettingsShell } from "./SettingsShell";

let root: ReturnType<typeof createRoot> | undefined;
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

afterEach(() => {
  act(() => root?.unmount());
  queryClient.clear();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

describe("report M5-T2-F-06 settings page headers and descriptions", () => {
  it("renders Notifications title and description", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(
            MemoryRouter,
            { initialEntries: ["/settings/notifications"] },
            createElement(SettingsShell, {
              activeTab: "notifications",
              canManageWorkspace: false,
              children: createElement(NotificationsSettingsPage),
            }),
          ),
        ),
      );
    });
    expect(host.querySelector("h1")?.textContent).toBe("Notifications");
    expect(host.textContent).toContain(
      "Manage notifications about comments, scheduled runs, and more.",
    );
  });

  it("renders API keys title and description", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ keys: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(
            MemoryRouter,
            { initialEntries: ["/settings/api-keys"] },
            createElement(SettingsShell, {
              activeTab: "api-keys",
              canManageWorkspace: false,
              children: createElement(ApiKeysSettingsPage),
            }),
          ),
        ),
      );
    });
    expect(host.querySelector("h1")?.textContent).toBe("API keys");
    expect(host.textContent).toContain(
      "Manage the tokens used to access the API.",
    );
  });

  it("renders Groups title, description, and no duplicate Groups heading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify([{ id: "g1", name: "Core team" }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(
            MemoryRouter,
            { initialEntries: ["/settings/groups"] },
            createElement(SettingsShell, {
              activeTab: "groups",
              canManageWorkspace: false,
              children: createElement(AnalyticsGroupsPage),
            }),
          ),
        ),
      );
    });
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Core team");
    });
    expect(host.querySelector("h1")?.textContent).toBe("Groups");
    expect(host.textContent).toContain(
      "Subsets of users with defined permissions.",
    );
    const innerHeadings = [
      ...host.querySelectorAll(
        ".settings-inner h1, .settings-inner h2, .settings-inner h3",
      ),
    ].filter((el) => el.textContent?.trim() === "Groups");
    expect(innerHeadings).toHaveLength(1);
    expect(innerHeadings[0]?.tagName).toBe("H1");
  });
});
