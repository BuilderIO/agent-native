// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const access = vi.hoisted(() => ({ isAdmin: true }));

vi.mock("@/components/workspace/WorkspaceDataContext", () => ({
  useWorkspaceData: () => ({
    shell: {
      features: { isAdmin: access.isAdmin, canCreateThread: true },
      workspace: { id: "ws-1", name: "Test Workspace" },
    },
  }),
}));

import { resolveRoutePage } from "./pages";

function LocationProbe() {
  const location = useLocation();
  return <output data-location-probe="">{location.pathname}</output>;
}

describe("settings:api-keys route page (A2-FIND-1120F-S1-15)", () => {
  let host: HTMLDivElement;
  let root: Root;
  let requestedUrls: string[];
  let originalFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    await import("@/components/settings/SettingsShellBridgedPages");
  }, 15_000);

  beforeEach(() => {
    access.isAdmin = true;
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    requestedUrls = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      requestedUrls.push(url);
      if (url.includes("/_agent-native/env-status")) {
        return new Response(
          JSON.stringify([
            {
              key: "ANTHROPIC_API_KEY",
              label: "Anthropic API Key",
              configured: false,
            },
            {
              key: "ENABLE_FEATURE_FLAG",
              label: "Enable Feature Flag",
              configured: false,
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/_agent-native/org/me")) {
        return new Response(
          JSON.stringify({
            orgId: "org-1",
            orgName: "Test Workspace",
            role: access.isAdmin ? "admin" : "member",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/_agent-native/actions/list-api-keys")) {
        return new Response(
          JSON.stringify({
            keys: [],
            managed: [],
            addable: [],
            canManageOrgKeys: access.isAdmin,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    globalThis.fetch = originalFetch;
  });

  it("mounts the shared API keys surface instead of legacy env-status ApiKeySettings", async () => {
    const entry = resolveRoutePage({
      id: "settings",
      view: "api-keys",
    } as never);
    expect(entry).toBeDefined();
    const Page = entry!.component;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/settings/api-keys"]}>
            <LocationProbe />
            <Suspense fallback={<div data-loading="">Loading</div>}>
              <Page route={{ id: "settings", view: "api-keys" } as never} />
            </Suspense>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(
      () => {
        expect(host.querySelector("[data-api-keys-settings]")).not.toBeNull();
      },
      { timeout: 10000 },
    );

    expect(
      requestedUrls.some((url) =>
        url.includes("/_agent-native/actions/list-api-keys"),
      ),
    ).toBe(true);
    expect(
      requestedUrls.some((url) => url.includes("/_agent-native/env-status")),
    ).toBe(false);

    const headerAction = host.querySelector("[data-settings-action]");
    expect(headerAction).not.toBeNull();
    expect(headerAction?.textContent).toContain("Add key");

    const inputs = [...host.querySelectorAll("input")];
    const placeholders = inputs
      .map((input) => input.getAttribute("placeholder") ?? "")
      .filter(Boolean);
    expect(placeholders.some((text) => /API Key key\.\.\./i.test(text))).toBe(
      false,
    );
    expect(
      inputs.some((input) => input.getAttribute("type") === "password"),
    ).toBe(false);

    const modelLink = [...host.querySelectorAll("button, a")].find((el) =>
      /model/i.test(el.textContent ?? ""),
    ) as HTMLElement | undefined;
    expect(modelLink).toBeDefined();
    await act(async () => {
      modelLink?.click();
    });
    expect(host.querySelector("[data-location-probe]")?.textContent).toBe(
      "/settings/model",
    );
  }, 15_000);

  it("renders for non-admin members with Add key header action", async () => {
    access.isAdmin = false;
    const entry = resolveRoutePage(
      { id: "settings", view: "api-keys" } as never,
      { isAdmin: false },
    );
    expect(entry).toBeDefined();
    const Page = entry!.component;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/settings/api-keys"]}>
            <Suspense fallback={<div data-loading="">Loading</div>}>
              <Page route={{ id: "settings", view: "api-keys" } as never} />
            </Suspense>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(
      () => {
        expect(host.querySelector("[data-api-keys-settings]")).not.toBeNull();
      },
      { timeout: 10000 },
    );

    const headerAction = host.querySelector("[data-settings-action]");
    expect(headerAction?.textContent).toContain("Add key");
  }, 15_000);
});
