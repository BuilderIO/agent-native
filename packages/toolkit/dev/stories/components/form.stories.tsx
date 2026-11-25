import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import { Button } from "../../../src/ui/base-ui/button.js";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "../../../src/ui/base-ui/field.js";
import { Fieldset, FieldsetLegend } from "../../../src/ui/base-ui/fieldset.js";
import { Form, type FormProps } from "../../../src/ui/base-ui/form.js";
import { Input } from "../../../src/ui/base-ui/input.js";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldIncrement,
} from "../../../src/ui/base-ui/number-field.js";
import guide from "./form.docs.md?raw";

const meta = {
  title: "Components/Form",
  component: Form,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Form>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Fields and a fieldset stacked a step apart, with the form's button. */
export const Playground: Story = {
  render: (args) => (
    <Form {...args} onFormSubmit={() => {}}>
      <Field name="name">
        <FieldLabel>Workspace name</FieldLabel>
        <Input defaultValue="Acme" />
      </Field>
      <Fieldset>
        <FieldsetLegend>Seats</FieldsetLegend>
        <Field name="seats">
          <FieldLabel>Members</FieldLabel>
          <NumberField defaultValue={5} min={1}>
            <NumberFieldDecrement />
            <NumberFieldIncrement />
          </NumberField>
          <FieldDescription>Billed monthly per member.</FieldDescription>
        </Field>
      </Fieldset>
      <div>
        <Button type="submit">Save</Button>
      </div>
    </Form>
  ),
};

/**
 * Submitting checks each field first: an empty or malformed field shows
 * its error and stops the submit. A submit that passes goes to the server,
 * whose answer comes back as `errors` keyed by field name and shows
 * through the same `FieldError`. Here "ada" is already taken.
 */
export const WithValidation: Story = {
  render: function WithValidation(args) {
    const [errors, setErrors] = React.useState<FormProps["errors"]>({});
    const [saving, setSaving] = React.useState(false);
    return (
      <Form
        {...args}
        errors={errors}
        onFormSubmit={(values) => {
          setSaving(true);
          setTimeout(() => {
            setSaving(false);
            setErrors(
              values.username === "ada"
                ? { username: "That username is taken." }
                : {},
            );
          }, 600);
        }}
      >
        <Field
          name="username"
          validate={(value) => {
            if (typeof value !== "string" || value === "") {
              return "Enter a username.";
            }
            return value.length < 3 ? "Use at least 3 characters." : null;
          }}
        >
          <FieldLabel>Username</FieldLabel>
          <Input defaultValue="ada" />
          <FieldError />
        </Field>
        <Field name="email">
          <FieldLabel>Email</FieldLabel>
          <Input type="email" required placeholder="you@example.com" />
          <FieldError />
        </Field>
        <div>
          <Button type="submit" loading={saving}>
            Create account
          </Button>
        </div>
      </Form>
    );
  },
};
