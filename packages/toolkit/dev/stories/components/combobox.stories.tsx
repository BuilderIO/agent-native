import {
  COLORS,
  type ComboboxOwnProps,
  comboboxPopupProps,
  comboboxProps,
  CONTROL_SIZES,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, waitFor, within } from "storybook/test";

import { Button } from "../../../src/ui/base-ui/button.js";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxClear,
  ComboboxCollection,
  createComboboxItems,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxPopup,
  type ComboboxPopupProps,
  ComboboxSeparator,
  ComboboxStatus,
  ComboboxTrigger,
  ComboboxValue,
} from "../../../src/ui/base-ui/combobox.js";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../../../src/ui/base-ui/dialog.js";
import { InputSlot } from "../../../src/ui/base-ui/input.js";
import {
  Popover,
  PopoverTrigger,
  PopoverPopup,
  PopoverTitle,
} from "../../../src/ui/base-ui/popover.js";
import { searchDelay, useAsyncOptions } from "../async-options.js";
import { propControls } from "../prop-controls.js";
import guide from "./combobox.docs.md?raw";

type Args = ComboboxOwnProps & { disabled?: boolean };

const controls = propControls(comboboxProps);

const VARIANTS = comboboxProps.variant.values;
const POPUP_VARIANTS = comboboxPopupProps.variant.values;

interface TimeZone {
  value: string;
  label: string;
}

const ZONES: TimeZone[] = [
  { value: "America/Los_Angeles", label: "Los Angeles" },
  { value: "America/Denver", label: "Denver" },
  { value: "America/Chicago", label: "Chicago" },
  { value: "America/New_York", label: "New York" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Asia/Kolkata", label: "Kolkata" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Australia/Sydney", label: "Sydney" },
];

const REGIONS = [
  { value: "Americas", items: ZONES.slice(0, 4) },
  { value: "Europe", items: ZONES.slice(4, 7) },
  { value: "Asia Pacific", items: ZONES.slice(7) },
];

const regionItems = createComboboxItems(REGIONS, {
  getValue: (zone: TimeZone) => zone.value,
  getLabel: (zone) => zone.label,
});

function Rows(
  props: Pick<ComboboxPopupProps, "variant" | "color" | "highContrast">,
) {
  return (
    <ComboboxList {...props}>
      {(zone: TimeZone) => (
        <ComboboxItem key={zone.value} value={zone}>
          {zone.label}
        </ComboboxItem>
      )}
    </ComboboxList>
  );
}

function Controls() {
  return (
    <InputSlot side="right">
      <ComboboxClear />
      <ComboboxTrigger />
    </InputSlot>
  );
}

function TimeZonePicker({
  label,
  disabled,
  defaultValue = ZONES[4] ?? null,
  ...input
}: Args & { label: string; defaultValue?: TimeZone | null }) {
  return (
    <Combobox
      aria-label={label}
      items={ZONES}
      defaultValue={defaultValue}
      {...(disabled ? { disabled } : {})}
    >
      <ComboboxInput placeholder="Pick a time zone" {...input}>
        <Controls />
      </ComboboxInput>
      <ComboboxPopup>
        <ComboboxEmpty>No time zones found.</ComboboxEmpty>
        <Rows />
      </ComboboxPopup>
    </Combobox>
  );
}

function PopupExample({
  disabled,
  label,
  ...popup
}: Pick<ComboboxPopupProps, "variant" | "color" | "highContrast"> & {
  disabled?: boolean;
  label: string;
}) {
  const id = React.useId();
  return (
    <div className="flex w-44 flex-col gap-1">
      <label id={id} htmlFor={id + "-input"} className="text-xs text-fg-muted">
        {label}
      </label>
      <Combobox
        aria-labelledby={id}
        disabled={disabled}
        items={ZONES.slice(0, 4)}
        defaultValue={ZONES[1] ?? null}
        openOnInputClick
        autoHighlight
      >
        <ComboboxInput id={id + "-input"} />
        <ComboboxPopup {...popup}>
          <Rows />
        </ComboboxPopup>
      </Combobox>
    </div>
  );
}

