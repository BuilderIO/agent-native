// @vitest-environment happy-dom

import type { SharedDeckResponse } from "@shared/api";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  actionQuery: vi.fn(),
  session: { email: "viewer@example.com" } as { email: string } | null,
  accessStatus: {
    exists: true,
    hasAccess: false,
    signedIn: true,
    viewerEmail: "viewer@example.com",
    viewerName: null,
    role: null,
    visibility: "private",
  },
  mutate: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (...args: unknown[]) => {
    mocks.actionQuery(...args);
    return mocks.query;
  },
  useSession: () => ({ session: mocks.session, isLoading: false }),
  signOut: vi.fn(),
  actionErrorMessage: () => null,
}));

vi.mock("@/hooks/use-deck-access", () => ({
  useDeckAccessStatus: () => ({
    data: mocks.accessStatus,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useRequestDeckAccess: () => ({
    mutate: mocks.mutate,
    isPending: false,
    isError: false,
    isSuccess: false,
    reset: vi.fn(),
  }),
}));

vi.mock("@agent-native/toolkit/app/shared", () => ({
  AgentNativeIcon: () => null,
}));

vi.mock("@/hooks/use-deck-design-system", () => ({
  mergeDesignSystemData: (data: unknown) => ({ merged: data }),
}));

vi.mock("@/components/presentation/PresentationView", () => ({
  default: (props: {
    slides: Array<{ id: string }>;
    designSystem?: unknown;
  }) => (
    <div data-testid="presentation">
      {props.slides.map((slide) => slide.id).join(",")}|
      {JSON.stringify(props.designSystem ?? null)}
    </div>
  ),
}));

import { PresentationLinkDeck } from "./SharedPresentation";

function deck(slideId: string): SharedDeckResponse {
  return {
    title: "Launch review",
    slides: [{ id: slideId, content: "", notes: "", layout: "content" }],
    designSystem: { colors: { primary: "#123456" } } as never,
  } as SharedDeckResponse;
}

function renderLink(agentAccessToken?: string) {
  return render(
    <MemoryRouter initialEntries={["/p/deck-1"]}>
      <PresentationLinkDeck
        deckId="deck-1"
        {...(agentAccessToken ? { agentAccessToken } : {})}
      />
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());

describe("<PresentationLinkDeck>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { email: "viewer@example.com" };
  });

  it("reads the deck through the action, passing an agent link's token", () => {
    mocks.query = { data: { status: "ok", deck: deck("slide-1") } };
    renderLink("tok");

    expect(mocks.actionQuery).toHaveBeenCalledWith(
      "get-presentation-deck",
      { deckId: "deck-1", agentAccessToken: "tok" },
      expect.objectContaining({ retry: false }),
    );
  });

  it("presents on brand with the deck's design system", () => {
    mocks.query = { data: { status: "ok", deck: deck("slide-1") } };
    renderLink();

    expect(screen.getByTestId("presentation").textContent).toContain(
      '{"merged":{"colors":{"primary":"#123456"}}}',
    );
  });

  it("shows a refetched deck in place of the one first loaded", () => {
    mocks.query = { data: { status: "ok", deck: deck("slide-1") } };
    const view = renderLink();
    mocks.query = { data: { status: "ok", deck: deck("slide-2") } };
    view.rerender(
      <MemoryRouter initialEntries={["/p/deck-1"]}>
        <PresentationLinkDeck deckId="deck-1" />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("presentation").textContent).toContain("slide-2");
  });

  it("asks to view when a signed-in visitor cannot open the deck", () => {
    mocks.query = { data: { status: "restricted" } };
    renderLink();

    fireEvent.click(
      screen.getByRole("button", { name: "deckEditor.requestAccess" }),
    );

    expect(mocks.mutate).toHaveBeenCalledWith(
      { deckId: "deck-1", role: "viewer" },
      expect.any(Object),
    );
  });
});
