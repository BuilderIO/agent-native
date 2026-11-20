// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CheckboxGroup } from "./checkbox-group.js";
import { Checkbox } from "./checkbox.js";
import { Field, FieldDescription, FieldError, FieldLabel } from "./field.js";
import { Fieldset, FieldsetLegend } from "./fieldset.js";
import { Input, type InputProps, InputSlot } from "./input.js";
import { Radio, RadioGroup, type RadioGroupProps } from "./radio-group.js";
import { TextArea } from "./text-area.js";

afterEach(cleanup);

describe("Input and Text Area parts", () => {
  it("draws the input part at size md surface by default and reports typed values", () => {
    const onValueChange = vi.fn();
    render(<Input aria-label="Name" onValueChange={onValueChange} />);
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input.classList.contains("input-control")).toBe(true);
    const frame = input.closest<HTMLElement>(".input");
    expect(frame?.dataset.size).toBe("md");
    expect(frame?.dataset.variant).toBe("surface");
    expect(frame?.dataset.color).toBeUndefined();
    fireEvent.change(input, { target: { value: "Ada" } });
    expect(onValueChange).toHaveBeenCalledWith("Ada", expect.anything());
  });

  it("writes size, variant, color and radius on the frame, with its class and style", () => {
    render(
      <Input
        aria-label="Search"
        size="sm"
        variant="soft"
        color="gray"
        radius="full"
        className="w-64"
        style={{ maxWidth: 320 }}
      />,
    );
    const frame = screen
      .getByRole("textbox", { name: "Search" })
      .closest<HTMLElement>(".input");
    expect(frame?.dataset.size).toBe("sm");
    expect(frame?.dataset.variant).toBe("soft");
    expect(frame?.dataset.color).toBe("gray");
    expect(frame?.dataset.radius).toBe("full");
    expect(frame?.classList.contains("w-64")).toBe(true);
    expect(frame?.style.maxWidth).toBe("320px");
  });

  it("refuses a variant it doesn't have instead of drawing the default", () => {
    const props = { variant: "outline" } as unknown as InputProps;
    expect(() => render(<Input aria-label="Name" {...props} />)).toThrow(
      /variant="outline" is not one of/,
    );
  });

  it("puts its slots inside the field's frame, marked by side", () => {
    render(
      <Input aria-label="Search" placeholder="Search all">
        <InputSlot>
          <svg data-testid="icon" />
        </InputSlot>
        <InputSlot side="right">⌘K</InputSlot>
      </Input>,
    );
    const input = screen.getByRole("textbox", { name: "Search" });
    const slots = input.closest(".input")?.querySelectorAll(".input-slot");
    expect(slots?.length).toBe(2);
    expect(slots?.[0]?.querySelector("[data-testid=icon]")).not.toBeNull();
    expect(slots?.[0]?.hasAttribute("data-side")).toBe(false);
    expect(slots?.[1]?.getAttribute("data-side")).toBe("right");
    expect(slots?.[1]?.textContent).toBe("⌘K");
    expect(input.getAttribute("placeholder")).toBe("Search all");
  });

  it("focuses the input from a press on a slot, but not from a control in one", async () => {
    const onClick = vi.fn();
    render(
      <Input aria-label="Search">
        <InputSlot>
          <svg data-testid="icon" />
        </InputSlot>
        <InputSlot side="right">
          <button type="button" onClick={onClick}>
            Clear
          </button>
        </InputSlot>
      </Input>,
    );
    const input = screen.getByRole("textbox", { name: "Search" });
    const clear = screen.getByRole("button", { name: "Clear" });
    fireEvent.pointerDown(clear);
    await act(() => new Promise(requestAnimationFrame));
    expect(document.activeElement).not.toBe(input);
    fireEvent.pointerDown(screen.getByTestId("icon"));
    await act(() => new Promise(requestAnimationFrame));
    expect(document.activeElement).toBe(input);
  });

  it("draws a text area with its props and own attributes, and reports its value", () => {
    const onValueChange = vi.fn();
    render(
      <TextArea
        aria-label="Notes"
        rows={4}
        placeholder="Add a note"
        size="sm"
        variant="soft"
        resize="none"
        onValueChange={onValueChange}
      />,
    );
    const textarea = screen.getByRole("textbox", { name: "Notes" });
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea.classList.contains("text-area")).toBe(true);
    expect(textarea.dataset.size).toBe("sm");
    expect(textarea.dataset.variant).toBe("soft");
    expect(textarea.dataset.resize).toBe("none");
    expect(textarea.getAttribute("rows")).toBe("4");
    expect(textarea.getAttribute("placeholder")).toBe("Add a note");
    fireEvent.change(textarea, { target: { value: "Line one" } });
    expect(onValueChange).toHaveBeenCalledWith("Line one", expect.anything());
  });

  it("draws a text area at size md surface, resizing vertically, by default", () => {
    render(<TextArea aria-label="Notes" />);
    const textarea = screen.getByRole("textbox", { name: "Notes" });
    expect(textarea.dataset.size).toBe("md");
    expect(textarea.dataset.variant).toBe("surface");
    expect(textarea.dataset.resize).toBe("vertical");
  });
});

