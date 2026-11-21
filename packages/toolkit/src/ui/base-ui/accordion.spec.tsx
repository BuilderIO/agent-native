// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "./accordion.js";

afterEach(cleanup);

describe("Accordion part", () => {
  it("opens a panel from its trigger and marks the trigger open", () => {
    render(
      <Accordion>
        <AccordionItem value="a">
          <AccordionTrigger>Shipping</AccordionTrigger>
          <AccordionPanel>Two to four days.</AccordionPanel>
        </AccordionItem>
      </Accordion>,
    );
    const trigger = screen.getByRole("button", { name: "Shipping" });
    expect(trigger.classList.contains("accordion-trigger")).toBe(true);
    expect(trigger.parentElement?.classList.contains("accordion-header")).toBe(
      true,
    );
    expect(trigger.querySelector(".accordion-chevron")).not.toBeNull();
    expect(screen.queryByText("Two to four days.")).toBeNull();
    fireEvent.click(trigger);
    expect(trigger.hasAttribute("data-panel-open")).toBe(true);
    expect(
      screen
        .getByText("Two to four days.")
        .classList.contains("accordion-panel"),
    ).toBe(true);
  });

  it("does not open a disabled item", () => {
    render(
      <Accordion>
        <AccordionItem value="a" disabled>
          <AccordionTrigger>Shipping</AccordionTrigger>
          <AccordionPanel>Two to four days.</AccordionPanel>
        </AccordionItem>
      </Accordion>,
    );
    const trigger = screen.getByRole("button", { name: "Shipping" });
    expect(trigger.hasAttribute("data-disabled")).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByText("Two to four days.")).toBeNull();
  });
});
