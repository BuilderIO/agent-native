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
import { expect, waitFor, within } from "storybook/test";

import { Button } from "../../../src/ui/base-ui/button.js";
import {
  Dialog,
  DialogPopup,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../../../src/ui/base-ui/dialog.js";
import { Field, FieldLabel } from "../../../src/ui/base-ui/field.js";
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
import { ThemeProvider } from "../../../src/ui/base-ui/theme-provider.js";
import { propControls } from "../prop-controls.js";
import guide from "./select.docs.md?raw";

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
        {ITEMS.slice(0, 2).map((item) => (
          <SelectItem
            key={item.value}
            value={item.value}
            className={({ selected }) =>
              selected ? "font-semibold" : undefined
            }
          >
            {item.label}
          </SelectItem>
        ))}
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
  defaultValue = "doing",
  invalid = false,
  ...trigger
}: Args & { label: string; defaultValue?: string | null; invalid?: boolean }) {
  return (
    <Select
      aria-label={label}
      items={ITEMS}
      defaultValue={defaultValue}
      disabled={trigger.disabled}
      {...(size === undefined ? {} : { size })}
    >
      <SelectTrigger aria-invalid={invalid || undefined} {...trigger}>
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
        aria-label={label}
        items={ITEMS}
        defaultValue="doing"
        open
        onOpenChange={noop}
        modal={false}
      >
        <SelectTrigger>
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

function NestedInDialog({ appearance }: { appearance: "light" | "dark" }) {
  return (
    <ThemeProvider density="comfortable">
      <Dialog>
        <DialogTrigger render={<Button variant="surface" color="gray" />}>
          Open dialog
        </DialogTrigger>
        <DialogPopup>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>
            The list opens above this dialog.
          </DialogDescription>
          <ThemeProvider
            appearance={appearance}
            density="compact"
            appTheme="design"
            className="rounded-lg bg-surface-canvas p-2 text-fg"
          >
            <Select aria-label="Status" items={ITEMS} defaultValue={null}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a status" />
              </SelectTrigger>
              <SelectPopup>
                <Items />
              </SelectPopup>
            </Select>
          </ThemeProvider>
        </DialogPopup>
      </Dialog>
    </ThemeProvider>
  );
}

const meta = {
  title: "Components/Select",
  parameters: { layout: "padded", docs: { description: { component: guide } } },
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
export const Playground: Story = {
  play: async ({ canvas, canvasElement, userEvent, args }) => {
    const trigger = canvas.getByRole("combobox", { name: "Status" });
    if (args.disabled) {
      await expect(trigger).toBeDisabled();
      return;
    }
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.tab();
    await expect(trigger).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    const chosen = await page.findByRole("option", { name: "Doing" });
    await waitFor(() => expect(chosen).toHaveFocus());
    await userEvent.keyboard("{Home}");
    const candidate = page.getByRole("option", { name: "To do" });
    await waitFor(() => expect(candidate).toHaveAttribute("data-highlighted"));
    await expect(chosen).toHaveAttribute("aria-selected", "true");
    await expect(candidate).toHaveAttribute("aria-selected", "false");
    await expect(chosen).toHaveClass("select-item", "font-semibold");
    await expect(candidate).not.toHaveClass("font-semibold");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(trigger).toHaveTextContent("Doing");
    await userEvent.click(trigger);
    await userEvent.click(await page.findByRole("option", { name: "To do" }));
    await expect(trigger).toHaveTextContent("To do");
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    const current = await page.findByRole("option", { name: "To do" });
    await expect(current).toHaveClass("font-semibold");
    await waitFor(() => expect(current).toHaveFocus());
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(page.getByRole("option", { name: "Doing" })).toHaveFocus(),
    );
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(trigger).toHaveTextContent("Doing");
  },
};

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
      <Status {...args} label="Placeholder" defaultValue={null} />
      <Status {...args} label="Value" />
      <Status {...args} label="Invalid" defaultValue={null} invalid />
      <Status {...args} label="Disabled" disabled />
    </div>
  ),
};

/** A select inside a dialog: its list opens above the dialog. */
export const InsideDialog: Story = {
  render: (_, { globals }) => (
    <NestedInDialog
      appearance={globals.appearance === "dark" ? "light" : "dark"}
    />
  ),
  play: async ({ canvas, userEvent, globals }) => {
    const open = canvas.getByRole("button", { name: "Open dialog" });
    await userEvent.click(open);
    const dialog = await canvas.findByRole("dialog", { name: "Edit task" });
    const trigger = within(dialog).getByRole("combobox", { name: "Status" });
    await userEvent.click(trigger);
    const list = await within(dialog).findByRole("listbox", { name: "Status" });
    const option = within(list).getByRole("option", { name: "Doing" });
    await expect(getComputedStyle(dialog).colorScheme).toBe(globals.appearance);
    await expect(getComputedStyle(option).colorScheme).toBe(
      globals.appearance === "dark" ? "light" : "dark",
    );
    await expect(trigger.offsetHeight).toBe(24);
    await expect(option.offsetHeight).toBe(32);
    await expect(getComputedStyle(option).gap).toBe("4px");
    await expect(getComputedStyle(open).gap).toBe("8px");
    const hitOption = () => {
      const box = option.getBoundingClientRect();
      return option.contains(
        option.ownerDocument.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        ),
      );
    };
    await waitFor(() => expect(hitOption()).toBe(true));
    await userEvent.click(option);
    await userEvent.keyboard("{Enter}");
    await expect(trigger).toHaveTextContent("Doing");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await within(dialog).findByRole("listbox", { name: "Status" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(open).toHaveFocus());
  },
};