describe("Field part", () => {
  it("labels and describes its control", () => {
    render(
      <Field>
        <FieldLabel>Email</FieldLabel>
        <Input type="email" />
        <FieldDescription>We send receipts here.</FieldDescription>
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Email" });
    const description = screen.getByText("We send receipts here.");
    expect(description.classList.contains("field-description")).toBe(true);
    expect(input.getAttribute("aria-describedby")).toContain(description.id);
    expect(
      screen.getByText("Email").closest(".field")?.classList.contains("field"),
    ).toBe(true);
  });

  it("shows its error and marks the control invalid when blur validation fails", async () => {
    render(
      <Field
        validationMode="onBlur"
        validate={(value) => (value === "" ? "Enter a name." : null)}
      >
        <FieldLabel>Name</FieldLabel>
        <Input />
        <FieldError />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Name" });
    await act(async () => {
      fireEvent.focus(input);
      fireEvent.blur(input);
    });
    expect(input.hasAttribute("data-invalid")).toBe(true);
    const error = screen.getByText("Enter a name.");
    expect(error.classList.contains("field-error")).toBe(true);
  });

  it("groups fields under a legend", () => {
    render(
      <Fieldset>
        <FieldsetLegend>Billing</FieldsetLegend>
        <Field>
          <FieldLabel>Company</FieldLabel>
          <Input />
        </Field>
      </Fieldset>,
    );
    const group = screen.getByRole("group", { name: "Billing" });
    expect(group.classList.contains("fieldset")).toBe(true);
    expect(
      screen.getByText("Billing").classList.contains("fieldset-legend"),
    ).toBe(true);
  });
});

describe("Checkbox part", () => {
  it("writes its variant, surface by default, inheriting its color", () => {
    render(<Checkbox aria-label="Notify me" />);
    const box = screen.getByRole("checkbox", { name: "Notify me" });
    expect(box.dataset.variant).toBe("surface");
    expect(box.dataset.color).toBeUndefined();
    expect(box.dataset.highContrast).toBeUndefined();
  });

  it("writes variant, color and high contrast as Radix names them", () => {
    render(
      <Checkbox
        aria-label="Notify me"
        variant="soft"
        color="danger"
        highContrast
      />,
    );
    const box = screen.getByRole("checkbox", { name: "Notify me" });
    expect(box.dataset.variant).toBe("soft");
    expect(box.dataset.color).toBe("danger");
    expect(box.dataset.highContrast).toBe("");
  });

  it("toggles and draws a check while checked", () => {
    const onCheckedChange = vi.fn();
    render(
      <Checkbox aria-label="Notify me" onCheckedChange={onCheckedChange} />,
    );
    const box = screen.getByRole("checkbox", { name: "Notify me" });
    expect(box.classList.contains("checkbox")).toBe(true);
    expect(box.querySelector(".checkbox-indicator")).toBeNull();
    fireEvent.click(box);
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything());
    expect(box.hasAttribute("data-checked")).toBe(true);
    expect(box.querySelector(".checkbox-indicator svg")).not.toBeNull();
  });

  it("draws a dash while indeterminate", () => {
    render(<Checkbox aria-label="All" indeterminate />);
    const box = screen.getByRole("checkbox", { name: "All" });
    expect(box.getAttribute("aria-checked")).toBe("mixed");
    expect(
      box.querySelector(".checkbox-indicator .tabler-icon-minus"),
    ).not.toBeNull();
  });

  it("holds the checked values of a group", () => {
    const onValueChange = vi.fn();
    render(
      <CheckboxGroup defaultValue={["email"]} onValueChange={onValueChange}>
        <Checkbox name="channel" value="email" aria-label="Email" />
        <Checkbox name="channel" value="sms" aria-label="SMS" />
      </CheckboxGroup>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "SMS" }));
    expect(onValueChange).toHaveBeenCalledWith(
      ["email", "sms"],
      expect.anything(),
    );
  });
  it("draws its checkboxes with the group's props, and a checkbox's own win", () => {
    render(
      <CheckboxGroup aria-label="Channels" variant="soft" color="gray">
        <Checkbox value="email" aria-label="Email" />
        <Checkbox value="sms" aria-label="SMS" color="danger" />
      </CheckboxGroup>,
    );
    const email = screen.getByRole("checkbox", { name: "Email" });
    expect(email.dataset.variant).toBe("soft");
    expect(email.dataset.color).toBe("gray");
    const sms = screen.getByRole("checkbox", { name: "SMS" });
    expect(sms.dataset.variant).toBe("soft");
    expect(sms.dataset.color).toBe("danger");
  });
});

