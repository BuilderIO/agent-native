import {
  COLORS,
  CONTROL_SIZES,
  textAreaProps,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Field, FieldLabel } from "../../../src/ui/base-ui/field.js";
import { TextArea } from "../../../src/ui/base-ui/text-area.js";
import { propControls } from "../prop-controls.js";
import guide from "./text-area.docs.md?raw";

const controls = propControls(textAreaProps);

const VARIANTS = textAreaProps.variant.values;

const meta = {
  title: "Components/Text Area",
  component: TextArea,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: {
    ...controls.args,
    placeholder: "Add a note",
    disabled: false,
  },
  argTypes: controls.argTypes,
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TextArea>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The text area with the props from the controls. */
export const Playground: Story = { args: { "aria-label": "Notes" } };

/** md and sm share the Input's padding and type at each height. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {CONTROL_SIZES.map((size) => (
        <TextArea
          key={size}
          {...args}
          size={size}
          aria-label={`Size ${size}`}
          placeholder={`Size ${size}`}
        />
      ))}
    </div>
  ),
};

/** Each variant in every color. Surface keeps neutral edges in every color. */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {COLORS.map((color) => (
        <div key={color} className="flex items-start gap-3">
          {VARIANTS.map((variant) => (
            <TextArea
              key={variant}
              {...args}
              variant={variant}
              color={color}
              aria-label={`${variant} ${color}`}
              placeholder={variant}
            />
          ))}
          <span className="w-16 shrink-0 text-xs text-fg-muted">{color}</span>
        </div>
      ))}
    </div>
  ),
};

/** In a Field: empty, filled, invalid and disabled. */
export const States: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel>Notes</FieldLabel>
        <TextArea {...args} />
      </Field>
      <Field>
        <FieldLabel>Bio</FieldLabel>
        <TextArea
          {...args}
          defaultValue="Wrote the first program for the Analytical Engine."
        />
      </Field>
      <Field invalid>
        <FieldLabel>Summary</FieldLabel>
        <TextArea {...args} />
      </Field>
      <Field disabled>
        <FieldLabel>Archived</FieldLabel>
        <TextArea {...args} disabled defaultValue="Read only" />
      </Field>
    </div>
  ),
};
