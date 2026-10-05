// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Layout } from "./Layout";

const sessionState = vi.hoisted(() => ({
  current: null as { email: string } | null,
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSession: () => ({ session: sessionState.current, isLoading: false }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/host", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isEmbedAuthActive: () => false,
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
  AgentSidebar: ({ children }: { children?: unknown }) => children ?? null,
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
  Header: () => null,
  MobileHeaderActions: () => null,
}));
vi.mock("./Sidebar", () => ({ Sidebar: () => null }));

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