/** A visible field label names the trigger and the portaled list. */
export const LabeledField: Story = {
  render: function TaskStatusField({ size, disabled, ...triggerProps }) {
    const labelId = React.useId();
    const initialStatus = ITEMS[0].value;
    const [status, setStatus] = React.useState<string | null>(initialStatus);
    return (
      <form onReset={() => setStatus(initialStatus)}>
        <Field name="status" disabled={disabled}>
          <FieldLabel id={labelId}>Task status</FieldLabel>
          <Select
            items={ITEMS}
            aria-labelledby={labelId}
            value={status}
            onValueChange={setStatus}
            size={size}
          >
            <SelectTrigger {...triggerProps}>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <Items />
            </SelectPopup>
          </Select>
        </Field>
        <Button type="reset" variant="surface">
          Reset status
        </Button>
      </form>
    );
  },
  play: async ({ canvas, canvasElement, userEvent, args }) => {
    const trigger = canvas.getByRole("combobox", { name: "Task status" });
    const form = trigger.closest("form");
    if (!form) throw new Error("Expected a form");
    const label = canvas.getByText<HTMLLabelElement>("Task status");
    await expect(label.control).toBe(trigger);
    if (args.disabled) {
      await expect(trigger).toBeDisabled();
      await expect(new FormData(form).has("status")).toBe(false);
      return;
    }
    await expect(new FormData(form).get("status")).toBe("todo");
    await userEvent.click(trigger);
    const list = await within(canvasElement.ownerDocument.body).findByRole(
      "listbox",
      { name: "Task status" },
    );
    await userEvent.click(within(list).getByRole("option", { name: "Doing" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(trigger).toHaveAccessibleName("Task status");
    await expect(trigger).toHaveTextContent("Doing");
    await expect(new FormData(form).get("status")).toBe("doing");
    await userEvent.click(canvas.getByRole("button", { name: "Reset status" }));
    await expect(trigger).toHaveTextContent("To do");
    await expect(new FormData(form).get("status")).toBe("todo");
  },
};

const formats = [
  { value: "svg", label: "SVG" },
  { value: "png", label: "PNG" },
  { value: "pdf", label: "PDF" },
];

/** Choose several export formats and submit each under the same field name. */
export const Multiple: Story = {
  render: function ExportFormats({ size, disabled, ...triggerProps }) {
    const labelId = React.useId();
    return (
      <form className="w-44">
        <Field name="format" disabled={disabled}>
          <FieldLabel id={labelId}>Export formats</FieldLabel>
          <Select
            multiple
            items={formats}
            aria-labelledby={labelId}
            size={size}
          >
            <SelectTrigger {...triggerProps}>
              <SelectValue placeholder="Choose formats" />
            </SelectTrigger>
            <SelectPopup>
              {formats.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
      </form>
    );
  },
  play: async ({ canvas, canvasElement, userEvent, args }) => {
    const trigger = canvas.getByRole("combobox", { name: "Export formats" });
    const form = trigger.closest("form");
    if (!form) throw new Error("Expected a form");
    const values = () => new FormData(form).getAll("format");
    await expect(values()).toEqual([]);
    await expect(trigger).toHaveTextContent("Choose formats");
    if (args.disabled) {
      await expect(trigger).toBeDisabled();
      return;
    }
    await userEvent.click(trigger);
    const list = await within(canvasElement.ownerDocument.body).findByRole(
      "listbox",
      { name: "Export formats" },
    );
    await expect(list).toHaveAttribute("aria-multiselectable", "true");
    const svg = within(list).getByRole("option", { name: "SVG" });
    const png = within(list).getByRole("option", { name: "PNG" });
    await userEvent.click(svg);
    await userEvent.click(png);
    await expect(svg).toHaveAttribute("aria-selected", "true");
    await expect(png).toHaveAttribute("aria-selected", "true");
    await expect(values()).toEqual(["svg", "png"]);
    await expect(trigger).toHaveTextContent("SVG");
    await expect(trigger).toHaveTextContent("PNG");
    await userEvent.keyboard("{Home}");
    await waitFor(() => expect(svg).toHaveFocus());
    await userEvent.keyboard(" ");
    await expect(svg).toHaveAttribute("aria-selected", "false");
    await expect(values()).toEqual(["png"]);
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(png).toHaveFocus());
    await userEvent.keyboard(" ");
    await expect(values()).toEqual([]);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(trigger).toHaveTextContent("Choose formats");
  },
};
