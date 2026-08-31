// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useDecksMock } = vi.hoisted(() => ({ useDecksMock: vi.fn() }));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  AgentSidebar: ({ children }: { children: ReactNode }) => (
    <div data-testid="agent-sidebar">{children}</div>
  ),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/org", () => ({
  InvitationBanner: () => <div data-testid="invitation-banner" />,
}));
vi.mock("@agent-native/creative-context/client", () => ({
  CreativeContextComposerChip: () => null,
}));
vi.mock("@agent-native/toolkit/app-shell", () => ({
  HeaderActionsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@shared/google-docs", () => ({
  extractGoogleSlidesUrls: () => [],
}));
vi.mock("@tabler/icons-react", () => ({
  IconMenu2: () => <span data-testid="menu-icon" />,
}));
vi.mock("@/context/DeckContext", () => ({ useDecks: useDecksMock }));
vi.mock("@/hooks/use-sidebar-collapsed", () => ({
  useSidebarCollapsed: () => ({ collapsed: false, setCollapsed: vi.fn() }),
}));
vi.mock("@/lib/slide-agent-context", () => ({
  hasCurrentSlideSelection: () => false,
  readPublishedSlidesSelection: () => null,
  SLIDES_SELECTION_CHANGED_EVENT: "slides-selection-changed",
}));
vi.mock("@/lib/tab-id", () => ({ TAB_ID: "slides-test" }));
vi.mock("@/lib/utils", () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));
vi.mock("../editor/GoogleDriveConnectionCta", () => ({
  GoogleDriveConnectionCta: () => null,
}));
vi.mock("./AgentWorkIndicator", () => ({
  AgentWorkIndicator: () => null,
}));
vi.mock("./Header", () => ({ Header: () => <div data-testid="header" /> }));
vi.mock("./Sidebar", () => ({
  Sidebar: () => <aside data-testid="app-sidebar" />,
}));

import { Layout } from "./Layout";

afterEach(() => cleanup());

function renderLayout(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Layout>
        <div data-testid="page-content">Content</div>
      </Layout>
    </MemoryRouter>,
  );
}

describe("Slides Layout", () => {
  beforeEach(() => {
    useDecksMock.mockReturnValue({ decks: [], loading: false });
  });

  it("keeps the app shell visible on the empty root route", () => {
    renderLayout("/");

    expect(screen.getByTestId("app-sidebar")).toBeTruthy();
    expect(screen.getByTestId("header")).toBeTruthy();
    expect(screen.getByTestId("invitation-banner")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "sidebar.openNavigation" }),
    ).toBeTruthy();
    expect(screen.getByTestId("page-content")).toBeTruthy();
  });

  it("preserves the deck route toolbar boundary", () => {
    renderLayout("/deck/deck-1");

    expect(screen.queryByTestId("app-sidebar")).toBeNull();
    expect(screen.queryByTestId("header")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "sidebar.openNavigation" }),
    ).toBeNull();
    expect(screen.getByTestId("page-content")).toBeTruthy();
  });
});
