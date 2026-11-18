// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, expect, it } from "vitest";

import { Popover, PopoverContent } from "./popover.js";

afterEach(cleanup);
it("returns focus to a state-driven popover opener after Escape", async () => {
  function Fixture() {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open choices</button>
        <Popover open={open} onOpenChange={setOpen} modal>
          <PopoverContent>
            <input aria-label="Choice" autoFocus />
          </PopoverContent>
        </Popover>
      </>
    );
  }
  render(<Fixture />);
  const opener = screen.getByRole("button", { name: "Open choices" });
  opener.focus();
  fireEvent.click(opener);
  const input = await screen.findByLabelText("Choice");
  await waitFor(() => expect(document.activeElement).toBe(input));
  opener.focus();
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

it("allows focus to leave a non-modal popover and preserves the destination", async () => {
  function Fixture() {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <button>Destination</button>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverContent>
            <input aria-label="Choice" />
          </PopoverContent>
        </Popover>
      </>
    );
  }
  render(<Fixture />);
  const opener = screen.getByRole("button", { name: "Open" });
  opener.focus();
  fireEvent.click(opener);
  const input = await screen.findByLabelText("Choice");
  await waitFor(() => expect(document.activeElement).toBe(input));
  const destination = screen.getByRole("button", { name: "Destination" });
  destination.focus();
  await waitFor(() => expect(screen.queryByLabelText("Choice")).toBeNull());
  expect(document.activeElement).toBe(destination);
});
