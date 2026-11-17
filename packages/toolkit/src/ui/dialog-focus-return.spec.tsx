// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTitle,
} from "./alert-dialog.js";
import { Dialog, DialogContent, DialogTitle } from "./dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function StateDialog({
  autoFocusField = false,
  onCloseAutoFocus,
}: {
  autoFocusField?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Invite
      </button>
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
            <DialogTitle>Invite people</DialogTitle>
            <input aria-label="Email" autoFocus={autoFocusField} />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

async function openThenEscape(name: string) {
  const opener = screen.getByRole("button", { name });
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole("dialog");
  await waitFor(() =>
    expect(dialog.contains(document.activeElement)).toBe(true),
  );
  fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

describe("a dialog opened without a trigger returns focus to its opener", () => {
  it("focuses the button that opened it after Escape", async () => {
    render(<StateDialog />);
    await openThenEscape("Invite");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Invite" }),
      ),
    );
  });

  it("finds the opener when a field inside took focus as the dialog mounted", async () => {
    render(<StateDialog autoFocusField />);
    await openThenEscape("Invite");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Invite" }),
      ),
    );
  });

  it("leaves focus where a caller that prevents the default put it", async () => {
    render(
      <>
        <button type="button">Elsewhere</button>
        <StateDialog
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            screen.getByRole("button", { name: "Elsewhere" }).focus();
          }}
        />
      </>,
    );
    await openThenEscape("Invite");
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Elsewhere" }),
    );
  });

  it("returns an alert dialog to its opener on Cancel", async () => {
    function Confirm() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Move to trash
          </button>
          <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogContent>
              <AlertDialogTitle>Delete?</AlertDialogTitle>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
            </AlertDialogContent>
          </AlertDialog>
        </>
      );
    }
    render(<Confirm />);
    const opener = screen.getByRole("button", { name: "Move to trash" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Move to trash" }),
      ),
    );
  });

  it("clears an uncontrolled alert dialog's body lock after it closes", async () => {
    render(
      <AlertDialog defaultOpen>
        <AlertDialogContent>
          <AlertDialogTitle>Delete?</AlertDialogTitle>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    // a menu's late cleanup can write the lock back after the dialog closed
    document.body.style.pointerEvents = "none";
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));
    expect(document.body.style.pointerEvents).toBe("");
  });

  it("focuses the menu's trigger when a menu item opened it", async () => {
    function MenuDialog() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger>Note actions</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => setOpen(true)}>
                Send notes via email
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {open ? (
            <Dialog open onOpenChange={setOpen}>
              <DialogContent>
                <DialogTitle>Send notes via email</DialogTitle>
                <input aria-label="To" />
              </DialogContent>
            </Dialog>
          ) : null}
        </>
      );
    }
    render(<MenuDialog />);
    const trigger = screen.getByRole("button", { name: "Note actions" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    const item = await screen.findByRole("menuitem", {
      name: "Send notes via email",
    });
    fireEvent.click(item);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // the stale-focus cleanup runs up to 600 ms after close; focus must survive it
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Note actions" }),
    );
  });
});

describe("DialogContent ref forwarding", () => {
  it("hands the content node to a callback ref that changes between renders", async () => {
    const seen: Array<string | null> = [];
    const first = (node: HTMLDivElement | null) =>
      seen.push(node ? "first:node" : "first:null");
    const second = (node: HTMLDivElement | null) =>
      seen.push(node ? "second:node" : "second:null");
    const view = render(
      <Dialog open>
        <DialogContent ref={first}>
          <DialogTitle>Invite people</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    await screen.findByRole("dialog");
    view.rerender(
      <Dialog open>
        <DialogContent ref={second}>
          <DialogTitle>Invite people</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    expect(seen).toEqual(["first:node", "first:null", "second:node"]);
  });
});
