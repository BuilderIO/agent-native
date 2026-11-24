import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconAt } from "@tabler/icons-react";
import { useId } from "react";
import { expect, within } from "storybook/test";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "../../../src/ui/base-ui/field.js";
import { Input, InputSlot } from "../../../src/ui/base-ui/input.js";
import {
  Select,
  SelectPopup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../src/ui/base-ui/select.js";
import { TextArea } from "../../../src/ui/base-ui/text-area.js";
import guide from "./field.docs.md?raw";

const meta = {
  title: "Components/Field",
  parameters: { layout: "padded", docs: { description: { component: guide } } },
} satisfies Meta;

export default meta;

/** A label and control, with help text, an error, and disabled. */
export const States: StoryObj = {
  render: () => (
    <div className="flex w-80 flex-col gap-4">
      <Field>
        <FieldLabel>Name</FieldLabel>
        <Input defaultValue="Ada Lovelace" />
      </Field>
      <Field>
        <FieldLabel>Email</FieldLabel>
        <Input type="email" placeholder="you@example.com" />
        <FieldDescription>Receipts go here.</FieldDescription>
      </Field>
      <Field invalid>
        <FieldLabel>Handle</FieldLabel>
        <Input defaultValue="ada lovelace" />
        <FieldError match>Use letters, numbers and dashes.</FieldError>
      </Field>
      <Field disabled>
        <FieldLabel>Workspace</FieldLabel>
        <Input defaultValue="Analytical Engines" />
      </Field>
    </div>
  ),
};

const ROLES = [
  { value: "owner", label: "Owner" },
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
];

/** Each control a Field labels: an Input with a slot, a Text Area and a Select. */
export const Controls: StoryObj = {
  render: function Controls() {
    const roleLabel = useId();
    return (
      <div className="flex w-80 flex-col gap-4">
        <Field>
          <FieldLabel>Handle</FieldLabel>
          <Input defaultValue="ada">
            <InputSlot>
              <IconAt aria-hidden />
            </InputSlot>
          </Input>
        </Field>
        <Field>
          <FieldLabel>Bio</FieldLabel>
          <TextArea placeholder="A line about you" />
          <FieldDescription>Shown on your profile.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel id={roleLabel}>Role</FieldLabel>
          <Select
            aria-labelledby={roleLabel}
            items={ROLES}
            defaultValue="editor"
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {ROLES.map((role) => (
                <SelectItem key={role.value} value={role.value}>
                  {role.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
      </div>
    );
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const trigger = canvas.getByRole("combobox", { name: "Role" });
    await userEvent.click(trigger);
    const page = within(canvasElement.ownerDocument.body);
    const list = await page.findByRole("listbox", { name: "Role" });
    await userEvent.click(within(list).getByRole("option", { name: "Viewer" }));
    await expect(trigger).toHaveTextContent("Viewer");
  },
};