const meta = {
  title: "Components/Combobox",
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, disabled: false },
  argTypes: controls.argTypes,
  render: (args) => (
    <div className="w-64">
      <TimeZonePicker {...args} label="Time zone" />
    </div>
  ),
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;
type StoryArgs = Parameters<NonNullable<Story["render"]>>[0];

/** A select you can type into. The input takes the controls. */
export const Playground: Story = {};

/** A persistent list lets people browse options alongside other settings. */
export const Inline: Story = {
  render: (args) => (
    <div className="flex w-64 flex-col gap-2">
      <Combobox
        disabled={args.disabled}
        aria-label="Time zone"
        items={ZONES}
        inline
        open
      >
        <ComboboxInput {...args} placeholder="Filter time zones" />
        <ComboboxEmpty>No time zones found.</ComboboxEmpty>
        <Rows variant="solid" color="accent" highContrast />
      </Combobox>
      <Button variant="surface">Apply time zone</Button>
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole("combobox", { name: "Time zone" });
    const list = canvas.getByRole("listbox", { name: "Time zone" });
    await expect(list).toHaveAttribute("data-variant", "solid");
    await expect(list).toHaveAttribute("data-color", "accent");
    await expect(list).toHaveAttribute("data-high-contrast");
    await userEvent.click(input);
    await userEvent.type(input, "Tokyo");
    await expect(input).toHaveAttribute("aria-controls", list.id);
    await userEvent.keyboard("{ArrowDown}");
    await expect(input).toHaveFocus();
    const highlighted = within(list).getByRole("option", { name: "Tokyo" });
    await expect(highlighted.id).not.toBe("");
    await expect(input).toHaveAttribute(
      "aria-activedescendant",
      highlighted.id,
    );
    await userEvent.keyboard("{Enter}");
    await expect(
      within(list).getByRole("option", { name: "Tokyo" }),
    ).toHaveAttribute("aria-selected", "true");
    await userEvent.tab();
    await expect(
      canvas.getByRole("button", { name: "Apply time zone" }),
    ).toHaveFocus();
    await expect(list).toBeVisible();
  },
};

