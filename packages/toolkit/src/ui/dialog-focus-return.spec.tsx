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
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTitle,
} from "./alert-dialog.js";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";
import { Sheet, SheetContent, SheetTitle } from "./sheet.js";

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

  it("returns a nested dialog's focus to the parent dialog's control", async () => {
    function Nested() {
      const [outer, setOuter] = React.useState(false);
      const [inner, setInner] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOuter(true)}>
            Open outer
          </button>
          {outer ? (
            <Dialog open onOpenChange={setOuter}>
              <DialogContent>
                <DialogTitle>Outer</DialogTitle>
                <button type="button" onClick={() => setInner(true)}>
                  Open inner
                </button>
                {inner ? (
                  <Dialog open onOpenChange={setInner}>
                    <DialogContent>
                      <DialogTitle>Inner</DialogTitle>
                      <input aria-label="Inner field" autoFocus />
                    </DialogContent>
                  </Dialog>
                ) : null}
              </DialogContent>
            </Dialog>
          ) : null}
        </>
      );
    }
    render(<Nested />);
    const opener = screen.getByRole("button", { name: "Open outer" });
    opener.focus();
    fireEvent.click(opener);
    const innerOpener = await screen.findByRole("button", {
      name: "Open inner",
    });
    innerOpener.focus();
    fireEvent.click(innerOpener);
    const field = await screen.findByLabelText("Inner field");
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByLabelText("Inner field")).toBeNull(),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Open inner" }),
      ),
    );
  });

  it("skips a trigger that unmounted when the nested dialog opened", async () => {
    function Nested() {
      const [outer, setOuter] = React.useState(false);
      const [inner, setInner] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOuter(true)}>
            Open outer
          </button>
          {outer ? (
            <Dialog open onOpenChange={setOuter}>
              <DialogContent>
                <DialogTitle>Outer</DialogTitle>
                <button type="button">Stays</button>
                {inner ? null : (
                  <button type="button" onClick={() => setInner(true)}>
                    Open inner
                  </button>
                )}
                {inner ? (
                  <Dialog open onOpenChange={setInner}>
                    <DialogContent>
                      <DialogTitle>Inner</DialogTitle>
                      <input aria-label="Inner field" autoFocus />
                    </DialogContent>
                  </Dialog>
                ) : null}
              </DialogContent>
            </Dialog>
          ) : null}
        </>
      );
    }
    render(<Nested />);
    const opener = screen.getByRole("button", { name: "Open outer" });
    opener.focus();
    fireEvent.click(opener);
    screen.getByRole("button", { name: "Stays" }).focus();
    const innerOpener = await screen.findByRole("button", {
      name: "Open inner",
    });
    innerOpener.focus();
    fireEvent.click(innerOpener);
    const field = await screen.findByLabelText("Inner field");
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByLabelText("Inner field")).toBeNull(),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Stays" }),
      ),
    );
  });

  it("returns to the clicked opener when the click did not focus it", async () => {
    render(
      <>
        <button type="button">Earlier</button>
        <StateDialog autoFocusField />
      </>,
    );
    screen.getByRole("button", { name: "Earlier" }).focus();
    // no opener.focus(): the click alone opens the dialog, as in browsers
    // that do not focus a button on click
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Invite" }),
      ),
    );
  });

  it("returns to the clicked opener when the dialog has no field to autofocus", async () => {
    render(<StateDialog />);
    // the click alone opens the dialog; focus is still on the body when it mounts
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Invite" }),
      ),
    );
  });

  it("does not return to an old control when code opens a dialog with focus on the body", async () => {
    function Programmatic() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button">Old control</button>
          <button
            type="button"
            data-open
            onFocus={() => undefined}
            onKeyDown={() => undefined}
            ref={(node) => {
              if (node)
                (window as unknown as { openIt?: () => void }).openIt = () =>
                  setOpen(true);
            }}
          >
            x
          </button>
          {open ? (
            <Dialog open onOpenChange={setOpen}>
              <DialogContent>
                <DialogTitle>Opened by code</DialogTitle>
              </DialogContent>
            </Dialog>
          ) : null}
        </>
      );
    }
    vi.useFakeTimers({ toFake: ["Date"] });
    render(<Programmatic />);
    screen.getByRole("button", { name: "Old control" }).focus();
    (document.activeElement as HTMLElement).blur();
    vi.setSystemTime(Date.now() + 10_000);
    act(() => (window as unknown as { openIt: () => void }).openIt());
    await screen.findByRole("dialog");
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).not.toBe(
      screen.getByRole("button", { name: "Old control" }),
    );
    vi.useRealTimers();
  });

  it("does not return to an old control when code opens an autofocus dialog", async () => {
    let openIt: () => void = () => undefined;
    function Programmatic() {
      const [open, setOpen] = React.useState(false);
      openIt = () => setOpen(true);
      return (
        <>
          <button type="button">Old control</button>
          {open ? (
            <Dialog open onOpenChange={setOpen}>
              <DialogContent>
                <DialogTitle>Opened by code</DialogTitle>
                <input aria-label="Field" autoFocus />
              </DialogContent>
            </Dialog>
          ) : null}
        </>
      );
    }
    vi.useFakeTimers({ toFake: ["Date"] });
    render(<Programmatic />);
    screen.getByRole("button", { name: "Old control" }).focus();
    vi.setSystemTime(Date.now() + 10_000);
    act(() => openIt());
    const field = await screen.findByLabelText("Field");
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).not.toBe(
      screen.getByRole("button", { name: "Old control" }),
    );
    vi.useRealTimers();
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

  it.each([0, 5000])(
    "returns to the menu trigger after waiting %i ms in the menu",
    async (elapsed) => {
      const started = Date.now();
      const clock = vi.spyOn(Date, "now").mockReturnValue(started);
      try {
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
        clock.mockReturnValue(started + elapsed);
        fireEvent.click(item);
        const dialog = await screen.findByRole("dialog");
        await waitFor(() =>
          expect(dialog.contains(document.activeElement)).toBe(true),
        );
        vi.useFakeTimers();
        await act(async () => {
          fireEvent.keyDown(document.activeElement ?? dialog, {
            key: "Escape",
          });
          await vi.advanceTimersByTimeAsync(700);
        });
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: "Note actions" }),
        );
      } finally {
        vi.useRealTimers();
        clock.mockRestore();
      }
    },
  );
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

  it("runs a callback ref's returned cleanup instead of calling it with null", async () => {
    const seen: string[] = [];
    const ref = (node: HTMLDivElement | null) => {
      seen.push(node ? "node" : "null");
      return () => seen.push("cleanup");
    };
    const view = render(
      <Dialog open>
        <DialogContent ref={ref}>
          <DialogTitle>Invite people</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    await screen.findByRole("dialog");
    view.rerender(<Dialog open={false} />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(seen).toEqual(["node", "cleanup"]);
  });
});

