import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconAt } from "@tabler/icons-react";

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

const meta = {
  title: "Components/Field",
  parameters: { layout: "padded" },
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
  render: () => (
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
        <FieldLabel>Role</FieldLabel>
        <Select items={ROLES} defaultValue="editor">
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
  ),
};
