// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { i18nMock } = await import("./skins/reference/testing/i18n");
  return { ...actual, ...i18nMock };
});

vi.mock("@agent-native/toolkit/app/providers", () => ({
  AppProviders: ({ firstRunOnboarding }: { firstRunOnboarding: ReactNode }) =>
    firstRunOnboarding,
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    session: { email: "dev@example.test" },
    isLoading: false,
  }),
  notifySessionInvalidated: vi.fn(async () => {}),
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: { orgId: "org-test" }, isPending: false }),
}));
vi.mock("./components/workspace/WorkspaceApplication", () => ({
  WorkspaceApplication: () => null,
}));
vi.mock("./components/ui/toolkit-provider", () => ({
  AppToolkitProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./hooks/use-navigation-state", () => ({
  useNavigationState: () => {},
}));

import Root from "./root";

afterEach(() => vi.unstubAllGlobals());

it("completes the app's Skip with its user and workspace scope exactly once", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const bodies: unknown[] = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/onboarding/first-run/complete")) {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify({}));
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <Root />
        </MemoryRouter>,
      );
    });
    const skip = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Skip",
    );
    expect(skip).toBeDefined();
    await act(async () => {
      skip?.click();
    });
    expect(bodies).toEqual([
      { expectedUserEmail: "dev@example.test", expectedOrgId: "org-test" },
    ]);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
