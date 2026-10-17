// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderUi } from "@/test-utils/render-ui";

const host = vi.hoisted(() => ({ embedded: false }));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/mcp-app-host", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/mcp-app-host")
  >()),
  useIsMcpAppWidgetEmbed: () => host.embedded,
}));
vi.mock("@agent-native/creative-context/client", () => ({
  CreativeContextComposerChip: () => null,
}));
vi.mock("@agent-native/toolkit/app/chat/AgentSidebar", () => ({
  AgentSidebar: ({ children }: { children: ReactNode }) => (
    <div data-testid="agent-sidebar">{children}</div>
  ),
  AgentToggleButton: () => <button type="button">toggle agent</button>,
}));
vi.mock("@agent-native/toolkit/app/org", () => ({
  InvitationBanner: () => <div data-testid="invitation-banner" />,
}));
vi.mock("@/components/sidebar/DocumentSidebar", () => ({
  DocumentSidebar: () => <aside data-testid="document-sidebar" />,
}));
vi.mock("@/components/editor/DocumentEditor", () => ({
  DocumentEditor: () => <div data-testid="document-editor" />,
}));
vi.mock("@/hooks/use-create-page", () => ({ useCreatePage: () => vi.fn() }));
vi.mock("@/hooks/use-creative-context-lab", () => ({
  useCreativeContextLab: () => false,
}));
vi.mock("@/hooks/use-documents", () => ({
  startPageOpenDocumentReads: vi.fn(),
}));
vi.mock("@/hooks/use-optimistic-document-title", () => ({
  useOptimisticDocumentTitle: () => null,
}));

import { Layout } from "./Layout";
import { useSidebarTrigger } from "./sidebar-trigger";

function PageProbe() {
  const trigger = useSidebarTrigger();
  return (
    <div data-testid="page" data-has-sidebar-trigger={String(trigger !== null)}>
      page
    </div>
  );
}

async function renderLayout(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <Layout>
            <PageProbe />
          </Layout>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  const view = renderUi(<RouterProvider router={router} />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return view;
}

function shown(testId: string) {
  return document.body.querySelector(`[data-testid="${testId}"]`) !== null;
}

afterEach(() => {
  host.embedded = false;
  vi.unstubAllGlobals();
});

describe.each([360, 1040])("the Content shell at %ipx", (width) => {
  it("draws the document sidebar and agent panel in the app, and the page", async () => {
    vi.stubGlobal("innerWidth", width);

    await renderLayout("/page/doc-1");

    expect(shown("agent-sidebar")).toBe(true);
    expect(shown("page")).toBe(true);
    // A narrow window moves the sidebar into a drawer behind a menu button.
    expect(shown("document-sidebar")).toBe(width >= 1040);
  });

  it("draws the app's own shell with no sidebar, menu button, or agent panel in an MCP App widget", async () => {
    host.embedded = true;
    vi.stubGlobal("innerWidth", width);

    await renderLayout("/page/doc-1");

    expect(shown("page")).toBe(true);
    expect(shown("document-sidebar")).toBe(false);
    expect(shown("agent-sidebar")).toBe(false);
    expect(shown("invitation-banner")).toBe(false);
    expect(
      document.body
        .querySelector('[data-testid="page"]')
        ?.getAttribute("data-has-sidebar-trigger"),
    ).toBe("false");

    const shell = document.body.querySelector(".agent-layout-shell");
    const main = document.body.querySelector(".agent-native-app-main");
    // The same shell the app draws, not a second one for the host.
    expect(shell?.className).toContain("h-screen");
    expect(shell?.className).not.toContain("h-dvh");
    expect(main?.parentElement).toBe(shell);
  });
});
