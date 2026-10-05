// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { DeckFilter } from "@/lib/deck-filter";

import { DeckFilterMenu } from "./DeckFilterMenu";

function renderMenu(value: DeckFilter) {
  return render(<DeckFilterMenu value={value} onChange={() => {}} />);
}

afterEach(cleanup);

describe("DeckFilterMenu", () => {
  it("shows the selected ownership scope in the trigger", () => {
    renderMenu("mine");

    expect(screen.getByRole("button", { name: "Owned by me" })).toBeDefined();
  });

  it("labels the unfiltered state by owner", () => {
    renderMenu("all");

    expect(
      screen.getByRole("button", { name: "Owned by anyone" }),
    ).toBeDefined();
  });
});
