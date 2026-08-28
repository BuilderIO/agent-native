// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useShellSettled } from "./shell-ready";

const { agentSidebarSpy } = vi.hoisted(() => ({ agentSidebarSpy: vi.fn() }));

function ShellSettledProbe() {
  const settled = useShellSettled();
  return (
    <p data-testid="page">
      <span data-testid="settled">{String(settled)}</span>
    </p>
  );
}

vi.mock("@agent-native/core/client/agent-chat", () => ({
  AgentSidebar: ({ children }: { children: React.ReactNode }) => {
    agentSidebarSpy();
    return <div data-testid="real-sidebar">{children}</div>;
  },
}));
vi.mock("@agent-native/core/client/host", () => ({
  AgentNativeRouteWarmup: () => null,
}));
// Only the core boundary is stubbed; the app's own modules stay real so this
// exercises the shell React actually renders.
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useLocale: () => "en-US",
  DEFAULT_LOCALE: "en-US",
  LOCALE_METADATA: { "en-US": { label: "English", dir: "ltr" } },
  localeDirection: () => "ltr",
  normalizeLocaleCode: (value: string) => value,
  resolveLocaleFromCandidates: () => "en-US",
  AgentNativeI18nProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock("react-router", () => ({
  Outlet: () => <ShellSettledProbe />,
  useLocation: () => ({ pathname: "/", hash: "", search: "" }),
  useNavigation: () => ({ state: "idle" }),
  useMatches: () => [],
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useRouteError: () => null,
  isRouteErrorResponse: () => false,
  Meta: () => null,
  Links: () => null,
  Scripts: () => null,
  ScrollRestoration: () => null,
}));
vi.mock("./components/website-redesign/site-header", () => ({
  SiteHeader: () => null,
}));
vi.mock("./components/website-redesign/footer", () => ({ Footer: () => null }));

afterEach(() => {
  cleanup();
  agentSidebarSpy.mockClear();
});

describe("RootShell tree stability", () => {
  // The bug: page content lived at one tree position before `mounted` and a
  // different one after, so React destroyed and rebuilt every element on the
  // page. The hero's WebGPU renderer was built twice and its fade restarted
  // mid-animation, which is what read as the background flashing on load.
  it("keeps page content mounted across the mounted flip", async () => {
    const { RootShell } = await import("./root");
    const { rerender } = render(<RootShell mounted={false} />);
    const before = screen.getAllByTestId("page")[0];

    rerender(<RootShell mounted />);

    // React keeps a suspended subtree in the DOM behind the fallback, so query
    // all of them: the placeholder's node must be the same object it was.
    expect(screen.getAllByTestId("page")[0]).toBe(before);
  });

  it("only marks the shell settled inside the real sidebar subtree", async () => {
    const { RootShell } = await import("./root");
    render(<RootShell mounted={false} />);

    // The placeholder subtree is the one React throws away. Anything that waits
    // on the settled signal must not see it as settled here.
    expect(screen.queryByTestId("real-sidebar")).toBeNull();
    expect(screen.getByTestId("settled").textContent).toBe("false");
  });

});
