// @vitest-environment jsdom

import { agentPanelShortcutSelectionText } from "@agent-native/toolkit/app/chat/agent-sidebar-events";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAssistantReady, useShellSettled } from "./shell-ready";

const {
  agentSidebarProps,
  agentSidebarSpy,
  docsWebMcpActions,
  navigateMock,
  revalidateMock,
  routerRootHref,
  deliveredPanelEvents,
  deliveredShortcutSelections,
  assistantReadySpy,
} = vi.hoisted(() => ({
  agentSidebarProps: [] as Array<Record<string, unknown>>,
  agentSidebarSpy: vi.fn(),
  docsWebMcpActions: [] as Array<{ run: (args: unknown) => unknown }>,
  navigateMock: vi.fn(),
  revalidateMock: vi.fn(),
  routerRootHref: { value: "/" },
  deliveredPanelEvents: [] as string[],
  deliveredShortcutSelections: [] as string[],
  assistantReadySpy: vi.fn(),
}));

function ShellSettledProbe() {
  const settled = useShellSettled();
  const ensureAssistantReady = useAssistantReady();
  return (
    <p data-testid="page">
      <span data-testid="settled">{String(settled)}</span>
      <button
        onClick={() => void ensureAssistantReady().then(assistantReadySpy)}
      >
        Prepare assistant
      </button>
    </p>
  );
}

vi.mock("@agent-native/toolkit/app/chat", () => ({
  focusAgentChat: vi.fn(),
  AgentSidebar: (props: {
    children: React.ReactNode;
    defaultOpen?: boolean;
    screenRefreshEnabled?: boolean;
  }) => {
    agentSidebarSpy(props);
    agentSidebarProps.push(props);
    useEffect(() => {
      const events = [
        "agent-panel:toggle",
        "agent-panel:open",
        "agent-panel:prepare",
        "agent-panel:close",
      ];
      const receive = (event: Event) => deliveredPanelEvents.push(event.type);
      const receiveShortcut = (event: KeyboardEvent) =>
        deliveredShortcutSelections.push(
          agentPanelShortcutSelectionText(event),
        );
      for (const event of events) window.addEventListener(event, receive);
      document.addEventListener("keydown", receiveShortcut);
      return () => {
        for (const event of events) window.removeEventListener(event, receive);
        document.removeEventListener("keydown", receiveShortcut);
      };
    }, []);
    return <div data-testid="real-sidebar">{props.children}</div>;
  },
}));
vi.mock("@agent-native/core/client/route-warmup", () => ({
  AgentNativeRouteWarmup: () => null,
  isClientRouteUrl: (url: { pathname: string }) =>
    !url.pathname.startsWith("/cdn-cgi/"),
}));
vi.mock("@agent-native/core/client/host", () => ({
  defineClientAction: (action: unknown) => action,
}));
vi.mock("@agent-native/toolkit/app/providers", () => ({
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

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  agentSidebarProps.length = 0;
  deliveredPanelEvents.length = 0;
  deliveredShortcutSelections.length = 0;
  agentSidebarSpy.mockClear();
  assistantReadySpy.mockClear();
  docsWebMcpActions.length = 0;
  navigateMock.mockClear();
  revalidateMock.mockClear();
  routerRootHref.value = "/";
  window.history.replaceState(null, "", "/");
});

describe("RootShell tree stability", () => {
  it("keeps page content mounted across the mounted flip", async () => {
    const { RootShell } = await import("./root");
    const { rerender } = render(<RootShell mounted={false} />);
    const before = screen.getAllByTestId("page")[0];

    rerender(<RootShell mounted />);

    expect(screen.getAllByTestId("page")[0]).toBe(before);
  });

  it("keeps Docs sidebars out of screen-refresh sync", async () => {
    const { RootShell } = await import("./root");
    render(<RootShell mounted />);
    expect(agentSidebarProps).toHaveLength(0);
    fireEvent(window, new Event("agent-panel:toggle"));
    await vi.dynamicImportSettled();

    await vi.waitFor(() => expect(agentSidebarProps.length).toBeGreaterThan(0));
    expect(agentSidebarProps.at(-1)).toMatchObject({
      defaultOpen: false,
      screenRefreshEnabled: false,
    });
  });

  it("leaves the assistant unloaded on a passive visit", async () => {
    const { RootShell } = await import("./root");
    render(<RootShell mounted />);
    await vi.dynamicImportSettled();
    expect(agentSidebarProps).toHaveLength(0);
    expect(screen.getByTestId("settled").textContent).toBe("true");
  });

  it("resolves submission readiness after listeners can prepare the panel", async () => {
    const { RootShell } = await import("./root");
    render(<RootShell mounted />);
    fireEvent.click(screen.getByRole("button", { name: "Prepare assistant" }));
    expect(assistantReadySpy).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(assistantReadySpy).toHaveBeenCalledTimes(1));
    expect(deliveredPanelEvents).toEqual(["agent-panel:prepare"]);
  });

  it("keeps page state and DOM mounted when the assistant activates", async () => {
    const { RootShell } = await import("./root");
    render(<RootShell mounted />);
    const before = screen.getByTestId("page");
    fireEvent(window, new Event("agent-panel:toggle"));
    await vi.waitFor(() => expect(agentSidebarProps.length).toBeGreaterThan(0));
    expect(screen.getByTestId("page")).toBe(before);
  });

  it.each(["agent-panel:open", "agent-panel:prepare"])(
    "loads the assistant on %s",
    async (event) => {
      const { RootShell } = await import("./root");
      render(<RootShell mounted />);
      fireEvent(window, new Event(event));
      await vi.waitFor(() =>
        expect(agentSidebarProps.length).toBeGreaterThan(0),
      );
      expect(deliveredPanelEvents).toEqual([event]);
    },
  );

  it("replays the first chat shortcut with selection still attached to the page", async () => {
    const { RootShell } = await import("./root");
    render(<RootShell mounted />);
    const selected = screen.getByTestId("settled").firstChild!;
    const range = document.createRange();
    range.selectNodeContents(selected);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.keyDown(document, { ctrlKey: true, key: "i" });
    await vi.waitFor(() =>
      expect(deliveredShortcutSelections).toEqual(["true"]),
    );
    expect(document.contains(selected)).toBe(true);
  });

  it.each(["?agentSidebar=open", "?threadId=example-thread"])(
    "loads chat deep links %s",
    async (search) => {
      window.history.replaceState(null, "", search);
      const { RootShell } = await import("./root");
      render(<RootShell mounted />);
      await vi.waitFor(() =>
        expect(agentSidebarProps.length).toBeGreaterThan(0),
      );
    },
  );

  it("does not capture the chat shortcut in text inputs", async () => {
    const { RootShell } = await import("./root");
    render(
      <>
        <RootShell mounted />
        <input data-testid="input" />
      </>,
    );
    fireEvent.keyDown(screen.getByTestId("input"), { ctrlKey: true, key: "i" });
    await vi.dynamicImportSettled();
    expect(agentSidebarProps).toHaveLength(0);
    fireEvent.keyDown(document, { ctrlKey: true, key: "\\" });
    await vi.waitFor(() => expect(agentSidebarProps.length).toBeGreaterThan(0));
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
