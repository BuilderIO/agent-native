// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CheckboxCards,
  CheckboxCardsItem,
  type CheckboxCardsProps,
} from "./checkbox-cards.js";

afterEach(cleanup);

function Channels(props: CheckboxCardsProps) {
  return (
    <CheckboxCards aria-label="Channels" defaultValue={["email"]} {...props}>
      <CheckboxCardsItem value="email">Email</CheckboxCardsItem>
      <CheckboxCardsItem value="sms">SMS</CheckboxCardsItem>
      <CheckboxCardsItem value="push" disabled>
        Push
      </CheckboxCardsItem>
    </CheckboxCards>
  );
}

describe("Checkbox Cards part", () => {
  it("renders the group and cards, each card a checkbox named by its content", () => {
    render(<Channels />);
    const email = screen.getByRole("checkbox", { name: "Email" });
    expect(email.classList.contains("checkbox-cards-item")).toBe(true);
    expect(email.closest(".checkbox-cards")).not.toBeNull();
    expect(email.getAttribute("aria-checked")).toBe("true");
    expect(email.hasAttribute("data-checked")).toBe(true);
    const sms = screen.getByRole("checkbox", { name: "SMS" });
    expect(sms.getAttribute("aria-checked")).toBe("false");
  });

  it("draws a surface checkbox in each card checked with the card", () => {
    render(<Channels variant="soft" highContrast />);
    const email = screen.getByRole("checkbox", { name: "Email" });
    const box = email.querySelector<HTMLElement>(".checkbox-cards-checkbox");
    expect(box?.classList.contains("checkbox")).toBe(true);
    expect(box?.getAttribute("aria-hidden")).toBe("true");
    expect(box?.dataset.variant).toBe("surface");
    expect(box?.dataset.highContrast).toBe("");
    expect(box?.hasAttribute("data-checked")).toBe(true);
    expect(box?.querySelector(".checkbox-indicator svg")).not.toBeNull();
    const sms = screen.getByRole("checkbox", { name: "SMS" });
    const empty = sms.querySelector<HTMLElement>(".checkbox-cards-checkbox");
    expect(empty?.hasAttribute("data-unchecked")).toBe(true);
    expect(empty?.querySelector(".checkbox-indicator")).toBeNull();
  });

  it("draws its cards at surface by default, inheriting their color", () => {
    render(<Channels />);
    const email = screen.getByRole("checkbox", { name: "Email" });
    expect(email.dataset.variant).toBe("surface");
    expect(email.dataset.color).toBeUndefined();
  });

  it("writes the group's variant, color and high contrast on each card", () => {
    render(<Channels variant="soft" color="warning" highContrast />);
    for (const card of screen.getAllByRole("checkbox")) {
      expect(card.dataset.variant).toBe("soft");
      expect(card.dataset.color).toBe("warning");
      expect(card.dataset.highContrast).toBe("");
    }
  });

  it("toggles a card's value in the group on click and with Space", () => {
    const onValueChange = vi.fn();
    render(<Channels onValueChange={onValueChange} />);
    const sms = screen.getByRole("checkbox", { name: "SMS" });
    fireEvent.click(sms);
    expect(onValueChange).toHaveBeenLastCalledWith(
      ["email", "sms"],
      expect.anything(),
    );
    expect(sms.hasAttribute("data-checked")).toBe(true);
    const email = screen.getByRole("checkbox", { name: "Email" });
    act(() => email.focus());
    fireEvent.keyDown(email, { key: " " });
    fireEvent.keyUp(email, { key: " " });
    expect(onValueChange).toHaveBeenLastCalledWith(["sms"], expect.anything());
  });

  it("does not toggle a disabled card, and draws its checkbox disabled", () => {
    const onValueChange = vi.fn();
    render(<Channels onValueChange={onValueChange} />);
    const push = screen.getByRole("checkbox", { name: "Push" });
    fireEvent.click(push);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(push.hasAttribute("data-disabled")).toBe(true);
    expect(
      push
        .querySelector(".checkbox-cards-checkbox")
        ?.hasAttribute("data-disabled"),
    ).toBe(true);
  });
});
