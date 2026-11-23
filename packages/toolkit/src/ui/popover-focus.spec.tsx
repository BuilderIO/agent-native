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

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.js";

afterEach(cleanup);
it("keeps a parent menu open when its popover closes", async () => {
  function Fixture() {
    const [open, setOpen] = React.useState(false);
    return (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger>Page actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger>Connection</PopoverTrigger>
            <PopoverContent>
              <button onClick={() => setOpen(false)}>Finish setup</button>
            </PopoverContent>
          </Popover>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  render(<Fixture />);
  const menuTrigger = screen.getByRole("button", { name: "Page actions" });
  menuTrigger.focus();
  fireEvent.keyDown(menuTrigger, { key: "Enter" });
  const opener = await screen.findByRole("button", { name: "Connection" });
  opener.focus();
  fireEvent.click(opener);
  fireEvent.click(await screen.findByRole("button", { name: "Finish setup" }));
  await waitFor(() => expect(screen.queryByText("Finish setup")).toBeNull());
  expect(screen.queryByRole("menu")).not.toBeNull();
  expect(document.activeElement).toBe(opener);
});

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

it("does not restore an older native popover trigger over its replacement", async () => {
  function Fixture() {
    const [step, setStep] = React.useState(0);
    return (
      <>
        <Popover
          open={step === 1}
          onOpenChange={(open) =>
            setStep((current) => (open ? 1 : current === 1 ? 0 : current))
          }
        >
          <PopoverTrigger>Start setup</PopoverTrigger>
          <PopoverContent>
            <button onClick={() => setStep(2)}>Continue setup</button>
          </PopoverContent>
        </Popover>
        <Popover
          open={step === 2}
          onOpenChange={(open) =>
            setStep((current) => (open ? 2 : current === 2 ? 0 : current))
          }
        >
          <PopoverContent>
            <input aria-label="Replacement setting" />
          </PopoverContent>
        </Popover>
      </>
    );
  }
  render(<Fixture />);
  const trigger = screen.getByRole("button", { name: "Start setup" });
  trigger.focus();
  fireEvent.click(trigger);
  const next = await screen.findByRole("button", { name: "Continue setup" });
  await waitFor(() => expect(document.activeElement).toBe(next));
  vi.useFakeTimers();
  try {
    await act(async () => {
      fireEvent.click(next);
      await vi.runOnlyPendingTimersAsync();
    });
    expect(document.activeElement).toBe(
      screen.getByLabelText("Replacement setting"),
    );
  } finally {
    vi.useRealTimers();
  }
});
