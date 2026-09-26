// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useShellSettled } from "./shell-ready";

const {
  agentSidebarSpy,
  docsWebMcpActions,
  navigateMock,
  revalidateMock,
  routerRootHref,
} = vi.hoisted(() => ({
  agentSidebarSpy: vi.fn(),
  docsWebMcpActions: [] as Array<{ run: (args: unknown) => unknown }>,
  navigateMock: vi.fn(),
  revalidateMock: vi.fn(),
  routerRootHref: { value: "/" },
}));

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
  defineClientAction: (action: unknown) => action,
  isClientRouteUrl: (url: { pathname: string }) =>
    !url.pathname.startsWith("/cdn-cgi/"),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  AgentNativeWebMcpActionRegistration: () => null,
}));
vi.mock("@agent-native/core/client/webmcp", () => ({
  createAgentNativeWebMcpRegistration: ({
    actions,
  }: {
    actions: unknown[];
  }) => {
    docsWebMcpActions.push(
      ...(actions as Array<{ run: (args: unknown) => unknown }>),
    );
    return { start: vi.fn(async () => {}), stop: vi.fn() };
  },
}));
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
  Outlet: () => (
    <>
      <ShellSettledProbe />
      <a data-testid="content-link" href="/docs/actions-overview/">
        Shared actions
      </a>
      <a data-testid="protected-link" href="/cdn-cgi/l/email-protection#abc">
        Protected email
      </a>
    </>
  ),
  useLocation: () => ({ pathname: "/", hash: "", search: "" }),
  useHref: () => routerRootHref.value,
  useNavigate: () => navigateMock,
  useNavigation: () => ({ state: "idle" }),
  useMatches: () => [],
  useRevalidator: () => ({ revalidate: revalidateMock }),
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
  vi.useRealTimers();
  agentSidebarSpy.mockClear();
  docsWebMcpActions.length = 0;
  navigateMock.mockClear();
  revalidateMock.mockClear();
  routerRootHref.value = "/";
});

describe("RootShell tree stability", () => {
  it("keeps page content mounted across the mounted flip", async () => {
    const { RootShell } = await import("./root");
    const { rerender } = render(<RootShell mounted={false} />);
    const before = screen.getAllByTestId("page")[0];

    rerender(<RootShell mounted />);

    expect(screen.getAllByTestId("page")[0]).toBe(before);
  });

  it("only marks the shell settled inside the real sidebar subtree", async () => {
    const { RootShell } = await import("./root");
    render(<RootShell mounted={false} />);

    expect(screen.queryByTestId("real-sidebar")).toBeNull();
    expect(screen.getByTestId("settled").textContent).toBe("false");
  });

  it("registers same-origin documentation navigation as a page tool", async () => {
    const { RootShell } = await import("./root");
    render(<RootShell mounted />);

    await vi.waitFor(() => expect(docsWebMcpActions).toHaveLength(1));
    expect(
      docsWebMcpActions[0]!.run({ path: "/docs/webmcp#automatic-actions" }),
    ).toEqual({ path: "/docs/webmcp#automatic-actions" });
    expect(navigateMock).toHaveBeenCalledWith("/docs/webmcp#automatic-actions");

    expect(() =>
      docsWebMcpActions[0]!.run({ path: "https://example.com" }),
    ).toThrow("absolute path");
    expect(() => docsWebMcpActions[0]!.run({ path: "//example.com" })).toThrow(
      "current site",
    );
    expect(() => docsWebMcpActions[0]!.run({ path: 42 })).toThrow(
      "string path",
    );
  });

  it("navigates rendered content links through the router", async () => {
    const { RootShell } = await import("./root");
    render(<RootShell mounted />);

    screen.getByTestId("content-link").click();

    expect(navigateMock).toHaveBeenCalledWith("/docs/actions-overview/");
  });

  it("strips the router basename before navigating content links", async () => {
    const { RootShell } = await import("./root");
    routerRootHref.value = "/docs/";
    render(<RootShell mounted />);

    screen
      .getByTestId("content-link")
      .setAttribute("href", "/docs/docs/actions-overview/");
    screen.getByTestId("content-link").click();

    expect(navigateMock).toHaveBeenCalledWith("/docs/actions-overview/");
  });

  it("leaves non-route same-origin links to the browser", async () => {
    const { RootShell } = await import("./root");
    render(<RootShell mounted />);

    screen.getByTestId("protected-link").click();

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("revalidates a cold GitHub star count once", async () => {
    vi.useFakeTimers();
    const { RootShell } = await import("./root");
    render(<RootShell mounted={false} />);

    await vi.advanceTimersByTimeAsync(1_500);

    expect(revalidateMock).toHaveBeenCalledTimes(1);
  });
});
