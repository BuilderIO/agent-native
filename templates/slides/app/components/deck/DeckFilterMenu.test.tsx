// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { DeckFilterMenu } from "./DeckFilterMenu";

function renderMenu(value: "all" | "mine") {
  return render(
    <TooltipProvider>
      <DeckFilterMenu value={value} onChange={() => {}} />
    </TooltipProvider>,
  );
}

afterEach(cleanup);

describe("DeckFilterMenu", () => {
  it("marks the trigger while Mine narrows the deck list", () => {
    renderMenu("mine");

    const indicator = screen
      .getByRole("button")
      .querySelector("[data-filter-active]");
    expect(indicator?.getAttribute("data-filter-active")).toBe("true");
    expect(indicator?.querySelector("[data-filter-active-dot]")).not.toBeNull();
  });

  it("leaves the trigger unmarked while All shows every deck", () => {
    renderMenu("all");

    const indicator = screen
      .getByRole("button")
      .querySelector("[data-filter-active]");
    expect(indicator?.getAttribute("data-filter-active")).toBe("false");
    expect(indicator?.querySelector("[data-filter-active-dot]")).toBeNull();
  });
});
