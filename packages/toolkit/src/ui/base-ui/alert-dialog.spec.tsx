// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogPopup,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog.js";

function press(element: Element) {
  fireEvent.pointerDown(element, { pointerType: "mouse", button: 0 });
  fireEvent.mouseDown(element, { button: 0 });
  fireEvent.pointerUp(element, { pointerType: "mouse", button: 0 });
  fireEvent.mouseUp(element, { button: 0 });
  fireEvent.click(element, { button: 0 });
}

const settle = (ms = 20) =>
  act(() => new Promise((resolve) => setTimeout(resolve, ms)));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function Confirm({
  onOpenChange,
}: {
  onOpenChange?: (open: boolean, reason: string) => void;
}) {
  return (
    <AlertDialog
      onOpenChange={(open, details) => onOpenChange?.(open, details.reason)}
    >
      <AlertDialogTrigger render={<button type="button">Delete</button>} />
      <AlertDialogPopup data-testid="popup" backdropClassName="extra-overlay">
        <AlertDialogHeader data-testid="header">
          <AlertDialogTitle>Delete project</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter data-testid="footer">
          <AlertDialogCancel>Keep</AlertDialogCancel>
          <AlertDialogAction color="danger">Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

describe("alert dialog part", () => {
  it("renders the catalog classes on an alertdialog", async () => {
    render(<Confirm />);
    press(screen.getByRole("button", { name: "Delete" }));
    const popup = await screen.findByRole("alertdialog");
    expect(popup.classList.contains("alert-dialog-popup")).toBe(true);
    expect(popup.hasAttribute("data-open")).toBe(true);
    expect(screen.getByTestId("header").className).toBe("alert-dialog-header");
    expect(screen.getByTestId("footer").className).toBe("alert-dialog-footer");
    expect(screen.getByText("Delete project").className).toBe(
      "alert-dialog-title",
    );
    expect(screen.getByText("This cannot be undone.").className).toBe(
      "alert-dialog-description",
    );
    expect(
      document
        .querySelector(".alert-dialog-backdrop")
        ?.classList.contains("extra-overlay"),
    ).toBe(true);
  });

  it("resolves both backdrop customizations against the current dialog state", async () => {
    const view = (open: boolean) => (
      <AlertDialog open={open}>
        <AlertDialogPopup
          keepMounted
          className={(state) => (state.open ? "pane-open" : "pane-closed")}
          backdropProps={{
            className: ({ open }) => (open ? "base-open" : "base-closed"),
            style: ({ open }) => ({ opacity: open ? 0.8 : 0, zIndex: 10 }),
          }}
          backdropClassName={({ open }) => (open ? "overlay-open" : undefined)}
          backdropStyle={{ zIndex: 20 }}
        >
          <AlertDialogTitle>Delete project</AlertDialogTitle>
        </AlertDialogPopup>
      </AlertDialog>
    );
    const { rerender } = render(view(true));
    const popup = await screen.findByRole("alertdialog");
    const backdrop = document.querySelector<HTMLElement>(
      ".alert-dialog-backdrop",
    );
    expect(popup.classList.contains("pane-open")).toBe(true);
    expect(backdrop?.classList.contains("base-open")).toBe(true);
    expect(backdrop?.classList.contains("overlay-open")).toBe(true);
    expect(backdrop?.style.opacity).toBe("0.8");
    expect(backdrop?.style.zIndex).toBe("20");
    rerender(view(false));
    expect(popup.classList.contains("pane-closed")).toBe(true);
    expect(backdrop?.classList.contains("base-closed")).toBe(true);
    expect(backdrop?.classList.contains("overlay-open")).toBe(false);
    expect(backdrop?.style.opacity).toBe("0");
  });

  it("draws Action as a solid button and Cancel as a gray surface button", async () => {
    render(<Confirm />);
    press(screen.getByRole("button", { name: "Delete" }));
    const action = await screen.findByRole("button", { name: "Remove" });
    const cancel = screen.getByRole("button", { name: "Keep" });
    expect(action.classList.contains("button")).toBe(true);
    expect(action.dataset).toMatchObject({
      size: "md",
      variant: "solid",
      color: "danger",
    });
    expect(cancel.classList.contains("button")).toBe(true);
    expect(cancel.dataset).toMatchObject({
      size: "md",
      variant: "surface",
      color: "gray",
    });
  });

  it("renders Action as a link and still closes", async () => {
    const onOpenChange = vi.fn();
    render(
      <AlertDialog
        defaultOpen
        onOpenChange={(open, details) => onOpenChange(open, details.reason)}
      >
        <AlertDialogPopup>
          <AlertDialogTitle>Upgrade</AlertDialogTitle>
          <AlertDialogAction
            nativeButton={false}
            render={<a href="#upgrade">Upgrade plan</a>}
          />
        </AlertDialogPopup>
      </AlertDialog>,
    );
    const link = await screen.findByRole("button", { name: "Upgrade plan" });
    expect(link.tagName).toBe("A");
    expect(link.classList.contains("button")).toBe(true);
    press(link);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onOpenChange).toHaveBeenLastCalledWith(false, "close-press");
  });

  it("closes from Action and Cancel with the close-press reason", async () => {
    const onOpenChange = vi.fn();
    render(<Confirm onOpenChange={onOpenChange} />);
    press(screen.getByRole("button", { name: "Delete" }));
    press(await screen.findByRole("button", { name: "Keep" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onOpenChange).toHaveBeenLastCalledWith(false, "close-press");
    press(screen.getByRole("button", { name: "Delete" }));
    press(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("stays open on an outside press", async () => {
    render(<Confirm />);
    press(screen.getByRole("button", { name: "Delete" }));
    await screen.findByRole("alertdialog");
    const backdrop = document.querySelector(".alert-dialog-backdrop");
    if (!backdrop) throw new Error("no backdrop");
    press(backdrop);
    await settle();
    expect(screen.queryByRole("alertdialog")).not.toBeNull();
  });

  it("closes on Escape and says so", async () => {
    const onOpenChange = vi.fn();
    render(<Confirm onOpenChange={onOpenChange} />);
    press(screen.getByRole("button", { name: "Delete" }));
    const popup = await screen.findByRole("alertdialog");
    fireEvent.keyDown(document.activeElement ?? popup, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onOpenChange).toHaveBeenLastCalledWith(false, "escape-key");
  });
});
