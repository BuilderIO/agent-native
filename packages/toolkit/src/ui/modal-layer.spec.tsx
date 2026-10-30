// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Dialog, DialogContent, DialogTitle } from "./dialog.js";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.js";
import { Sheet, SheetContent, SheetTitle } from "./sheet.js";

afterEach(cleanup);

function layer(element: HTMLElement): string {
  return (element.className.match(/z-\[\d+\]/g) ?? []).join(" ");
}

function sheetIn(wrapper: (sheet: React.ReactNode) => React.ReactNode) {
  const sheet = (
    <Sheet open>
      <SheetContent aria-describedby={undefined} data-testid="sheet">
        <SheetTitle>Journey</SheetTitle>
      </SheetContent>
    </Sheet>
  );
  render(<>{wrapper(sheet)}</>);
  return screen.getByTestId("sheet");
}

describe("sheet layering", () => {
  it("keeps a standalone sheet on its own layer", () => {
    expect(layer(sheetIn((sheet) => sheet))).toBe("z-[230]");
  });

  it("opens a sheet from a dialog above the dialog and below popovers", () => {
    const content = sheetIn((sheet) => (
      <Dialog open>
        <DialogContent aria-describedby={undefined} data-testid="dialog">
          <DialogTitle>Details</DialogTitle>
          {sheet}
        </DialogContent>
      </Dialog>
    ));
    const dialogZ = Number(
      /z-\[(\d+)\]/.exec(layer(screen.getByTestId("dialog")))?.[1],
    );
    const sheetZ = Number(/z-\[(\d+)\]/.exec(layer(content))?.[1]);
    expect(sheetZ).toBeGreaterThan(dialogZ);
    expect(sheetZ).toBeLessThan(290);
  });
});

describe("popover inside a modal layer", () => {
  function PopoverUnderTest({ modal }: { modal?: boolean }) {
    return (
      <>
        <button type="button">outside</button>
        <Popover open modal={modal}>
          <PopoverTrigger>trigger</PopoverTrigger>
          <PopoverContent>list</PopoverContent>
        </Popover>
      </>
    );
  }

  // A modal popover hides everything outside it from assistive tech, which is
  // also what lets Radix's scroll lock treat its content as a layer.
  const outsideHidden = () =>
    screen.getByText("outside").closest("[aria-hidden=true]") !== null;

  it("stays non-modal on the page", () => {
    render(<PopoverUnderTest />);
    expect(outsideHidden()).toBe(false);
  });

  it("becomes modal inside a dialog so the wheel can scroll it", () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Details</DialogTitle>
          <PopoverUnderTest />
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText("list")).toBeTruthy();
    expect(screen.getByText("list").closest("[aria-hidden=true]")).toBeNull();
    expect(
      screen.getByText("trigger").closest("[aria-hidden=true]"),
    ).not.toBeNull();
  });

  it("lets a caller keep it non-modal", () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Details</DialogTitle>
          <PopoverUnderTest modal={false} />
        </DialogContent>
      </Dialog>,
    );
    expect(
      screen.getByText("trigger").closest("[aria-hidden=true]"),
    ).toBeNull();
  });
});
