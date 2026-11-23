import { COLORS, CONTROL_SIZES, inputProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconAt, IconSearch, IconX } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { expect } from "storybook/test";

import { IconButton } from "../../../src/ui/base-ui/button.js";
import { Input, InputSlot } from "../../../src/ui/base-ui/input.js";
import { propControls } from "../prop-controls.js";
import guide from "./input.docs.md?raw";

const controls = propControls(inputProps);

const VARIANTS = inputProps.variant.values;

const meta = {
  title: "Components/Input",
  component: Input,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: {
    ...controls.args,
    "aria-label": "Email",
    placeholder: "you@example.com",
    disabled: false,
  },
  argTypes: controls.argTypes,
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The input with the props from the controls. */
export const Playground: Story = {};

/** md and sm: the 24 and 20px control heights, with a leading icon. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {CONTROL_SIZES.map((size) => (
        <Input
          key={size}
          {...args}
          size={size}
          aria-label={`Size ${size}`}
          placeholder={`Size ${size}`}
        >
          <InputSlot>
            <IconSearch aria-hidden />
          </InputSlot>
        </Input>
      ))}
    </div>
  ),
};

/** Each variant in every color. Surface keeps neutral edges in every color. */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {COLORS.map((color) => (
        <div key={color} className="flex items-center gap-3">
          {VARIANTS.map((variant) => (
            <Input
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

/**
 * Slots before and after the text: an icon, a shortcut and a clear button.
 * An unmarked slot goes before the text; `side="right"` puts one after it.
 */
export const Slots: Story = {
  render: function Render(args) {
    const handle = useRef<HTMLInputElement>(null);
    const [value, setValue] = useState("ada");
    return (
      <div className="flex flex-col gap-3">
        <Input {...args} aria-label="Search" placeholder="Search">
          <InputSlot>
            <IconSearch aria-hidden />
          </InputSlot>
          <InputSlot side="right">⌘K</InputSlot>
        </Input>
        <Input
          ref={handle}
          {...args}
          aria-label="Handle"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        >
          <InputSlot>
            <IconAt aria-hidden />
          </InputSlot>
          <InputSlot side="right">
            <IconButton
              aria-label="Clear handle"
              type="button"
              disabled={args.disabled}
              onClick={() => {
                setValue("");
                handle.current?.focus();
              }}
              size="sm"
              variant="ghost"
              color="gray"
            >
              <IconX />
            </IconButton>
          </InputSlot>
        </Input>
        <Input {...args} aria-label="Width" defaultValue="320">
          <InputSlot side="right">px</InputSlot>
        </Input>
      </div>
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Clear handle" }));
    const input = canvas.getByRole("textbox", { name: "Handle" });
    await expect(input).toHaveValue("");
    await expect(input).toHaveFocus();
  },
};

/** A focusable slot keeps its own keyboard interaction inside the field. */
export const InteractiveSlot: Story = {
  render: (args) => (
    <Input {...args} aria-label="Distance" defaultValue="20">
      <InputSlot side="right">
        <select aria-label="Unit" defaultValue="px">
          <option>px</option>
          <option>em</option>
        </select>
      </InputSlot>
    </Input>
  ),
  play: async ({ canvas, userEvent }) => {
    const unit = canvas.getByRole("combobox", { name: "Unit" });
    await userEvent.click(unit);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    await expect(unit).toHaveFocus();
    await userEvent.selectOptions(unit, "em");
    await expect(unit).toHaveValue("em");
  },
};

/** Empty, filled, invalid and disabled, in each variant. */
export const States: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex flex-col gap-3">
          <Input {...args} variant={variant} aria-label={`${variant} empty`} />
          <Input
            {...args}
            variant={variant}
            aria-label={`${variant} filled`}
            defaultValue="ada@example.com"
          />
          <Input
            {...args}
            variant={variant}
            aria-label={`${variant} invalid`}
            aria-invalid
            defaultValue="ada@"
          />
          <Input
            {...args}
            variant={variant}
            aria-label={`${variant} disabled`}
            disabled
            defaultValue="Read only"
          >
            <InputSlot>
              <IconAt aria-hidden />
            </InputSlot>
          </Input>
        </div>
      ))}
    </div>
  ),
};