export const LargeCatalog: Story = {
  render: function AssetPicker({ disabled, ...input }) {
    const assets = React.useMemo(
      () =>
        Array.from(
          { length: 10_000 },
          (_, index) => `Asset ${String(index + 1).padStart(5, "0")}`,
        ),
      [],
    );
    return (
      <div className="w-64">
        <Combobox
          aria-label="Asset"
          items={assets}
          limit={20}
          disabled={disabled}
          openOnInputClick
        >
          <ComboboxInput {...input} placeholder="Find an asset" />
          <ComboboxPopup>
            <ComboboxEmpty>No matching assets.</ComboboxEmpty>
            <ComboboxList>
              {(asset: string) => (
                <ComboboxItem key={asset} value={asset}>
                  {asset}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxPopup>
        </Combobox>
      </div>
    );
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const input = canvas.getByRole("combobox", { name: "Asset" });
    await userEvent.click(input);
    const page = within(canvasElement.ownerDocument.body);
    const list = await page.findByRole("listbox", { name: "Asset" });
    await expect(within(list).getAllByRole("option")).toHaveLength(20);
    await userEvent.type(input, "10000");
    const match = within(list).getByRole("option", { name: "Asset 10000" });
    await expect(within(list).getAllByRole("option")).toHaveLength(1);
    await userEvent.keyboard("{ArrowDown}");
    await expect(input).toHaveAttribute("aria-activedescendant", match.id);
    await userEvent.keyboard("{Enter}");
    await expect(input).toHaveValue("Asset 10000");
    await expect(input).toHaveAttribute("aria-expanded", "false");
  },
};

export const DisabledInline: Story = {
  render: Inline.render,
  args: { disabled: true },
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole("combobox", { name: "Time zone" });
    const option = canvas.getByRole("option", { name: "Tokyo" });
    await expect(input).toBeDisabled();
    await expect(option).toHaveAttribute("aria-disabled", "true");
    await expect(getComputedStyle(option).pointerEvents).toBe("none");
    await expect(option).toHaveAttribute("aria-selected", "false");
    await userEvent.tab();
    await expect(
      canvas.getByRole("button", { name: "Apply time zone" }),
    ).toHaveFocus();
  },
};

/** md and sm: the field is Input's, and the rows follow its size. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex w-64 flex-col gap-3">
      {CONTROL_SIZES.map((size) => (
        <TimeZonePicker
          key={size}
          {...args}
          size={size}
          label={`Size ${size}`}
        />
      ))}
    </div>
  ),
};

/**
 * The input's variants in every color, then the popup's variants, which
 * fill the highlighted row, in gray and the accent and in high contrast.
 */
export const Variants: Story = {
  parameters: {
    a11y: {
      config: { rules: [{ id: "aria-hidden-focus", reviewOnFail: true }] },
    },
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const name = POPUP_VARIANTS[0] + " accent, high contrast";
    const input = canvas.getByRole("combobox", { name });
    const fields = canvas.getAllByRole("combobox");
    const index = fields.indexOf(input);
    const previous = index > 0 ? fields.at(index - 1) : undefined;
    const next = fields.at(index + 1);
    if (!previous || !next) throw new Error("Expected adjacent variant fields");
    await userEvent.click(input);
    const page = within(canvasElement.ownerDocument.body);
    const list = await page.findByRole("listbox", { name });
    await expect(within(list).getAllByRole("option").length).toBeGreaterThan(0);
    for (const [from, to] of [
      [input, next],
      [next, input],
    ] as const) {
      await userEvent.click(to);
      await waitFor(() =>
        expect(from).toHaveAttribute("aria-expanded", "false"),
      );
      await expect(to).toHaveFocus();
      await expect(to).toHaveAttribute(
        "aria-controls",
        (await page.findByRole("listbox")).id,
      );
      await expect(to.closest('[aria-hidden="true"]')).toBeNull();
    }
    for (const [tab, target] of [
      ["{Tab}", next],
      ["{Shift>}{Tab}{/Shift}", previous],
    ] as const) {
      await userEvent.click(input);
      if (input.getAttribute("aria-expanded") !== "true") {
        await userEvent.keyboard("{ArrowDown}");
      }
      await userEvent.keyboard(tab);
      await waitFor(() =>
        expect(input).toHaveAttribute("aria-expanded", "false"),
      );
      await expect(target).toHaveFocus();
      await expect(target.closest('[aria-hidden="true"]')).toBeNull();
    }
    await userEvent.click(input);
    await page.findByRole("listbox", { name });
  },
  render: (args) => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {COLORS.map((color) => (
          <div key={color} className="flex items-center gap-3">
            {VARIANTS.map((variant) => (
              <div key={variant} className="w-48">
                <TimeZonePicker
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
      {[false, true].map((highContrast) => (
        <div key={String(highContrast)} className="flex gap-3">
          {POPUP_VARIANTS.flatMap((variant) =>
            (["gray", "accent"] as const).map((color) => (
              <PopupExample
                disabled={args.disabled}
                key={`${variant}-${color}`}
                variant={variant}
                color={color}
                highContrast={highContrast}
                label={`${variant} ${color}${highContrast ? ", high contrast" : ""}`}
              />
            )),
          )}
        </div>
      ))}
    </div>
  ),
};

/** Values grouped by region, with labels and separators. */
export const Groups: Story = {
  render: (args) => (
    <form aria-label="Regional time zones" className="w-64">
      <Combobox
        disabled={args.disabled}
        aria-label="Time zone"
        items={regionItems}
        name="zone"
        defaultValue="Europe/Paris"
      >
        <ComboboxInput {...args} placeholder="Pick a time zone">
          <Controls />
        </ComboboxInput>
        <ComboboxPopup>
          <ComboboxEmpty>No time zones found.</ComboboxEmpty>
          <ComboboxList>
            {(region: (typeof REGIONS)[number], index: number) => (
              <ComboboxGroup key={region.value} items={region.items}>
                {index > 0 ? <ComboboxSeparator /> : null}
                <ComboboxGroupLabel>{region.value}</ComboboxGroupLabel>
                <ComboboxCollection>
                  {(zone: TimeZone) => (
                    <ComboboxItem key={zone.value} value={zone.value}>
                      {zone.label}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
    </form>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const form = canvas.getByRole<HTMLFormElement>("form", {
      name: "Regional time zones",
    });
    const input = canvas.getByRole("combobox", { name: "Time zone" });
    await expect(input).toHaveValue("Paris");
    await expect(new FormData(form).get("zone")).toBe("Europe/Paris");
    await userEvent.clear(input);
    await userEvent.type(input, "Tok");
    const list = await within(canvasElement.ownerDocument.body).findByRole(
      "listbox",
    );
    const group = within(list).getByRole("group", { name: "Asia Pacific" });
    await expect(within(group).getAllByRole("option")).toHaveLength(1);
    await waitFor(() =>
      expect(
        within(group).getByRole("option", { name: "Tokyo" }),
      ).toBeVisible(),
    );
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(input).toHaveValue("Tokyo");
    await expect(new FormData(form).get("zone")).toBe("Asia/Tokyo");
  },
};

function EmptyStory(args: StoryArgs) {
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  return (
    <div className="flex w-64 flex-col gap-1">
      <Combobox
        disabled={args.disabled}
        aria-label="Time zone"
        items={ZONES}
        open
        defaultInputValue="Atlantis"
      >
        <ComboboxInput {...args} />
        {container ? (
          <ComboboxPopup container={container}>
            <ComboboxEmpty>No time zones found.</ComboboxEmpty>
            <Rows />
          </ComboboxPopup>
        ) : null}
      </Combobox>
      <div ref={setContainer} className="h-24" />
    </div>
  );
}
/** A query that matches nothing: the popup says so. */
export const Empty: Story = {
  render: (args) => <EmptyStory {...args} />,
};

async function searchZones(
  query: string,
  signal: AbortSignal,
): Promise<TimeZone[]> {
  await searchDelay(signal, 600);
  const needle = query.toLowerCase();
  return ZONES.filter((zone) => zone.label.toLowerCase().includes(needle));
}

function AsyncFilteringStory(args: StoryArgs) {
  const [selected, setSelected] = React.useState<TimeZone | null>(null);
  const { results, status, search } = useAsyncOptions(searchZones, 150);
  const items = React.useMemo(
    () =>
      selected === null || results.some((zone) => zone.value === selected.value)
        ? results
        : [selected, ...results],
    [results, selected],
  );

  return (
    <div className="w-64">
      <Combobox
        disabled={args.disabled}
        aria-label="Time zone"
        items={items}
        filteredItems={results}
        filter={null}
        value={selected}
        onValueChange={setSelected}
        onInputValueChange={(query, { reason }) => {
          if (
            reason === "input-change" ||
            reason === "clear-press" ||
            reason === "input-clear"
          )
            void search(query);
        }}
        isItemEqualToValue={(item, value) => item.value === value.value}
      >
        <ComboboxInput {...args} placeholder="Search time zones">
          <Controls />
        </ComboboxInput>
        <ComboboxPopup>
          <ComboboxStatus>
            {status === "pending"
              ? "Searching…"
              : status === "error"
                ? "Search failed. Try again."
                : null}
          </ComboboxStatus>
          <ComboboxEmpty>
            {status === "ready" ? "No time zones found." : null}
          </ComboboxEmpty>
          <Rows />
        </ComboboxPopup>
      </Combobox>
    </div>
  );
}
/**
 * Values from a server: `filter={null}` turns off local filtering, the
 * selected value stays in `items` so its label holds, and the status says
 * what the list is waiting for.
 */
export const AsyncFiltering: Story = {
  render: (args) => <AsyncFilteringStory {...args} />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const input = canvas.getByRole("combobox", { name: "Time zone" });
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.type(input, "Lon");
    await expect(
      await page.findByRole("option", { name: "London" }),
    ).toBeVisible();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(input).toHaveValue("London"));
    await userEvent.clear(input);
    await userEvent.type(input, "Tok");
    await expect(page.queryByRole("option", { name: "London" })).toBeNull();
    await expect(
      await page.findByRole("option", { name: "Tokyo" }),
    ).toBeVisible();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(input).toHaveValue("Tokyo"));
    await waitFor(() =>
      expect(input).toHaveAttribute("aria-expanded", "false"),
    );
  },
};

function TimeZoneChips() {
  return (
    <ComboboxChips>
      {(value: TimeZone[]) =>
        value.map((zone) => (
          <ComboboxChip key={zone.value}>{zone.label}</ComboboxChip>
        ))
      }
    </ComboboxChips>
  );
}

/**
 * `multiple`: each selected value is a chip before the text, and the field
 * grows to hold them. Backspace in an empty field removes the last chip;
 * the arrow keys move into the chips.
 */
export const Multiple: Story = {
  render: ({ disabled, ...args }) => (
    <div className="flex w-80 flex-col gap-3">
      {CONTROL_SIZES.map((size) => (
        <Combobox
          aria-label={`Time zones, size ${size}`}
          key={size}
          items={ZONES}
          disabled={disabled}
          multiple
          defaultValue={ZONES.slice(3, 7)}
        >
          <ComboboxInput
            {...args}
            size={size}
            chips={<TimeZoneChips />}
            placeholder="Add a time zone"
          >
            <Controls />
          </ComboboxInput>
          <ComboboxPopup>
            <ComboboxEmpty>No time zones found.</ComboboxEmpty>
            <Rows />
          </ComboboxPopup>
        </Combobox>
      ))}
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole("combobox", { name: "Time zones, size md" });
    const group = input.closest<HTMLElement>('[role="toolbar"]');
    if (!group) throw new Error("Missing selected time zones");
    const selected = within(group);
    input.focus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect(selected.getByRole("group", { name: "Berlin" })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(input).toHaveFocus();
    await userEvent.keyboard("{Backspace}");
    await expect(selected.queryByText("Berlin")).toBeNull();
    await expect(input).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    await expect(selected.getByRole("group", { name: "London" })).toHaveFocus();
    await userEvent.keyboard("{Delete}");
    await expect(selected.getByRole("group", { name: "Paris" })).toHaveFocus();
    await userEvent.keyboard("{Backspace}");
    await expect(
      selected.getByRole("group", { name: "New York" }),
    ).toHaveFocus();
    await userEvent.keyboard("{Delete}");
    await expect(input).toHaveFocus();
    await expect(selected.queryAllByRole("group")).toHaveLength(0);
    await userEvent.keyboard("{ArrowDown}");
    const page = within(input.ownerDocument.body);
    for (const zone of ZONES.slice(3, 7)) {
      await userEvent.click(
        await page.findByRole("option", { name: zone.label }),
      );
    }
    await userEvent.keyboard("{Escape}");
    await expect(selected.getAllByRole("group")).toHaveLength(4);
  },
};

/** Search in the popup when the closed field should display just the selection. */
export const SearchInPopup: Story = {
  render: function TimeZoneForm(args) {
    const form = React.useRef<HTMLFormElement>(null);
    const [saved, setSaved] = React.useState<string>();
    return (
      <form
        ref={form}
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("timeZone");
          if (typeof value !== "string") throw new Error("Missing time zone");
          setSaved(value);
        }}
      >
        <Combobox
          disabled={args.disabled}
          aria-label="Time zones"
          name="timeZone"
          itemToStringValue={(zone) => zone.value}
          items={ZONES}
          defaultValue={ZONES[1]}
        >
          <ComboboxLabel>Time zone</ComboboxLabel>
          <ComboboxTrigger render={<Button variant="surface" />}>
            <ComboboxValue />
          </ComboboxTrigger>
          <ComboboxPopup
            container={form}
            aria-label="Time zones"
            className="min-w-56"
          >
            <ComboboxInput {...args} aria-label="Filter time zones" />
            <ComboboxEmpty>No time zones found.</ComboboxEmpty>
            <Rows />
          </ComboboxPopup>
        </Combobox>
        <Button type="submit" disabled={args.disabled}>
          Save time zone
        </Button>
        {saved !== undefined && <output>{saved}</output>}
      </form>
    );
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("combobox", { name: "Time zone" });
    await expect(trigger).toHaveClass("button", "combobox-trigger");
    await userEvent.tab();
    await expect(trigger).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    const dialog = await page.findByRole("dialog", { name: "Time zones" });
    const input = within(dialog).getByRole("combobox", {
      name: "Filter time zones",
    });
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.type(input, "Tokyo");
    await expect(
      await within(dialog).findByRole("option", { name: "Tokyo" }),
    ).toBeVisible();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(trigger).toHaveTextContent("Tokyo"));
    await expect(trigger).toHaveAccessibleName("Time zone");
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(canvas.queryByRole("status")).toBeNull();
    await userEvent.tab();
    const save = canvas.getByRole("button", { name: "Save time zone" });
    await expect(save).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("status")).toHaveTextContent("Asia/Tokyo");
  },
};

function PopupWithAction(args: Args) {
  const [open, setOpen] = React.useState(false);
  return (
    <Combobox
      disabled={args.disabled}
      aria-label="Time zone"
      items={ZONES}
      open={open}
      onOpenChange={setOpen}
    >
      <ComboboxTrigger render={<Button variant="surface" />}>
        Choose time zone
      </ComboboxTrigger>
      <ComboboxPopup aria-label="Time zones" className="min-w-56">
        <ComboboxInput {...args} aria-label="Filter time zones" />
        <Rows />
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Done
        </Button>
      </ComboboxPopup>
    </Combobox>
  );
}

export const PopupAction: Story = {
  render: (args) => <PopupWithAction {...args} />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("combobox", { name: "Choose time zone" });
    await userEvent.tab();
    await expect(trigger).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    const input = await page.findByRole("combobox", {
      name: "Filter time zones",
    });
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.tab();
    const done = page.getByRole("button", { name: "Done" });
    await expect(done).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.click(trigger);
    await userEvent.click(await page.findByRole("button", { name: "Done" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

export const InDialog: Story = {
  render: (args) => (
    <Dialog>
      <DialogTrigger render={<Button variant="surface" />}>
        Project settings
      </DialogTrigger>
      <DialogPopup aria-describedby={undefined}>
        <DialogTitle>Project settings</DialogTitle>
        <TimeZonePicker {...args} label="Time zone" defaultValue={null} />
        <DialogFooter>
          <DialogClose render={<Button />}>Done</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("button", { name: "Project settings" });
    await userEvent.click(trigger);
    const dialog = await page.findByRole("dialog", {
      name: "Project settings",
    });
    const input = within(dialog).getByRole("combobox", { name: "Time zone" });
    await userEvent.click(input);
    await userEvent.keyboard("{ArrowDown}");
    await page.findByRole("listbox", { name: "Time zone" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(input).toHaveAttribute("aria-expanded", "false"),
    );
    await expect(input).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    const list = await page.findByRole("listbox", { name: "Time zone" });
    await userEvent.click(within(list).getByRole("option", { name: "Tokyo" }));
    await waitFor(() => expect(input).toHaveValue("Tokyo"));
    await userEvent.tab();
    await expect(
      within(dialog).getByRole("button", { name: "Done" }),
    ).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

/** Stage a choice in a dialog when selection needs explicit confirmation. */
export const ConfirmSelection: Story = {
  render: function TimeZoneDialog({ disabled, ...args }: Args) {
    const [saved, setSaved] = React.useState<TimeZone | null>(ZONES[1] ?? null);
    const [draft, setDraft] = React.useState(saved);
    return (
      <Dialog
        onOpenChange={(open) => {
          if (open) setDraft(saved);
        }}
      >
        <DialogTrigger
          disabled={disabled}
          render={<Button variant="surface" />}
        >
          {saved ? `Time zone: ${saved.label}` : "Choose a time zone"}
        </DialogTrigger>
        <DialogPopup aria-describedby={undefined}>
          <DialogTitle>Choose a time zone</DialogTitle>
          <Combobox
            disabled={disabled}
            inline
            open
            items={ZONES}
            aria-label="Time zone"
            value={draft}
            onValueChange={setDraft}
          >
            <ComboboxInput {...args} placeholder="Filter time zones" />
            <ComboboxEmpty>No time zones found.</ComboboxEmpty>
            <Rows />
          </Combobox>
          <DialogFooter>
            <DialogClose render={<Button variant="surface" />}>
              Cancel
            </DialogClose>
            <DialogClose
              disabled={draft === null}
              render={<Button />}
              onClick={() => setSaved(draft)}
            >
              Apply
            </DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    );
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("button", { name: "Time zone: Denver" });
    await userEvent.click(trigger);
    const findDialog = () =>
      page.findByRole("dialog", { name: "Choose a time zone" });
    const dialog = within(await findDialog());
    const input = dialog.getByRole("combobox", { name: "Time zone" });
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.clear(input);
    await userEvent.type(input, "Tokyo");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(dialog.getByRole("option", { name: "Tokyo" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.tab();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.tab();
    await expect(dialog.getByRole("button", { name: "Apply" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(trigger).toHaveTextContent("Denver");

    await userEvent.keyboard("{Enter}");
    const reopened = within(await findDialog());
    await expect(
      reopened.getByRole("option", { name: "Denver" }),
    ).toHaveAttribute("aria-selected", "true");
    await userEvent.click(reopened.getByRole("option", { name: "Berlin" }));
    await userEvent.click(reopened.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(trigger).toHaveTextContent("Berlin");
    await userEvent.click(trigger);
    const confirmed = within(await findDialog());
    await expect(
      confirmed.getByRole("option", { name: "Berlin" }),
    ).toHaveAttribute("aria-selected", "true");
  },
};

const TOKENS = [
  "color.background.accent.purple.subtlest.hovered",
  "color.background.accent.purple.subtlest.pressed",
];

function TokenPicker(args: Args) {
  const [boundary, setBoundary] = React.useState<HTMLDivElement | null>(null);
  return (
    <div ref={setBoundary} className="h-48 w-64 max-w-full">
      <Combobox
        disabled={args.disabled}
        aria-label="Design token"
        items={TOKENS}
        defaultValue={TOKENS[0]}
      >
        <ComboboxInput {...args} />
        <ComboboxPopup collisionBoundary={boundary ?? undefined}>
          <ComboboxList>
            {(token: string) => (
              <ComboboxItem key={token} value={token}>
                {token}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
    </div>
  );
}

export const LongLabels: Story = {
  render: (args) => <TokenPicker {...args} />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const input = canvas.getByRole("combobox", { name: "Design token" });
    await userEvent.click(input);
    await userEvent.keyboard("{ArrowDown}");
    const list = await within(canvasElement.ownerDocument.body).findByRole(
      "listbox",
    );
    const option = within(list).getByRole("option", { selected: true });
    const frame = input.closest(".input")?.parentElement;
    if (!frame) throw new Error("Missing picker boundary");
    await waitFor(async () => {
      const area = frame.getBoundingClientRect();
      const row = option.getBoundingClientRect();
      await expect(row.left).toBeGreaterThanOrEqual(area.left);
      await expect(row.right).toBeLessThanOrEqual(area.right);
      await expect(option.scrollWidth).toBeLessThanOrEqual(
        option.clientWidth + 1,
      );
    });
    await userEvent.keyboard("{Escape}");
  },
};

export const LongChips: Story = {
  render: (args) => (
    <div className="w-48 max-w-full">
      <Combobox
        disabled={args.disabled}
        multiple
        aria-label="Design tokens"
        items={TOKENS}
        defaultValue={TOKENS}
      >
        <ComboboxInput
          {...args}
          chips={
            <ComboboxChips>
              {(values: string[]) =>
                values.map((token) => (
                  <ComboboxChip key={token} removeLabel={`Remove ${token}`}>
                    {token}
                  </ComboboxChip>
                ))
              }
            </ComboboxChips>
          }
        />
        <ComboboxPopup>
          <ComboboxList>
            {(token: string) => (
              <ComboboxItem key={token} value={token}>
                {token}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole("combobox", { name: "Design tokens" });
    const field = input.closest(".input");
    if (!field) throw new Error("Missing token field");
    const remove = canvas.getByRole("button", { name: `Remove ${TOKENS[0]}` });
    const bounds = field.getBoundingClientRect();
    const button = remove.getBoundingClientRect();
    await expect(button.left).toBeGreaterThanOrEqual(bounds.left);
    await expect(button.right).toBeLessThanOrEqual(bounds.right);
    await expect(
      remove.contains(
        remove.ownerDocument.elementFromPoint(
          button.left + button.width / 2,
          button.top + button.height / 2,
        ),
      ),
    ).toBe(true);
    await userEvent.click(remove);
    await waitFor(() => expect(remove).not.toBeInTheDocument());
    input.focus();
    await userEvent.keyboard("{Backspace}");
    await expect(
      canvas.queryByRole("button", { name: `Remove ${TOKENS[1]}` }),
    ).toBeNull();
    await userEvent.keyboard("{ArrowDown}");
    const page = within(input.ownerDocument.body);
    for (const token of TOKENS) {
      await userEvent.click(await page.findByRole("option", { name: token }));
    }
    await userEvent.keyboard("{Escape}");
    for (const token of TOKENS) {
      await expect(
        canvas.getByRole("button", { name: `Remove ${token}` }),
      ).toBeVisible();
    }
  },
};

/** A nonmodal picker keeps neighboring form controls available while searching. */
export const NonmodalPicker: Story = {
  render: function ZonePicker() {
    const [zone, setZone] = React.useState<TimeZone | null>(null);
    const [open, setOpen] = React.useState(false);
    const search = React.useRef<HTMLInputElement>(null);
    return (
      <div className="flex items-center gap-2">
        <Popover modal={false} open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={<Button variant="surface" />}>
            {zone?.label ?? "Choose time zone"}
          </PopoverTrigger>
          <PopoverPopup
            initialFocus={search}
            align="start"
            className="grid w-64 gap-2"
          >
            <PopoverTitle>Time zone</PopoverTitle>
            <Combobox
              aria-label="Find a time zone"
              items={ZONES}
              value={zone}
              onValueChange={(value) => {
                setZone(value);
                setOpen(false);
              }}
              inline
              open
            >
              <ComboboxInput ref={search} placeholder="Filter time zones" />
              <ComboboxEmpty>No time zones found.</ComboboxEmpty>
              <Rows />
            </Combobox>
          </PopoverPopup>
        </Popover>
        <Button variant="surface">Preview schedule</Button>
      </div>
    );
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Choose time zone" });
    await userEvent.click(trigger);
    const page = within(canvasElement.ownerDocument.body);
    const search = await page.findByRole("combobox", {
      name: "Find a time zone",
    });
    await waitFor(() => expect(search).toHaveFocus());
    const adjacent = page.getByRole("button", { name: "Preview schedule" });
    await expect(adjacent.closest('[aria-hidden="true"],[inert]')).toBeNull();
    await userEvent.type(search, "Tokyo");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(trigger).toHaveTextContent("Tokyo");
    await userEvent.click(trigger);
    await waitFor(() =>
      expect(
        page.getByRole("combobox", { name: "Find a time zone" }),
      ).toHaveFocus(),
    );
    await userEvent.click(adjacent);
    await waitFor(() => expect(page.queryByRole("listbox")).toBeNull());
    await expect(adjacent).toHaveFocus();
    await userEvent.click(trigger);
    await waitFor(() =>
      expect(
        page.getByRole("combobox", { name: "Find a time zone" }),
      ).toHaveFocus(),
    );
    await waitFor(() =>
      expect(
        page.getByRole("listbox", { name: "Find a time zone" }),
      ).toBeVisible(),
    );
    await expect(
      page.getByRole("button", { name: "Preview schedule" }),
    ).toBeEnabled();
  },
};
