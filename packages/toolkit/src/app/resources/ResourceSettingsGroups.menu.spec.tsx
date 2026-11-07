// @vitest-environment happy-dom

import {
  act,
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

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { DropdownMenuItem } from "@agent-native/toolkit/ui/dropdown-menu";

import { RowMenuTrigger } from "./ResourceSettingsGroups.js";

function RemoveHarness({ onRemove }: { onRemove: () => Promise<void> }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rowVisible, setRowVisible] = useState(true);

  const remove = async () => {
    // Resource tree refresh can unmount the row before the delete promise settles.
    setRowVisible(false);
    await onRemove();
    setConfirmOpen(false);
  };

  return (
    <>
      {rowVisible ? (
        <RowMenuTrigger>
          <DropdownMenuItem onSelect={() => setConfirmOpen(true)}>
            Remove
          </DropdownMenuItem>
        </RowMenuTrigger>
      ) : null}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>Remove skill?</AlertDialogTitle>
          <AlertDialogDescription>
            This action removes the selected skill.
          </AlertDialogDescription>
          <button type="button" onClick={() => void remove()}>
            Confirm removal
          </button>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = "";
});

describe("resource row removal menu", () => {
  it("releases pointer input when a row unmounts before confirmation closes", async () => {
    let finishRemoval: (() => void) | undefined;
    const pendingRemoval = new Promise<void>((resolve) => {
      finishRemoval = resolve;
    });
    render(<RemoveHarness onRemove={() => pendingRemoval} />);

    fireEvent.pointerDown(
      screen.getByRole("button", {
        name: "agentChat.settingsResources.moreActions",
      }),
      { button: 0 },
    );
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Remove" })).toBeTruthy(),
    );
    expect(document.body.style.pointerEvents).not.toBe("none");

    fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", {
          name: "agentChat.settingsResources.moreActions",
        }),
      ).toBeNull(),
    );
    // The row has unmounted but the confirmation is still pending.
    expect(screen.getByRole("alertdialog")).toBeTruthy();

    await act(async () => {
      finishRemoval?.();
      await pendingRemoval;
    });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.body.style.pointerEvents).not.toBe("none");
  });
});
