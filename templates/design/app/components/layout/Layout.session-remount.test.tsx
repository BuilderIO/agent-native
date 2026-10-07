// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Layout } from "./Layout";

const sessionState = vi.hoisted(() => ({
  current: null as { email: string } | null,
}));
const embedState = vi.hoisted(() => ({ token: false, mcpAppWidget: false }));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSession: () => ({ session: sessionState.current, isLoading: false }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/host", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isEmbedAuthActive: () => embedState.token,
}));
vi.mock("@agent-native/core/client/mcp-app-host", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useIsMcpAppWidgetEmbed: () => embedState.mcpAppWidget,
}));
vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAgentChatHomeHandoff: () => false,
  useAgentChatHomeHandoffLinks: () => {},
}));
vi.mock("@agent-native/creative-context/client", () => ({
  CreativeContextComposerChip: () => null,
  useCreativeContextLab: () => false,
}));
vi.mock("@agent-native/toolkit/app/chat", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  AgentSidebar: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="agent-sidebar">{children}</div>
  ),
}));
vi.mock(
  "@agent-native/toolkit/app/chat/agentkit-chat",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useGuidedQuestionFlow: () => ({ questions: [] }),
  }),
);
vi.mock("@/hooks/use-navigation-state", () => ({
  useNavigationState: () => {},
}));
vi.mock("../editor/FigmaLinkComposerBubble", () => ({
  FigmaLinkComposerBubble: () => null,
  useDetectedFigmaComposerLink: () => ({
    link: null,
    onComposerTextChange: () => {},
  }),
}));
vi.mock("./Header", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./Header")>()),
  Header: () => <header data-testid="header" />,
  MobileHeaderActions: () => <div data-testid="mobile-header-actions" />,
}));
vi.mock("./Sidebar", () => ({
  Sidebar: () => <nav data-testid="sidebar" />,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  sessionState.current = null;
  embedState.token = false;
  embedState.mcpAppWidget = false;
});

it("keeps the design editor mounted when the session resolves", async () => {
  let mounts = 0;
  function Editor() {
    useEffect(() => {
      mounts += 1;
    }, []);
    return <div data-testid="editor" />;
  }
  const render = () =>
    root.render(
      <MemoryRouter initialEntries={["/design/abc"]}>
        <Layout>
          <Editor />
        </Layout>
      </MemoryRouter>,
    );

  await act(async () => render());
  expect(container.querySelector('[data-testid="editor"]')).not.toBeNull();
  sessionState.current = { email: "person@example.com" };
  await act(async () => render());

  expect(container.querySelector(".agent-layout-shell")).not.toBeNull();
  expect(mounts).toBe(1);
});

const APP_CHROME_TEST_IDS = [
  "sidebar",
  "header",
  "mobile-header-actions",
  "agent-sidebar",
];

async function renderEditorRoute(editor: React.ReactNode = <div />) {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={["/design/abc"]}>
        <Layout>{editor}</Layout>
      </MemoryRouter>,
    ),
  );
}

function renderedAppChrome() {
  return APP_CHROME_TEST_IDS.filter((id) =>
    container.querySelector(`[data-testid="${id}"]`),
  );
}

it("renders Design's app chrome for a token embed outside an MCP App widget", async () => {
  sessionState.current = { email: "person@example.com" };
  embedState.token = true;

  await renderEditorRoute();

  expect(renderedAppChrome()).toEqual(
    expect.arrayContaining(["sidebar", "agent-sidebar"]),
  );
  expect(container.querySelector('[aria-label="navigation.openNavigation"]'))
    .not.toBeNull();
});

it("renders only the canvas in an MCP App widget, with no nav, header, or agent sidebar", async () => {
  sessionState.current = { email: "person@example.com" };
  embedState.token = true;
  embedState.mcpAppWidget = true;

  await renderEditorRoute(<div data-testid="editor" />);

  expect(container.querySelector('[data-testid="editor"]')).not.toBeNull();
  expect(renderedAppChrome()).toEqual([]);
  expect(container.querySelector('[aria-label="navigation.openNavigation"]'))
    .toBeNull();
  expect(container.firstElementChild?.className).toContain("h-[100dvh]");
});

it("keeps the design editor mounted when the session resolves inside an MCP App widget", async () => {
  embedState.token = true;
  embedState.mcpAppWidget = true;
  let mounts = 0;
  function Editor() {
    useEffect(() => {
      mounts += 1;
    }, []);
    return <div data-testid="editor" />;
  }

  await renderEditorRoute(<Editor />);
  sessionState.current = { email: "person@example.com" };
  await renderEditorRoute(<Editor />);

  expect(mounts).toBe(1);
  expect(renderedAppChrome()).toEqual([]);
});
