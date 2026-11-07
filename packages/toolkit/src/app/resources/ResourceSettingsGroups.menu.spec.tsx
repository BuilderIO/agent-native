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

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { DropdownMenuItem } from "@agent-native/toolkit/ui/dropdown-menu";

import { RowMenuTrigger } from "./ResourceSettingsGroups.js";

function RemoveHarness() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removed, setRemoved] = useState(false);

  return (
    <>
      {!removed ? (
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
          <button
            type="button"
            onClick={() => {
              setRemoved(true);
              setConfirmOpen(false);
            }}
          >
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
  it("releases page pointer input after removing the row", async () => {
    render(<RemoveHarness />);

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
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.body.style.pointerEvents).not.toBe("none");
  });
});
