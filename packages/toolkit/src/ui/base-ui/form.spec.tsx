// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "./button.js";
import { Field, FieldError, FieldLabel } from "./field.js";
import { Form, type FormProps } from "./form.js";
import { Input } from "./input.js";

afterEach(cleanup);

function SignUp({ onSubmit }: { onSubmit: (username: unknown) => void }) {
  const [errors, setErrors] = React.useState<FormProps["errors"]>({});
  return (
    <Form
      errors={errors}
      onFormSubmit={(values) => {
        onSubmit(values.username);
        setErrors({ username: "That username is taken." });
      }}
    >
      <Field name="username">
        <FieldLabel>Username</FieldLabel>
        <Input required />
        <FieldError />
      </Field>
      <Button type="submit">Create account</Button>
    </Form>
  );
}

describe("Form part", () => {
  it("draws the form part around its fields", () => {
    render(<SignUp onSubmit={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "Username" });
    expect(input.closest("form")?.classList.contains("form")).toBe(true);
  });

  it("stops a submit its fields fail and shows why", async () => {
    const onSubmit = vi.fn();
    render(<SignUp onSubmit={onSubmit} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    });
    expect(onSubmit).not.toHaveBeenCalled();
    const input = screen.getByRole("textbox", { name: "Username" });
    expect(input.hasAttribute("data-invalid")).toBe(true);
    expect(document.querySelector(".field-error")).not.toBeNull();
  });

  it("submits its values and shows the server's errors through the field", async () => {
    const onSubmit = vi.fn();
    render(<SignUp onSubmit={onSubmit} />);
    const input = screen.getByRole("textbox", { name: "Username" });
    fireEvent.change(input, { target: { value: "ada" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    });
    expect(onSubmit).toHaveBeenCalledWith("ada");
    const error = screen.getByText("That username is taken.");
    expect(error.classList.contains("field-error")).toBe(true);
    expect(input.hasAttribute("data-invalid")).toBe(true);
    expect(input.getAttribute("aria-describedby")).toContain(error.id);
  });
});