describe("Radio part", () => {
  it("selects one value in its group", () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup
        aria-label="Plan"
        defaultValue="free"
        onValueChange={onValueChange}
      >
        <Radio value="free" aria-label="Free" />
        <Radio value="pro" aria-label="Pro" />
      </RadioGroup>,
    );
    const group = screen.getByRole("radiogroup", { name: "Plan" });
    expect(group.classList.contains("radio-group")).toBe(true);
    const free = screen.getByRole("radio", { name: "Free" });
    expect(free.classList.contains("radio-group-radio")).toBe(true);
    expect(free.hasAttribute("data-checked")).toBe(true);
    expect(free.querySelector(".radio-group-indicator")).not.toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Pro" }));
    expect(onValueChange).toHaveBeenCalledWith("pro", expect.anything());
  });
  it("draws its radios as surface by default", () => {
    render(
      <RadioGroup aria-label="Plan">
        <Radio value="free" aria-label="Free" />
      </RadioGroup>,
    );
    const free = screen.getByRole("radio", { name: "Free" });
    expect(free.dataset.variant).toBe("surface");
    expect(free.dataset.color).toBeUndefined();
  });

  it("writes the group's variant, color and high contrast on each radio", () => {
    render(
      <RadioGroup aria-label="Plan" variant="soft" color="success" highContrast>
        <Radio value="free" aria-label="Free" />
      </RadioGroup>,
    );
    const free = screen.getByRole("radio", { name: "Free" });
    expect(free.dataset.variant).toBe("soft");
    expect(free.dataset.color).toBe("success");
    expect(free.dataset.highContrast).toBe("");
  });

  it("refuses a variant it doesn't have", () => {
    const props = { variant: "classic" } as unknown as RadioGroupProps;
    expect(() =>
      render(
        <RadioGroup aria-label="Plan" {...props}>
          <Radio value="free" aria-label="Free" />
        </RadioGroup>,
      ),
    ).toThrow(/variant="classic" is not one of/);
  });

  it("does not select a disabled radio", () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup aria-label="Plan" onValueChange={onValueChange}>
        <Radio value="free" aria-label="Free" disabled />
      </RadioGroup>,
    );
    const free = screen.getByRole("radio", { name: "Free" });
    fireEvent.click(free);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(free.hasAttribute("data-disabled")).toBe(true);
  });
});
