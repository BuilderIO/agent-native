// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Field, FieldLabel } from "./field.js";
import {
  OTPField,
  OTPFieldInput,
  type OTPFieldProps,
  OTPFieldSeparator,
} from "./otp-field.js";

afterEach(cleanup);

function boxes(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(".otp-field-input"),
  );
}

describe("OTP Field part", () => {
  it("draws a box per character at surface, the first named by its field", () => {
    render(
      <Field>
        <FieldLabel>Verification code</FieldLabel>
        <OTPField length={6} />
      </Field>,
    );
    const first = screen.getByRole("textbox", { name: "Verification code" });
    expect(boxes().length).toBe(6);
    expect(boxes()[0]).toBe(first);
    expect(screen.getByRole("textbox", { name: "Character 6 of 6" })).toBe(
      boxes()[5],
    );
    const root = first.closest<HTMLElement>(".otp-field");
    expect(root?.dataset.variant).toBe("surface");
    expect(root?.dataset.color).toBeUndefined();
  });

  it("writes variant, color and radius on the field, and names boxes with inputLabel", () => {
    render(
      <OTPField
        length={4}
        variant="soft"
        color="info"
        radius="full"
        inputLabel={(position, length) => `Digit ${position}/${length}`}
      />,
    );
    const root = document.querySelector<HTMLElement>(".otp-field");
    expect(root?.dataset.variant).toBe("soft");
    expect(root?.dataset.color).toBe("info");
    expect(root?.dataset.radius).toBe("full");
    expect(screen.getByRole("textbox", { name: "Digit 4/4" })).toBe(boxes()[3]);
  });

  it("refuses a variant it doesn't have instead of drawing the default", () => {
    const props = { variant: "outline" } as unknown as Pick<
      OTPFieldProps,
      "variant"
    >;
    expect(() => render(<OTPField length={4} {...props} />)).toThrow(
      /variant="outline" is not one of/,
    );
  });

  it("moves to the next box as a character is typed and back on Backspace", () => {
    render(<OTPField length={4} aria-label="Code" />);
    const first = boxes().at(0);
    const second = boxes().at(1);
    if (first === undefined || second === undefined)
      throw new Error("no boxes");
    act(() => first.focus());
    fireEvent.change(first, { target: { value: "7" } });
    expect(first.value).toBe("7");
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "Backspace" });
    expect(document.activeElement).toBe(first);
  });

  it("fills every box from a pasted code and reports it complete", () => {
    const onValueComplete = vi.fn();
    render(<OTPField length={6} onValueComplete={onValueComplete} />);
    const first = boxes().at(0);
    if (first === undefined) throw new Error("no boxes");
    act(() => first.focus());
    fireEvent.paste(first, {
      clipboardData: { getData: () => "123 456" },
    });
    expect(boxes().map((box) => box.value)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
    expect(onValueComplete).toHaveBeenCalledWith("123456", expect.anything());
    expect(first.closest(".otp-field")?.hasAttribute("data-complete")).toBe(
      true,
    );
  });

  it("lays out its own boxes around a separator", () => {
    render(
      <OTPField length={4}>
        <OTPFieldInput aria-label="Character 1 of 4" />
        <OTPFieldInput aria-label="Character 2 of 4" />
        <OTPFieldSeparator />
        <OTPFieldInput aria-label="Character 3 of 4" />
        <OTPFieldInput aria-label="Character 4 of 4" />
      </OTPField>,
    );
    expect(boxes().length).toBe(4);
    const separator = screen.getByRole("separator");
    expect(separator.classList.contains("otp-field-separator")).toBe(true);
  });
});
