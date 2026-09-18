// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DateSearchChoice, SearchEmptyOption } from "./ContentCommandSearch";
import { Command, CommandList } from "./ui/command";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal()),
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/navigation", async (importOriginal) => ({
  ...(await importOriginal()),
  useCommandMenuNestedDialog: () => undefined,
}));

describe("DateSearchChoice in a command dialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
  });

  async function renderPicker() {
    function Harness() {
      const [dialogOpen, setDialogOpen] = useState(true);
      return (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogTitle>Search</DialogTitle>
            <input aria-label="Search query" />
            <DateSearchChoice
              label="Modified date"
              triggerLabel="Any date"
              presetValue="all"
              onSelectPreset={vi.fn()}
              onPickDay={vi.fn()}
              focusInput={() =>
                document
                  .querySelector<HTMLInputElement>(
                    '[aria-label="Search query"]',
                  )
                  ?.focus()
              }
            />
          </DialogContent>
        </Dialog>
      );
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness />));

    const trigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Modified date"]',
    )!;
    await act(async () => trigger.click());

    return { trigger };
  }

  it("keeps the calendar in the parent focus scope and labels its dialog", async () => {
    const { trigger } = await renderPicker();

    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    const calendarDialog = Array.from(dialogs).find(
      (dialog) => dialog.getAttribute("aria-label") === "Modified date",
    )!;
    const commandDialog = Array.from(dialogs).find(
      (dialog) => dialog !== calendarDialog,
    )!;

    expect(commandDialog.contains(calendarDialog)).toBe(true);
    expect(trigger.getAttribute("aria-controls")).toBe(calendarDialog.id);
    expect(calendarDialog.getAttribute("aria-label")).toBe("Modified date");
    expect(calendarDialog.contains(document.activeElement)).toBe(true);
    expect(
      document.activeElement?.closest('[data-slot="calendar"]'),
    ).not.toBeNull();
  });

  it("uses the first Escape for the calendar and restores query focus", async () => {
    await renderPicker();

    const calendarDialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Modified date"]',
    )!;
    await act(async () => {
      calendarDialog.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(
      document.querySelector('[role="dialog"][aria-label="Modified date"]'),
    ).toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Search query",
    );
  });
});

describe("SearchEmptyOption", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
  });

  it("keeps the listbox valid without creating a selectable cmdk item", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () =>
      root.render(
        <Command shouldFilter={false}>
          <CommandList>
            <SearchEmptyOption />
          </CommandList>
        </Command>,
      ),
    );

    const listbox = container.querySelector('[role="listbox"]')!;
    const emptyOption = listbox.querySelector('[role="option"]')!;
    expect(emptyOption.getAttribute("aria-disabled")).toBe("true");
    expect(emptyOption.getAttribute("cmdk-item")).toBeNull();
    expect(emptyOption.textContent).toBe("root.commandSearchEmpty");
  });
});
