// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Drawer,
  DrawerClose,
  DrawerPopup,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  type DrawerProps,
} from "./drawer.js";

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

describe("drawer side", () => {
  it.each([
    ["right", "right"],
    ["left", "left"],
    ["top", "up"],
    ["bottom", "down"],
  ] as const)("anchors side=%s by swiping %s", async (side, swipeDirection) => {
    render(
      <Drawer open side={side}>
        <DrawerPopup
          data-testid="drawer"
          aria-describedby={undefined}
          className={({ open }) => (open ? "panel-open" : undefined)}
        >
          <DrawerTitle>History</DrawerTitle>
        </DrawerPopup>
      </Drawer>,
    );
    const drawer = await screen.findByTestId("drawer");
    expect(drawer.dataset.swipeDirection).toBe(swipeDirection);
    expect(drawer.dataset.side).toBe(side);
    expect(drawer.classList.contains("panel-open")).toBe(true);
    expect(drawer.classList.contains("drawer-popup")).toBe(true);
    expect(drawer.hasAttribute("data-open")).toBe(true);
    expect(drawer.hasAttribute("data-state")).toBe(false);
  });

  it("refuses a side it doesn't have", () => {
    const props = { side: "center" } as unknown as DrawerProps;
    expect(() => render(<Drawer open {...props} />)).toThrow(
      /side="center" is not one of/,
    );
  });

  it("is a bottom drawer by default, with a handle and no close button", async () => {
    render(
      <Drawer>
        <DrawerTrigger render={<button type="button">Open drawer</button>} />
        <DrawerPopup data-testid="drawer">
          <DrawerHeader data-testid="header">
            <DrawerTitle>Move</DrawerTitle>
            <DrawerDescription>Pick a folder.</DrawerDescription>
          </DrawerHeader>
          <DrawerFooter data-testid="footer" />
        </DrawerPopup>
      </Drawer>,
    );
    press(screen.getByRole("button", { name: "Open drawer" }));
    const drawer = await screen.findByTestId("drawer");
    expect(drawer.dataset.side).toBe("bottom");
    expect(drawer.dataset.swipeDirection).toBe("down");
    expect(drawer.querySelector(".drawer-handle")).not.toBeNull();
    expect(drawer.querySelector(".drawer-close")).toBeNull();
    expect(screen.getByTestId("header").className).toBe("drawer-header");
    expect(screen.getByTestId("footer").className).toBe("drawer-footer");
  });

  it("is a panel with a close button and no handle on the other sides", async () => {
    render(
      <Drawer open side="right">
        <DrawerPopup data-testid="drawer" aria-describedby={undefined}>
          <DrawerTitle>History</DrawerTitle>
        </DrawerPopup>
      </Drawer>,
    );
    const drawer = await screen.findByTestId("drawer");
    expect(drawer.querySelector(".drawer-handle")).toBeNull();
    expect(screen.getByRole("button", { name: "Close" }).className).toContain(
      "drawer-close",
    );
  });
});

describe("drawer content", () => {
  it("renders the part's layers, close button and content wrapper", async () => {
    render(
      <Drawer open side="left">
        <DrawerPopup
          data-testid="drawer"
          backdropClassName="extra-overlay"
          closeLabel="Dismiss"
        >
          <DrawerTitle>History</DrawerTitle>
          <DrawerDescription>Past edits.</DrawerDescription>
        </DrawerPopup>
      </Drawer>,
    );
    const drawer = await screen.findByTestId("drawer");
    expect(drawer.closest(".drawer-viewport")).not.toBeNull();
    const backdrop = document.querySelector(".drawer-backdrop");
    expect(backdrop?.classList.contains("extra-overlay")).toBe(true);
    expect(screen.getByText("History").className).toBe("drawer-title");
    expect(screen.getByText("Past edits.").className).toBe(
      "drawer-description",
    );
    expect(screen.getByRole("button", { name: "Dismiss" }).className).toContain(
      "drawer-close",
    );
    expect(drawer.querySelector(".drawer-content")).not.toBeNull();
  });

  it("leaves the overlay out, and the close button when asked", async () => {
    render(
      <Drawer open side="right">
        <DrawerPopup data-testid="drawer" showOverlay={false} showClose={false}>
          <DrawerTitle>Bare</DrawerTitle>
        </DrawerPopup>
      </Drawer>,
    );
    await screen.findByTestId("drawer");
    expect(document.querySelector(".drawer-backdrop")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("can add a close button to a bottom drawer", async () => {
    render(
      <Drawer open>
        <DrawerPopup data-testid="drawer" showClose>
          <DrawerTitle>Closable</DrawerTitle>
        </DrawerPopup>
      </Drawer>,
    );
    await screen.findByTestId("drawer");
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("opens from a trigger and closes from a close, both composed with render", async () => {
    render(
      <Drawer side="right">
        <DrawerTrigger render={<button type="button">Open it</button>} />
        <DrawerPopup showClose={false} aria-describedby={undefined}>
          <DrawerTitle>Opened</DrawerTitle>
          <DrawerClose render={<button type="button">Done</button>} />
        </DrawerPopup>
      </Drawer>,
    );
    press(screen.getByRole("button", { name: "Open it" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    press(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("reports the dismissal reason", async () => {
    const reasons: string[] = [];
    render(
      <Drawer
        defaultOpen
        side="right"
        onOpenChange={(_open, details) => {
          reasons.push(details.reason);
        }}
      >
        <DrawerPopup aria-describedby={undefined}>
          <DrawerTitle>Reasons</DrawerTitle>
        </DrawerPopup>
      </Drawer>,
    );
    press(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(reasons).toEqual(["close-press"]);
  });
});
