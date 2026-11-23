import type { Meta, StoryObj } from "@storybook/react-vite";

import { Field, FieldLabel } from "../../../src/ui/base-ui/field.js";
import { Fieldset, FieldsetLegend } from "../../../src/ui/base-ui/fieldset.js";
import { Input } from "../../../src/ui/base-ui/input.js";
import guide from "./fieldset.docs.md?raw";

const meta = {
  title: "Components/Fieldset",
  parameters: { layout: "padded", docs: { description: { component: guide } } },
} satisfies Meta;

export default meta;

/** Fields grouped under one legend. */
export const States: StoryObj = {
  render: () => (
    <div className="w-80">
      <Fieldset>
        <FieldsetLegend>Billing address</FieldsetLegend>
        <Field>
          <FieldLabel>Street</FieldLabel>
          <Input defaultValue="12 Marylebone Road" />
        </Field>
        <Field>
          <FieldLabel>City</FieldLabel>
          <Input defaultValue="London" />
        </Field>
      </Fieldset>
    </div>
  ),
};
