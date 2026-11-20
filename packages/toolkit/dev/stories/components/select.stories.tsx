import {
  COLORS,
  CONTROL_SIZES,
  selectPopupProps,
  type SelectRootOwnProps,
  selectRootProps,
  type SelectTriggerOwnProps,
  selectTriggerProps,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import { Button } from "../../../src/ui/base-ui/button.js";
import {
  Dialog,
  DialogPopup,
  DialogDescription,
  DialogTitle,
} from "../../../src/ui/base-ui/dialog.js";
import {
  Select,
  SelectPopup,
  type SelectPopupProps,
  SelectGroup,
  SelectItem,
  SelectGroupLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../../../src/ui/base-ui/select.js";
import { propControls } from "../prop-controls.js";

type Args = SelectRootOwnProps & SelectTriggerOwnProps & { disabled?: boolean };

const controls = propControls({ ...selectRootProps, ...selectTriggerProps });

const TRIGGER_VARIANTS = selectTriggerProps.variant.values;
const POPUP_VARIANTS = selectPopupProps.variant.values;

const ITEMS = [
  { value: "todo", label: "To do" },
  { value: "doing", label: "Doing" },
  { value: "done", label: "Done" },
];

const noop = () => {};

function Items() {
  return (
    <>
      <SelectGroup>
        <SelectGroupLabel>Open</SelectGroupLabel>
        <SelectItem value="todo">To do</SelectItem>
        <SelectItem value="doing">Doing</SelectItem>
      </SelectGroup>
      <SelectSeparator />
      <SelectItem value="done" disabled>
        Done
      </SelectItem>
    </>
  );
}

function Status({
  size,
  label,
  value = "doing",
  invalid = false,
  ...trigger
}: Args & { label: string; value?: string | null; invalid?: boolean }) {
  return (
    <Select
      items={ITEMS}
      value={value}
      onValueChange={noop}
      disabled={trigger.disabled}
      {...(size === undefined ? {} : { size })}
    >
      <SelectTrigger
        aria-label={label}
        aria-invalid={invalid || undefined}
        {...trigger}
      >
        <SelectValue placeholder="Pick a status" />
      </SelectTrigger>
      <SelectPopup>
        <Items />
      </SelectPopup>
    </Select>
  );
}

function OpenList(
  props: Pick<SelectPopupProps, "variant" | "color" | "highContrast"> & {
    label: string;
  },
) {
  const { label, ...popup } = props;
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  return (
    <div className="flex w-44 flex-col gap-1">
      <span className="text-xs text-fg-muted">{label}</span>
      <Select
        items={ITEMS}
        value="doing"
        onValueChange={noop}
        open
        onOpenChange={noop}
        modal={false}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        {container ? (
          <SelectPopup {...popup} container={container} finalFocus={false}>
            <Items />
          </SelectPopup>
        ) : null}
      </Select>
      <div ref={setContainer} className="h-40" />
    </div>
  );
}

function NestedInDialog() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex items-center gap-3">
      <Button variant="surface" color="gray" onClick={() => setOpen(true)}>
        Open dialog
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>
            The list opens above this dialog.
          </DialogDescription>
          <Select items={ITEMS} defaultValue={null}>
            <SelectTrigger aria-label="Status">
              <SelectValue placeholder="Pick a status" />
            </SelectTrigger>
            <SelectPopup>
              <Items />
            </SelectPopup>
          </Select>
        </DialogPopup>
      </Dialog>
    </div>
  );
}

const meta = {
  title: "Components/Select",
  parameters: { layout: "padded" },
  args: { ...controls.args, disabled: false },
  argTypes: controls.argTypes,
  render: (args) => (
    <div className="w-56">
      <Status {...args} label="Status" />
    </div>
  ),
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The select with the root's and the trigger's props from the controls. */
export const Playground: Story = {};

/** md and sm: the 24 and 20px control heights. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex w-56 flex-col items-start gap-3">
      {CONTROL_SIZES.map((size) => (
        <Status key={size} {...args} size={size} label={`Size ${size}`} />
      ))}
    </div>
  ),
};

/** Each trigger variant in every color. Surface keeps neutral edges. */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {COLORS.map((color) => (
        <div key={color} className="flex items-center gap-3">
          {TRIGGER_VARIANTS.map((variant) => (
            <div key={variant} className="w-36">
              <Status
                {...args}
                variant={variant}
                color={color}
                label={`${variant} ${color}`}
              />
            </div>
          ))}
          <span className="text-xs text-fg-muted">{color}</span>
        </div>
      ))}
    </div>
  ),
};

/** The popup's variants fill the highlighted row; then in high contrast. */
export const PopupVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {[false, true].map((highContrast) =>
        POPUP_VARIANTS.map((variant) => (
          <div
            key={`${variant}-${String(highContrast)}`}
            className="flex gap-3"
          >
            {(["accent", "gray"] as const).map((color) => (
              <OpenList
                key={color}
                variant={variant}
                color={color}
                highContrast={highContrast}
                label={`${variant} ${color}${highContrast ? ", high contrast" : ""}`}
              />
            ))}
          </div>
        )),
      )}
    </div>
  ),
};

/** Placeholder, value, invalid and disabled. */
export const States: Story = {
  render: (args) => (
    <div className="flex w-56 flex-col items-start gap-3">
      <Status {...args} label="Placeholder" value={null} />
      <Status {...args} label="Value" />
      <Status {...args} label="Invalid" value={null} invalid />
      <Status {...args} label="Disabled" disabled />
    </div>
  ),
};

/** A select inside a dialog: its list opens above the dialog. */
export const InsideDialog: Story = {
  render: () => <NestedInDialog />,
};
