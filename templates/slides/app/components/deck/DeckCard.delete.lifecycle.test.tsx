// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  IconCheck: () => <span />,
  IconChevronRight: () => <span />,
  IconCircle: () => <span />,
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

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

function DeleteHarness() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <DeckCard
        deck={deck}
        onDelete={() => setDialogOpen(true)}
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onToggleStar={vi.fn()}
      />
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete deck?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone.
          </AlertDialogDescription>
          <AlertDialogAction onClick={() => setDialogOpen(false)}>
            Delete
          </AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = "";
});

describe("DeckCard delete lifecycle", () => {
  it("does not leave the page inert when the confirmation dialog opens", async () => {
    render(<DeleteHarness />);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "raw.deckOptions" }),
      { button: 0 },
    );
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.body.style.pointerEvents).not.toBe("none");
  });
});
