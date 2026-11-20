// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RadioCards,
  RadioCardsItem,
  type RadioCardsProps,
} from "./radio-cards.js";

afterEach(cleanup);

function Plans(props: RadioCardsProps) {
  return (
    <RadioCards aria-label="Plan" defaultValue="free" {...props}>
      <RadioCardsItem value="free">Free</RadioCardsItem>
      <RadioCardsItem value="pro">Pro</RadioCardsItem>
      <RadioCardsItem value="team" disabled>
        Team
      </RadioCardsItem>
    </RadioCards>
  );
}

describe("Radio Cards part", () => {
  it("renders the group and cards, each card a radio named by its content", () => {
    render(<Plans />);
    const group = screen.getByRole("radiogroup", { name: "Plan" });
    expect(group.classList.contains("radio-cards")).toBe(true);
    const free = screen.getByRole("radio", { name: "Free" });
    expect(free.classList.contains("radio-cards-item")).toBe(true);
    expect(free.getAttribute("aria-checked")).toBe("true");
    expect(free.hasAttribute("data-checked")).toBe(true);
    const pro = screen.getByRole("radio", { name: "Pro" });
    expect(pro.hasAttribute("data-unchecked")).toBe(true);
  });

  it("draws its cards at surface by default, inheriting their color", () => {
    render(<Plans />);
    const free = screen.getByRole("radio", { name: "Free" });
    expect(free.dataset.variant).toBe("surface");
    expect(free.dataset.color).toBeUndefined();
    expect(free.dataset.highContrast).toBeUndefined();
  });

  it("writes the group's variant, color and high contrast on each card", () => {
    render(<Plans variant="soft" color="success" highContrast />);
    const group = screen.getByRole("radiogroup", { name: "Plan" });
    expect(group.dataset.color).toBe("success");
    for (const card of screen.getAllByRole("radio")) {
      expect(card.dataset.variant).toBe("soft");
      expect(card.dataset.color).toBe("success");
      expect(card.dataset.highContrast).toBe("");
    }
  });

  it("refuses a variant it doesn't have", () => {
    const props = { variant: "classic" } as unknown as RadioCardsProps;
    expect(() => render(<Plans {...props} />)).toThrow(
      /variant="classic" is not one of/,
    );
  });

  it("checks a card on click and reports its value", () => {
    const onValueChange = vi.fn();
    render(<Plans onValueChange={onValueChange} />);
    const pro = screen.getByRole("radio", { name: "Pro" });
    fireEvent.click(pro);
    expect(onValueChange).toHaveBeenCalledWith("pro", expect.anything());
    expect(pro.hasAttribute("data-checked")).toBe(true);
  });

  it("moves to and checks the next card with the arrow keys", async () => {
    const onValueChange = vi.fn();
    render(<Plans onValueChange={onValueChange} />);
    const free = screen.getByRole("radio", { name: "Free" });
    const pro = screen.getByRole("radio", { name: "Pro" });
    act(() => free.focus());
    fireEvent.keyDown(free, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(pro));
    expect(onValueChange).toHaveBeenCalledWith("pro", expect.anything());
  });

  it("does not check a disabled card", () => {
    const onValueChange = vi.fn();
    render(<Plans onValueChange={onValueChange} />);
    const team = screen.getByRole("radio", { name: "Team" });
    fireEvent.click(team);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(team.hasAttribute("data-disabled")).toBe(true);
  });
});
