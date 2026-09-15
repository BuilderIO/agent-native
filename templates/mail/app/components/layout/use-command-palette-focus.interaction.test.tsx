// @vitest-environment happy-dom

import { CommandMenu } from "@agent-native/core/client/navigation";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";

import { useCommandPaletteFocus } from "./use-command-palette-focus";

const SEARCH_QUERY = "qzxvnoresulttoken90385671zz";
const SEARCH_ROUTE = `/all?q=${SEARCH_QUERY}`;

function PaletteHarness() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState(SEARCH_QUERY);
  const [route, setRoute] = useState(SEARCH_ROUTE);
  const [closeFocusPrevented, setCloseFocusPrevented] = useState<
    boolean | null
  >(null);
  const { openPalette, handleOpenChange, restoreFocusAfterEscape } =
    useCommandPaletteFocus(paletteOpen, setPaletteOpen);

  useKeyboardShortcuts([
    { key: "k", meta: true, handler: openPalette, skipInInput: false },
  ]);

  return (
    <>
      <label htmlFor="mail-search">Mail search</label>
      <input
        id="mail-search"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
      />
      <label htmlFor="recipient-to">To</label>
      <input id="recipient-to" />
      <output data-testid="route">{route}</output>
      <output data-testid="close-focus-prevented">
        {closeFocusPrevented === null ? "unset" : String(closeFocusPrevented)}
      </output>
      <button onClick={openPalette}>Open command menu</button>
      <CommandMenu
        open={paletteOpen}
        onOpenChange={handleOpenChange}
        onCloseAutoFocus={(event) => {
          restoreFocusAfterEscape(event);
          setCloseFocusPrevented(event.defaultPrevented);
        }}
        clearSearchOnEscape
        placeholder="Search commands"
        showAgentFallback={false}
      >
        <CommandMenu.Group heading="Actions">
          <CommandMenu.Item
            onSelect={() => setRoute("/archive")}
            deferSelect={false}
          >
            Go to Archive
          </CommandMenu.Item>
        </CommandMenu.Group>
      </CommandMenu>
    </>
  );
}

function pressEscape() {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

function pressPaletteShortcut(
  target: HTMLElement,
  modifier: { metaKey: boolean; ctrlKey: boolean },
) {
  const event = new KeyboardEvent("keydown", {
    key: "k",
    ...modifier,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe("Mail command palette focus recovery", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it.each([
    { name: "Command", metaKey: true, ctrlKey: false },
    { name: "Control", metaKey: false, ctrlKey: true },
  ])(
    "opens with $name+K and restores Search without changing its route or query",
    async ({ metaKey, ctrlKey }) => {
      render(<PaletteHarness />);

      const search = screen.getByRole("textbox", { name: "Mail search" });
      search.focus();
      const shortcutEvent = pressPaletteShortcut(search, { metaKey, ctrlKey });
      expect(shortcutEvent.defaultPrevented).toBe(true);

      const commandInput =
        document.querySelector<HTMLInputElement>("[cmdk-input]");
      expect(commandInput).toBeTruthy();
      await waitFor(() => expect(document.activeElement).toBe(commandInput));

      fireEvent.change(commandInput!, { target: { value: "archive" } });
      expect(commandInput?.value).toBe("archive");

      pressEscape();

      expect(commandInput?.value).toBe("");
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(document.activeElement).toBe(commandInput);

      pressEscape();

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(search));
      expect((search as HTMLInputElement).value).toBe(SEARCH_QUERY);
      expect(screen.getByTestId("route").textContent).toBe(SEARCH_ROUTE);
    },
  );

  it.each([
    { name: "Command", metaKey: true, ctrlKey: false },
    { name: "Control", metaKey: false, ctrlKey: true },
  ])(
    "closes an empty palette opened with $name+K from To and restores focus",
    async ({ metaKey, ctrlKey }) => {
      render(<PaletteHarness />);

      const recipient = screen.getByRole("textbox", { name: "To" });
      recipient.focus();
      const shortcutEvent = pressPaletteShortcut(recipient, {
        metaKey,
        ctrlKey,
      });
      expect(shortcutEvent.defaultPrevented).toBe(true);

      const commandInput =
        document.querySelector<HTMLInputElement>("[cmdk-input]");
      expect(commandInput).toBeTruthy();
      await waitFor(() => expect(document.activeElement).toBe(commandInput));
      expect(commandInput?.value).toBe("");

      pressEscape();

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(recipient));
      expect((recipient as HTMLInputElement).value).toBe("");
      expect(
        (
          screen.getByRole("textbox", {
            name: "Mail search",
          }) as HTMLInputElement
        ).value,
      ).toBe(SEARCH_QUERY);
      expect(screen.getByTestId("route").textContent).toBe(SEARCH_ROUTE);
    },
  );

  it.each([
    { name: "Command", metaKey: true, ctrlKey: false },
    { name: "Control", metaKey: false, ctrlKey: true },
  ])(
    "opens with $name+K from To and restores recipient focus on Escape",
    async ({ metaKey, ctrlKey }) => {
      render(<PaletteHarness />);

      const recipient = screen.getByRole("textbox", { name: "To" });
      recipient.focus();
      const shortcutEvent = pressPaletteShortcut(recipient, {
        metaKey,
        ctrlKey,
      });
      expect(shortcutEvent.defaultPrevented).toBe(true);

      const commandInput =
        document.querySelector<HTMLInputElement>("[cmdk-input]");
      expect(commandInput).toBeTruthy();
      await waitFor(() => expect(document.activeElement).toBe(commandInput));

      fireEvent.change(commandInput!, { target: { value: "archive" } });
      pressEscape();
      expect(commandInput?.value).toBe("");
      expect(screen.getByRole("dialog")).toBeTruthy();

      pressEscape();
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(recipient));
      expect((recipient as HTMLInputElement).value).toBe("");
      expect(
        (
          screen.getByRole("textbox", {
            name: "Mail search",
          }) as HTMLInputElement
        ).value,
      ).toBe(SEARCH_QUERY);
      expect(screen.getByTestId("route").textContent).toBe(SEARCH_ROUTE);
    },
  );

  it("does not run Escape focus restoration when a command is selected", async () => {
    render(<PaletteHarness />);

    const trigger = screen.getByRole("button", { name: "Open command menu" });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByText("Go to Archive"));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByTestId("route").textContent).toBe("/archive");
    expect(screen.getByTestId("close-focus-prevented").textContent).toBe(
      "false",
    );
  });
});