it("keeps an auto-focused field inside the modal before any keyboard interaction", async () => {
  render(<StateDialog autoFocusField />);
  const opener = screen.getByRole("button", { name: "Invite" });
  opener.focus();
  fireEvent.click(opener);
  const field = await screen.findByLabelText("Email");
  await waitFor(() => expect(document.activeElement).toBe(field));
  opener.focus();
  expect(document.activeElement).toBe(field);
  fireEvent.keyDown(field, { key: "Enter" });
  expect(screen.queryByRole("dialog")).not.toBeNull();
});

it("lets a nested sheet take focus while its parent dialog is paused", async () => {
  function Fixture() {
    const [sheet, setSheet] = React.useState(false);
    return (
      <Dialog open>
        <DialogContent>
          <DialogTitle>Parent</DialogTitle>
          <button onClick={() => setSheet(true)}>Open sheet</button>
          <Sheet open={sheet} onOpenChange={setSheet}>
            <SheetContent>
              <SheetTitle>Details</SheetTitle>
              <input aria-label="Sheet field" autoFocus />
            </SheetContent>
          </Sheet>
        </DialogContent>
      </Dialog>
    );
  }
  render(<Fixture />);
  const opener = await screen.findByRole("button", { name: "Open sheet" });
  await waitFor(() => expect(document.activeElement).toBe(opener));
  fireEvent.click(opener);
  const input = await screen.findByLabelText("Sheet field");
  await waitFor(() => expect(document.activeElement).toBe(input));
});

it("returns a programmatically opened dialog to its native trigger", async () => {
  const previous = document.createElement("button");
  previous.textContent = "Previous control";
  document.body.append(previous);
  previous.focus();
  render(
    <Dialog defaultOpen>
      <DialogTrigger>Open dialog</DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Settings</DialogTitle>
        <input aria-label="Setting" />
      </DialogContent>
    </Dialog>,
  );
  const field = await screen.findByLabelText("Setting");
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Open dialog" }),
  );
});

it("restores a state-driven opener that declares aria-controls without a native trigger", async () => {
  function Fixture() {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <button
          aria-controls="state-driven-dialog"
          onClick={() => setOpen(true)}
        >
          Open accessible dialog
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent id="state-driven-dialog" aria-describedby={undefined}>
            <DialogTitle>Settings</DialogTitle>
            <input aria-label="Accessible setting" />
          </DialogContent>
        </Dialog>
      </>
    );
  }
  render(<Fixture />);
  const opener = screen.getByRole("button", { name: "Open accessible dialog" });
  opener.focus();
  fireEvent.click(opener);
  const field = await screen.findByLabelText("Accessible setting");
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(opener);
});

it("prefers the native trigger when an earlier generic control targets the same dialog", async () => {
  function Fixture() {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <button aria-controls="multiple-openers" onClick={() => setOpen(true)}>
          Generic opener
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger aria-controls="multiple-openers">
            Native opener
          </DialogTrigger>
          <DialogContent id="multiple-openers" aria-describedby={undefined}>
            <DialogTitle>Settings</DialogTitle>
            <input aria-label="Multiple opener setting" />
          </DialogContent>
        </Dialog>
      </>
    );
  }
  render(<Fixture />);
  const opener = screen.getByRole("button", { name: "Native opener" });
  opener.focus();
  fireEvent.click(opener);
  const field = await screen.findByLabelText("Multiple opener setting");
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(opener);
});

it("remembers a clicked state opener when the browser leaves the previous input focused", async () => {
  function Fixture() {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <input aria-label="Previous input" />
        <button onClick={() => setOpen(true)}>State opener</button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Settings</DialogTitle>
            <input aria-label="Clicked opener setting" />
          </DialogContent>
        </Dialog>
      </>
    );
  }
  render(<Fixture />);
  screen.getByLabelText("Previous input").focus();
  const opener = screen.getByRole("button", { name: "State opener" });
  fireEvent.click(opener);
  const field = await screen.findByLabelText("Clicked opener setting");
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(opener);
});
