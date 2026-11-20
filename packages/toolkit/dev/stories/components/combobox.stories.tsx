import {
  COLORS,
  type ComboboxOwnProps,
  comboboxPopupProps,
  comboboxProps,
  CONTROL_SIZES,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxClear,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  type ComboboxPopupProps,
  ComboboxSeparator,
  ComboboxStatus,
  ComboboxTrigger,
} from "../../../src/ui/base-ui/combobox.js";
import { InputSlot } from "../../../src/ui/base-ui/input.js";
import { propControls } from "../prop-controls.js";

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

function Rows() {
  return (
    <ComboboxList>
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
      items={ZONES}
      defaultValue={defaultValue}
      {...(disabled ? { disabled } : {})}
    >
      <ComboboxInput
        aria-label={label}
        placeholder="Pick a time zone"
        {...input}
      >
        <Controls />
      </ComboboxInput>
      <ComboboxPopup>
        <ComboboxEmpty>No time zones found.</ComboboxEmpty>
        <Rows />
      </ComboboxPopup>
    </Combobox>
  );
}

function OpenList({
  label,
  ...popup
}: Pick<ComboboxPopupProps, "variant" | "color" | "highContrast"> & {
  label: string;
}) {
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  return (
    <div className="flex w-44 flex-col gap-1">
      <span className="text-xs text-fg-muted">{label}</span>
      <Combobox
        items={ZONES.slice(0, 4)}
        defaultValue={ZONES[1] ?? null}
        open
        autoHighlight
      >
        <ComboboxInput aria-label={label} />
        {container ? (
          <ComboboxPopup {...popup} container={container}>
            <Rows />
          </ComboboxPopup>
        ) : null}
      </Combobox>
      <div ref={setContainer} className="h-32" />
    </div>
  );
}

const meta = {
  title: "Components/Combobox",
  parameters: { layout: "padded" },
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

/** A select you can type into. The input takes the controls. */
export const Playground: Story = {};

/** Sizes 1 to 4: the field is Input's, and the rows follow its size. */
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
  parameters: { a11y: { test: "todo" } },
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
              <OpenList
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
    <div className="w-64">
      <Combobox items={REGIONS} defaultValue={ZONES[5] ?? null}>
        <ComboboxInput
          {...args}
          aria-label="Time zone"
          placeholder="Pick a time zone"
        >
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
                    <ComboboxItem key={zone.value} value={zone}>
                      {zone.label}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
    </div>
  ),
};

/** A query that matches nothing: the popup says so. */
export const Empty: Story = {
  render: (args) => {
    const [container, setContainer] = React.useState<HTMLDivElement | null>(
      null,
    );
    return (
      <div className="flex w-64 flex-col gap-1">
        <Combobox items={ZONES} open defaultInputValue="Atlantis">
          <ComboboxInput {...args} aria-label="Time zone" />
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
  },
};

function searchZones(query: string, signal: AbortSignal): Promise<TimeZone[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const needle = query.trim().toLowerCase();
      resolve(
        ZONES.filter((zone) => zone.label.toLowerCase().includes(needle)),
      );
    }, 600);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}

/**
 * Values from a server: `filter={null}` turns off local filtering, the
 * selected value stays in `items` so its label holds, and the status says
 * what the list is waiting for.
 */
export const AsyncFiltering: Story = {
  render: (args) => {
    const [selected, setSelected] = React.useState<TimeZone | null>(null);
    const [results, setResults] = React.useState<TimeZone[]>([]);
    const [pending, setPending] = React.useState(false);
    const request = React.useRef<AbortController | null>(null);

    const items = React.useMemo(
      () =>
        selected === null ||
        results.some((zone) => zone.value === selected.value)
          ? results
          : [selected, ...results],
      [results, selected],
    );

    function search(query: string) {
      request.current?.abort();
      if (query.trim() === "") {
        setResults([]);
        setPending(false);
        return;
      }
      const controller = new AbortController();
      request.current = controller;
      setPending(true);
      searchZones(query, controller.signal).then(
        (next) => {
          setResults(next);
          setPending(false);
        },
        () => {},
      );
    }

    return (
      <div className="w-64">
        <Combobox
          items={items}
          filter={null}
          value={selected}
          onValueChange={setSelected}
          onInputValueChange={(query, { reason }) => {
            if (reason === "input-change") search(query);
          }}
          isItemEqualToValue={(item, value) => item.value === value.value}
        >
          <ComboboxInput
            {...args}
            aria-label="Time zone"
            placeholder="Search time zones"
          >
            <Controls />
          </ComboboxInput>
          <ComboboxPopup>
            <ComboboxStatus>{pending ? "Searching…" : null}</ComboboxStatus>
            <ComboboxEmpty>
              {pending ? null : "No time zones found."}
            </ComboboxEmpty>
            <Rows />
          </ComboboxPopup>
        </Combobox>
      </div>
    );
  },
};

/**
 * `multiple`: each selected value is a chip before the text, and the field
 * grows to hold them. Backspace in an empty field removes the last chip;
 * the arrow keys move into the chips.
 */
export const Multiple: Story = {
  render: (args) => (
    <div className="flex w-80 flex-col gap-3">
      {CONTROL_SIZES.map((size) => (
        <Combobox
          key={size}
          items={ZONES}
          multiple
          defaultValue={ZONES.slice(3, 7)}
        >
          <ComboboxInput
            {...args}
            size={size}
            aria-label={`Time zones, size ${size}`}
            placeholder="Add a time zone"
          >
            <ComboboxChips>
              {(value: TimeZone[]) =>
                value.map((zone) => (
                  <ComboboxChip
                    key={zone.value}
                    removeLabel={`Remove ${zone.label}`}
                  >
                    {zone.label}
                  </ComboboxChip>
                ))
              }
            </ComboboxChips>
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
};
