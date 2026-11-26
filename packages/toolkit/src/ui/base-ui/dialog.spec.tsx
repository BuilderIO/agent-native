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

import { useInModalLayer } from "../modal-layer.js";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogBackdrop,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "./dialog.js";
import { OverlayScope } from "./overlay-scope.js";

function press(element: Element) {
  fireEvent.pointerDown(element, { pointerType: "mouse", button: 0 });
  fireEvent.mouseDown(element, { button: 0 });
  fireEvent.pointerUp(element, { pointerType: "mouse", button: 0 });
  fireEvent.mouseUp(element, { button: 0 });
  fireEvent.click(element, { button: 0 });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const settle = (ms = 20) =>
  act(() => new Promise((resolve) => setTimeout(resolve, ms)));

// oracle-change(packages/toolkit/src/ui/dialog-body-lock.test.tsx): Radix left stale body pointer-lock and scroll-lock that the old dialog cleared; Base UI dialogs set neither
// oracle-change(packages/toolkit/src/ui/dialog-focus-controls.spec.tsx): the stale focus release for closed Radix layers is gone with Radix's focus scope; focus placement is covered by the focus tests below
// oracle-change(packages/toolkit/src/ui/dialog-focus-return.spec.tsx): opener lookup for trigger-less Radix dialogs is gone; Base UI returns focus through finalFocus, covered by the focus tests below
// oracle-change(packages/toolkit/src/ui/dialog.spec.tsx): overlay motion now reaches the backdrop as data-motion, covered by the motion test below
describe("dialog parts", () => {
  it("renders the catalog classes and Base UI's state attributes", async () => {
    render(
      <Dialog open>
        <DialogPopup data-testid="popup" backdropClassName="extra-overlay">
          <DialogHeader data-testid="header">
            <DialogTitle>Rename</DialogTitle>
            <DialogDescription>Pick a new name.</DialogDescription>
          </DialogHeader>
          <DialogFooter data-testid="footer" />
        </DialogPopup>
      </Dialog>,
    );
    const popup = await screen.findByTestId("popup");
    expect(popup.getAttribute("role")).toBe("dialog");
    expect(popup.classList.contains("dialog-popup")).toBe(true);
    expect(popup.hasAttribute("data-open")).toBe(true);
    expect(popup.hasAttribute("data-state")).toBe(false);
    expect(popup.dataset.motion).toBe("default");
    expect(screen.getByTestId("header").className).toBe("dialog-header");
    expect(screen.getByTestId("footer").className).toBe("dialog-footer");
    expect(screen.getByText("Rename").className).toBe("dialog-title");
    expect(screen.getByText("Pick a new name.").className).toBe(
      "dialog-description",
    );
    const backdrop = document.querySelector(".dialog-backdrop");
    expect(backdrop?.classList.contains("extra-overlay")).toBe(true);
    expect(backdrop?.hasAttribute("data-open")).toBe(true);
    expect(popup.getAttribute("aria-labelledby")).toBe(
      screen.getByText("Rename").id,
    );
  });

  it("passes motion to the backdrop and popup", async () => {
    render(
      <Dialog open>
        <DialogPopup
          data-testid="popup"
          motion="instant"
          backdropClassName={({ open }) => (open ? "dimmed" : undefined)}
          backdropStyle={({ open }) => ({ opacity: open ? 0.5 : 0 })}
        >
          <DialogTitle>Instant</DialogTitle>
        </DialogPopup>
      </Dialog>,
    );
    const popup = await screen.findByTestId("popup");
    const backdrop = document.querySelector<HTMLElement>(".dialog-backdrop");
    expect(popup.dataset.motion).toBe("instant");
    expect(backdrop?.dataset.motion).toBe("instant");
    expect(backdrop?.classList.contains("dimmed")).toBe(true);
    expect(backdrop?.style.opacity).toBe("0.5");
  });

  it("names the close button, disables it, or leaves it out", async () => {
    const { rerender } = render(
      <Dialog open>
        <DialogPopup closeLabel="Dismiss">
          <DialogTitle>Close</DialogTitle>
        </DialogPopup>
      </Dialog>,
    );
    const close = await screen.findByRole("button", { name: "Dismiss" });
    expect(close.classList.contains("dialog-close")).toBe(true);
    expect((close as HTMLButtonElement).disabled).toBe(false);
    rerender(
      <Dialog open>
        <DialogPopup closeDisabled>
          <DialogTitle>Close</DialogTitle>
        </DialogPopup>
      </Dialog>,
    );
    expect(
      (screen.getByRole("button", { name: "Close" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    rerender(
      <Dialog open>
        <DialogPopup showClose={false}>
          <DialogTitle>Close</DialogTitle>
        </DialogPopup>
      </Dialog>,
    );
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("supports a standalone portal and overlay", async () => {
    render(
      <Dialog open>
        <DialogPortal>
          <DialogBackdrop data-testid="overlay" motion="instant" />
        </DialogPortal>
      </Dialog>,
    );
    const overlay = await screen.findByTestId("overlay");
    expect(overlay.classList.contains("dialog-backdrop")).toBe(true);
    expect(overlay.dataset.motion).toBe("instant");
  });

  it.each(["explicit", "scope"] as const)(
    "resolves a same-commit %s container ref before mounting its children",
    async (source) => {
      const container = React.createRef<HTMLDivElement>();
      const hosts: (HTMLElement | null)[] = [];
      render(
        <div data-testid="host" ref={container}>
          <OverlayScope container={source === "scope" ? container : undefined}>
            <Dialog defaultOpen>
              <DialogPopup
                container={source === "explicit" ? container : undefined}
                aria-describedby={undefined}
              >
                <DialogTitle
                  ref={(node) => {
                    if (node) hosts.push(node.closest('[data-testid="host"]'));
                  }}
                >
                  Settings
                </DialogTitle>
              </DialogPopup>
            </Dialog>
          </OverlayScope>
        </div>,
      );
      const popup = await screen.findByRole("dialog", { name: "Settings" });
      expect(container.current?.contains(popup)).toBe(true);
      expect(hosts.length).toBeGreaterThan(0);
      expect(hosts.every((host) => host === container.current)).toBe(true);
    },
  );

  it("waits for an explicitly null mount point and honors its target above the enclosing scope", async () => {
    const scope = document.body.appendChild(document.createElement("div"));
    const external = document.body.appendChild(document.createElement("div"));
    const dialog = (container: HTMLElement | null) => (
      <OverlayScope container={scope}>
        <Dialog open>
          <DialogPopup container={container} aria-describedby={undefined}>
            <DialogTitle>Frame settings</DialogTitle>
          </DialogPopup>
        </Dialog>
      </OverlayScope>
    );
    const { rerender } = render(dialog(null));
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(dialog(external));
    expect(external.contains(await screen.findByRole("dialog"))).toBe(true);
    expect(scope.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the popup in the page while closed with keepMounted", async () => {
    render(
      <Dialog open={false}>
        <DialogPopup keepMounted data-testid="popup">
          <DialogTitle>Kept</DialogTitle>
        </DialogPopup>
      </Dialog>,
    );
    const popup = await screen.findByTestId("popup", undefined, {
      timeout: 1000,
    });
    expect(popup.hasAttribute("data-closed")).toBe(true);
  });

  it("forwards its ref to the popup", async () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <Dialog open>
        <DialogPopup ref={ref}>
          <DialogTitle>Ref</DialogTitle>
        </DialogPopup>
      </Dialog>,
    );
    await screen.findByRole("dialog");
    expect(ref.current).toBe(screen.getByRole("dialog"));
  });

  it("tells its children they are in a modal layer", async () => {
    function Probe() {
      return <span>{useInModalLayer() ? "modal" : "page"}</span>;
    }
    render(
      <Dialog open>
        <DialogPopup>
          <DialogTitle>Layer</DialogTitle>
          <Probe />
        </DialogPopup>
      </Dialog>,
    );
    expect(await screen.findByText("modal")).toBeTruthy();
  });
});

describe("opening and closing", () => {
  it("opens from a trigger and closes from a close, both composed with render", async () => {
    render(
      <Dialog>
        <DialogTrigger render={<button type="button">Open it</button>} />
        <DialogPopup showClose={false}>
          <DialogTitle>Opened</DialogTitle>
          <DialogClose render={<button type="button">Done</button>} />
        </DialogPopup>
      </Dialog>,
    );
    const trigger = screen.getByRole("button", { name: "Open it" });
    expect(trigger.tagName).toBe("BUTTON");
    press(trigger);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    press(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("reports why it asked to close, and stays open when the handler cancels", async () => {
    const reasons: string[] = [];
    function Controlled() {
      const [open, setOpen] = React.useState(true);
      return (
        <Dialog
          open={open}
          onOpenChange={(next, details) => {
            reasons.push(details.reason);
            if (details.reason === "escape-key") {
              details.cancel();
              return;
            }
            setOpen(next);
          }}
        >
          <DialogPopup>
            <DialogTitle>Guarded</DialogTitle>
          </DialogPopup>
        </Dialog>
      );
    }
    render(<Controlled />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    await settle();
    expect(reasons).toContain("escape-key");
    expect(screen.queryByRole("dialog")).not.toBeNull();
    press(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(reasons).toContain("close-press");
  });

  it("closes on an outside press unless the handler cancels it", async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog
        defaultOpen
        onOpenChange={(open, details) => {
          onOpenChange(open, details.reason);
          if (details.reason === "outside-press") details.cancel();
        }}
      >
        <DialogPopup>
          <DialogTitle>Pinned</DialogTitle>
        </DialogPopup>
      </Dialog>,
    );
    await screen.findByRole("dialog");
    const backdrop = document.querySelector(".dialog-backdrop");
    if (!backdrop) throw new Error("no backdrop");
    press(backdrop);
    await settle();
    expect(onOpenChange).toHaveBeenCalledWith(false, "outside-press");
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });
});

describe("focus", () => {
  it("moves focus to the element initialFocus names", async () => {
    function Chosen() {
      const field = React.useRef<HTMLInputElement>(null);
      return (
        <Dialog open>
          <DialogPopup initialFocus={field}>
            <DialogTitle>Pick</DialogTitle>
            <button type="button">first</button>
            <input ref={field} aria-label="Second" />
          </DialogPopup>
        </Dialog>
      );
    }
    render(<Chosen />);
    const field = await screen.findByLabelText("Second");
    await waitFor(() => expect(document.activeElement).toBe(field));
  });

  it("returns focus to the button that opened it from state", async () => {
    function StateDialog() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Invite
          </button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogPopup>
              <DialogTitle>Invite people</DialogTitle>
              <input aria-label="Email" />
            </DialogPopup>
          </Dialog>
        </>
      );
    }
    render(<StateDialog />);
    const opener = screen.getByRole("button", { name: "Invite" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("returns focus to the element finalFocus names", async () => {
    function Elsewhere() {
      const target = React.useRef<HTMLButtonElement>(null);
      const [open, setOpen] = React.useState(true);
      return (
        <>
          <button type="button" ref={target}>
            Landing
          </button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogPopup finalFocus={target}>
              <DialogTitle>Elsewhere</DialogTitle>
            </DialogPopup>
          </Dialog>
        </>
      );
    }
    render(<Elsewhere />);
    await screen.findByRole("dialog");
    press(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Landing" }),
      ),
    );
  });
});
