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

import { Button } from "./button.js";
import {
  Popover,
  PopoverPopup,
  PopoverDescription,
  PopoverArrow,
  PopoverTitle,
  PopoverTrigger,
} from "./popover.js";

afterEach(cleanup);

function press(element: Element) {
  fireEvent.pointerDown(element, { pointerType: "mouse", button: 0 });
  fireEvent.mouseDown(element, { button: 0 });
  fireEvent.pointerUp(element, { pointerType: "mouse", button: 0 });
  fireEvent.mouseUp(element, { button: 0 });
  fireEvent.click(element, { button: 0 });
}

describe("Popover", () => {
  it("renders the popover part's classes and labels the popup", async () => {
    render(
      <Popover>
        <PopoverTrigger render={<Button variant="outline" />}>
          Open
        </PopoverTrigger>
        <PopoverPopup className="w-auto">
          <PopoverArrow
            className={({ open }) => (open ? "active-arrow" : undefined)}
          />
          <PopoverTitle>Dimensions</PopoverTitle>
          <PopoverDescription>Set the size.</PopoverDescription>
        </PopoverPopup>
      </Popover>,
    );
    await act(async () => press(screen.getByRole("button", { name: "Open" })));

    const popup = await screen.findByRole("dialog");
    expect(popup.classList.contains("popover-popup")).toBe(true);
    expect(popup.classList.contains("w-auto")).toBe(true);
    expect(popup.querySelector(".popover-arrow.active-arrow")).not.toBeNull();
    expect(popup.parentElement?.classList.contains("popover-positioner")).toBe(
      true,
    );
    expect(screen.getByText("Dimensions").className).toContain("popover-title");
    expect(screen.getByText("Set the size.").className).toContain(
      "popover-description",
    );
  });

  it("composes the trigger through render, keeping the Button part", () => {
    render(
      <Popover>
        <PopoverTrigger render={<Button variant="outline" />}>
          Open
        </PopoverTrigger>
        <PopoverPopup>Body</PopoverPopup>
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Open" });
    expect(trigger.classList.contains("button")).toBe(true);
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("reports why it closed and lets the caller veto the dismissal", async () => {
    const reasons: string[] = [];
    render(
      <Popover
        defaultOpen
        onOpenChange={(open, details) => {
          if (!open) {
            reasons.push(details.reason);
            if (details.reason === "escape-key") details.cancel();
          }
        }}
      >
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverPopup>Body</PopoverPopup>
      </Popover>,
    );
    await screen.findByRole("dialog");

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(reasons).toContain("escape-key");
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("anchors to an element other than the trigger", async () => {
    const anchor = document.createElement("div");
    document.body.append(anchor);
    const spy = vi.spyOn(anchor, "getBoundingClientRect");
    render(
      <Popover open>
        <PopoverPopup anchor={anchor}>Body</PopoverPopup>
      </Popover>,
    );
    await screen.findByRole("dialog");
    expect(spy).toHaveBeenCalled();
    anchor.remove();
  });

  it("moves focus where initialFocus says", async () => {
    function Sample() {
      const field = React.useRef<HTMLInputElement>(null);
      return (
        <Popover defaultOpen>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverPopup initialFocus={field}>
            <button type="button">First</button>
            <input aria-label="Second" ref={field} />
          </PopoverPopup>
        </Popover>
      );
    }
    render(<Sample />);
    await screen.findByRole("dialog");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Second")),
    );
  });
});
