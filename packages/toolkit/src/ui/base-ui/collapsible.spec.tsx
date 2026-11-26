// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "./collapsible.js";

afterEach(cleanup);

describe("Collapsible part", () => {
  it("toggles its panel and reports it", () => {
    const onOpenChange = vi.fn();
    render(
      <Collapsible onOpenChange={onOpenChange}>
        <CollapsibleTrigger>Details</CollapsibleTrigger>
        <CollapsiblePanel>More</CollapsiblePanel>
      </Collapsible>,
    );
    const trigger = screen.getByRole("button", { name: "Details" });
    expect(trigger.classList.contains("collapsible-trigger")).toBe(true);
    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(true, expect.anything());
    expect(trigger.hasAttribute("data-panel-open")).toBe(true);
    expect(
      screen.getByText("More").classList.contains("collapsible-panel"),
    ).toBe(true);
  });
});
