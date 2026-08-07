// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  closeAutoFocus: null as
    | ((event: { preventDefault: () => void }) => void)
    | null,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/creative-context/client", () => ({
  CreativeContextShareSheet: () => null,
}));

vi.mock("@agent-native/toolkit/sharing", () => ({
  VisibilityBadge: () => null,
}));

vi.mock("@tabler/icons-react", () => ({
  IconBuildingCommunity: () => <span />,
  IconCopy: () => <span />,
  IconDots: () => <span />,
  IconPalette: () => <span />,
  IconPencil: () => <span />,
  IconPlus: () => <span />,
  IconStar: () => <span />,
  IconStarFilled: () => <span />,
  IconTrash: () => <span />,
}));

vi.mock("react-router", () => ({
  Link: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("@/lib/deck-preview-frame", () => ({
  getDeckListingPreviewFrameStyle: () => ({}),
}));

vi.mock("./SlideRenderer", () => ({
  default: () => <div />,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({
    children,
    onCloseAutoFocus,
  }: {
    children: React.ReactNode;
    onCloseAutoFocus?: (event: { preventDefault: () => void }) => void;
  }) => {
    mocks.closeAutoFocus = onCloseAutoFocus ?? null;
    return <div>{children}</div>;
  },
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: (event: { preventDefault: () => void }) => void;
  }) => (
    <button type="button" onClick={(event) => onSelect?.(event)}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import { type Deck } from "@/context/DeckContext";

import DeckCard from "./DeckCard";

const deck: Deck = {
  id: "deck-1",
  title: "Test deck",
  createdAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:00.000Z",
  slides: [
    {
      id: "slide-1",
      content: "<div />",
      notes: "",
      layout: "blank",
    },
  ],
};

afterEach(() => {
  cleanup();
  mocks.closeAutoFocus = null;
  vi.useRealTimers();
});

describe("DeckCard delete flow", () => {
  it("waits for the menu close lifecycle before requesting deletion", async () => {
    const onDelete = vi.fn();

    render(
      <DeckCard
        deck={deck}
        onDelete={onDelete}
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onToggleStar={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(mocks.closeAutoFocus).not.toBeNull();

    const closeEvent = { preventDefault: vi.fn() };
    mocks.closeAutoFocus?.(closeEvent);
    expect(closeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(onDelete).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledWith("deck-1");
  });
});
