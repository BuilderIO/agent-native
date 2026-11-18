// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";

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

it("keeps focus inside a replacement popover during delayed close cleanup", async () => {
  function Fixture() {
    const [version, setVersion] = React.useState(0);
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open setup</button>
        <Popover key={version} open={open} onOpenChange={setOpen}>
          <PopoverContent>
            {version === 0 ? (
              <button onClick={() => setVersion(1)}>Continue setup</button>
            ) : (
              <input aria-label="Next step" />
            )}
          </PopoverContent>
        </Popover>
      </>
    );
  }
  render(<Fixture />);
  const opener = screen.getByRole("button", { name: "Open setup" });
  opener.focus();
  fireEvent.click(opener);
  const next = await screen.findByRole("button", { name: "Continue setup" });
  await waitFor(() => expect(document.activeElement).toBe(next));
  vi.useFakeTimers();
  try {
    await act(async () => {
      fireEvent.click(next);
      await vi.runOnlyPendingTimersAsync();
    });
    expect(document.activeElement).toBe(screen.getByLabelText("Next step"));
  } finally {
    vi.useRealTimers();
  }
});
