import {
  type AutocompleteOwnProps,
  autocompletePopupProps,
  autocompleteProps,
  COLORS,
  CONTROL_SIZES,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  IconFile,
  IconSearch,
  IconSettings,
  IconUser,
} from "@tabler/icons-react";
import * as React from "react";
import { expect, waitFor, within } from "storybook/test";

import {
  Autocomplete,
  AutocompleteClear,
  AutocompleteCollection,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
  type AutocompletePopupProps,
  AutocompleteSeparator,
  AutocompleteStatus,
  AutocompleteTrigger,
} from "../../../src/ui/base-ui/autocomplete.js";
import { Button } from "../../../src/ui/base-ui/button.js";
import { Input, InputSlot } from "../../../src/ui/base-ui/input.js";
import { Kbd } from "../../../src/ui/base-ui/kbd.js";
import { searchDelay, useAsyncOptions } from "../async-options.js";
import { propControls } from "../prop-controls.js";
import guide from "./autocomplete.docs.md?raw";

type Args = AutocompleteOwnProps & { disabled?: boolean };

const controls = propControls(autocompleteProps);

const VARIANTS = autocompleteProps.variant.values;
const POPUP_VARIANTS = autocompletePopupProps.variant.values;

const TAGS = [
  "accessibility",
  "animation",
  "api",
  "authentication",
  "billing",
  "charts",
  "database",
  "deployment",
  "design system",
  "documentation",
  "forms",
  "localization",
  "performance",
  "search",
  "security",
  "testing",
];

interface SuggestionGroup {
  value: string;
  items: readonly string[];
}

const GROUPED: readonly SuggestionGroup[] = [
  { value: "Pages", items: ["Dashboard", "Inbox", "Reports", "Settings"] },
  { value: "People", items: ["Ada Lovelace", "Grace Hopper", "Alan Turing"] },
  { value: "Files", items: ["Q3 plan.pdf", "Roadmap.md", "Budget.xlsx"] },
];

function Rows() {
  return (
    <AutocompleteList>
      {(tag: string) => (
        <AutocompleteItem key={tag} value={tag}>
          {tag}
        </AutocompleteItem>
      )}
    </AutocompleteList>
  );
}

function Search({ label, disabled, ...input }: Args & { label: string }) {
  return (
    <Autocomplete
      aria-label={label}
      items={TAGS}
      {...(disabled ? { disabled } : {})}
    >
      <AutocompleteInput placeholder="Search tags" {...input}>
        <InputSlot>
          <IconSearch aria-hidden />
        </InputSlot>
        <InputSlot side="right">
          <AutocompleteClear />
        </InputSlot>
      </AutocompleteInput>
      <AutocompletePopup>
        <AutocompleteEmpty>No tags found.</AutocompleteEmpty>
        <Rows />
      </AutocompletePopup>
    </Autocomplete>
  );
}

function PopupExample({
  disabled,
  label,
  ...popup
}: Pick<AutocompletePopupProps, "variant" | "color" | "highContrast"> & {
  disabled?: boolean;
  label: string;
}) {
  const id = React.useId();
  return (
    <div className="flex w-44 flex-col gap-1">
      <label id={id} htmlFor={id + "-input"} className="text-xs text-fg-muted">
        {label}
      </label>
      <Autocomplete
        aria-labelledby={id}
        disabled={disabled}
        items={TAGS.slice(0, 4)}
        openOnInputClick
        autoHighlight="always"
        defaultValue="a"
      >
        <AutocompleteInput id={id + "-input"} />
        <AutocompletePopup {...popup}>
          <Rows />
        </AutocompletePopup>
      </Autocomplete>
    </div>
  );
}

const meta = {
  title: "Components/Autocomplete",
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, disabled: false },
  argTypes: controls.argTypes,
  render: (args) => (
    <div className="w-72">
      <Search {...args} label="Tags" />
    </div>
  ),
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;
type StoryArgs = Parameters<NonNullable<Story["render"]>>[0];

/** Type to see suggestions; any text is kept. The input takes the controls. */
export const Playground: Story = {};

function InlineTags({
  readOnly,
  defaultValue = "",
  ...args
}: Args & { readOnly?: boolean; defaultValue?: string }) {
  const [value, setValue] = React.useState(defaultValue);
  return (
    <div className="grid w-64 gap-2">
      <Autocomplete
        aria-label="Tag"
        items={TAGS}
        readOnly={readOnly}
        inline
        open
        value={value}
        onValueChange={setValue}
        disabled={args.disabled}
      >
        <AutocompleteInput {...args} placeholder="Find or enter a tag" />
        <AutocompleteEmpty>No matching tags.</AutocompleteEmpty>
        <AutocompleteList variant="solid" color="accent" highContrast>
          {(tag: string) => (
            <AutocompleteItem
              key={tag}
              value={tag}
              onClick={
                readOnly || args.disabled ? undefined : () => setValue(tag)
              }
            >
              {tag}
            </AutocompleteItem>
          )}
        </AutocompleteList>
      </Autocomplete>
      <Input aria-label="Note" placeholder="Add a note" />
    </div>
  );
}
export const Inline: Story = {
  render: (args) => <InlineTags {...args} />,
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole("combobox", { name: "Tag" });
    const list = canvas.getByRole("listbox", { name: "Tag" });
    await expect(list).toHaveAttribute("data-variant", "solid");
    await expect(list).toHaveAttribute("data-color", "accent");
    await expect(list).toHaveAttribute("data-high-contrast");
    await userEvent.type(input, "ani");
    await expect(within(list).getAllByRole("option")).toHaveLength(1);
    await expect(input).toHaveAttribute("aria-controls", list.id);
    await userEvent.keyboard("{ArrowDown}");
    await expect(input).toHaveFocus();
    const highlighted = within(list).getByRole("option", { name: "animation" });
    await expect(highlighted.id).not.toBe("");
    await expect(input).toHaveAttribute(
      "aria-activedescendant",
      highlighted.id,
    );
    await userEvent.keyboard("{Enter}");
    await expect(input).toHaveValue("animation");
    const note = canvas.getByRole("textbox", { name: "Note" });
    await userEvent.tab();
    await expect(note).toHaveFocus();
    await userEvent.tab({ shift: true });
    await expect(input).toHaveFocus();
    await userEvent.clear(input);
    await userEvent.type(input, "custom tag");
    await expect(canvas.getByText("No matching tags.")).toBeVisible();
    await expect(input).not.toHaveAttribute("aria-activedescendant");
    await userEvent.tab();
    await expect(input).toHaveValue("custom tag");
    await expect(note).toHaveFocus();
    await userEvent.clear(input);
  },
};

export const ReadOnlyInline: Story = {
  render: (args) => <InlineTags {...args} readOnly defaultValue="ani" />,
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole("combobox", { name: "Tag" });
    await userEvent.tab();
    await expect(input).toHaveFocus();
    await expect(input).toHaveAttribute("readonly");
    await userEvent.click(canvas.getByRole("option", { name: "animation" }));
    await expect(input).toHaveValue("ani");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(input).toHaveValue("ani");
    await userEvent.tab();
    await expect(canvas.getByRole("textbox", { name: "Note" })).toHaveFocus();
  },
};
export const DisabledInline: Story = {
  args: { disabled: true },
  render: (args) => <InlineTags {...args} defaultValue="ani" />,
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole("combobox", { name: "Tag" });
    const option = canvas.getByRole("option", { name: "animation" });
    await expect(input).toBeDisabled();
    await expect(option).toHaveAttribute("aria-disabled", "true");
    await expect(getComputedStyle(option).pointerEvents).toBe("none");
    await userEvent.tab();
    await expect(canvas.getByRole("textbox", { name: "Note" })).toHaveFocus();
    await expect(input).toHaveValue("ani");
  },
};
export const LabeledActions: Story = {
  render: (args) => (
    <div className="w-80">
      <Autocomplete
        disabled={args.disabled}
        aria-label="Tag"
        items={TAGS}
        defaultValue="design system"
      >
        <AutocompleteInput {...args}>
          <InputSlot side="right">
            <AutocompleteClear render={<Button variant="ghost" size="sm" />}>
              Reset
            </AutocompleteClear>
            <AutocompleteTrigger
              render={
                <Button variant="ghost" size="sm">
                  Browse
                </Button>
              }
            />
          </InputSlot>
        </AutocompleteInput>
        <AutocompletePopup>
          <Rows />
        </AutocompletePopup>
      </Autocomplete>
    </div>
  ),
  play: async ({ canvas, userEvent, canvasElement }) => {
    const input = canvas.getByRole("combobox", { name: "Tag" });
    await userEvent.click(canvas.getByRole("button", { name: "Browse" }));
    const list = await within(canvasElement.ownerDocument.body).findByRole(
      "listbox",
      { name: "Tag" },
    );
    await waitFor(() => expect(list).toBeVisible());
    await expect(input).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "Reset" }));
    await expect(input).toHaveValue("");
    await userEvent.keyboard("{Escape}");
  },
};

/** md and sm: the field is Input's, and the rows follow its size. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex w-72 flex-col gap-3">
      {CONTROL_SIZES.map((size) => (
        <Search key={size} {...args} size={size} label={`Size ${size}`} />
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
              <div key={variant} className="w-56">
                <Search
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

/** Grouped suggestions with labels and separators between the groups. */
export const Groups: Story = {
  render: (args) => (
    <div className="w-72">
      <Autocomplete
        disabled={args.disabled}
        aria-label="Go to"
        items={GROUPED}
        filter={(item, query) => {
          const words = item.toLowerCase().split(/\s+/);
          return query
            .trim()
            .toLowerCase()
            .split(/\s+/)
            .every((prefix) => words.some((word) => word.startsWith(prefix)));
        }}
        openOnInputClick
      >
        <AutocompleteInput {...args} placeholder="Go to">
          <InputSlot>
            <IconSearch aria-hidden />
          </InputSlot>
        </AutocompleteInput>
        <AutocompletePopup>
          <AutocompleteEmpty>Nothing found.</AutocompleteEmpty>
          <AutocompleteList>
            {(group: (typeof GROUPED)[number], index: number) => (
              <AutocompleteGroup key={group.value} items={group.items}>
                {index > 0 ? <AutocompleteSeparator /> : null}
                <AutocompleteGroupLabel>{group.value}</AutocompleteGroupLabel>
                <AutocompleteCollection>
                  {(item: string) => (
                    <AutocompleteItem key={item} value={item}>
                      {item}
                    </AutocompleteItem>
                  )}
                </AutocompleteCollection>
              </AutocompleteGroup>
            )}
          </AutocompleteList>
        </AutocompletePopup>
      </Autocomplete>
    </div>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const input = canvas.getByRole("combobox", { name: "Go to" });
    await userEvent.type(input, "hop gr");
    const list = await within(canvasElement.ownerDocument.body).findByRole(
      "listbox",
    );
    const group = within(list).getByRole("group", { name: "People" });
    await waitFor(() =>
      expect(
        within(group).getByRole("option", { name: "Grace Hopper" }),
      ).toBeVisible(),
    );
    await expect(within(list).getAllByRole("option")).toHaveLength(1);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(input).toHaveValue("Grace Hopper");
  },
};

function EmptyStory(args: StoryArgs) {
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  return (
    <div className="flex w-72 flex-col gap-1">
      <Autocomplete
        disabled={args.disabled}
        aria-label="Tags"
        items={TAGS}
        open
        defaultValue="kubernetes"
      >
        <AutocompleteInput {...args} />
        {container ? (
          <AutocompletePopup container={container}>
            <AutocompleteEmpty>No tags found.</AutocompleteEmpty>
            <Rows />
          </AutocompletePopup>
        ) : null}
      </Autocomplete>
      <div ref={setContainer} className="h-24" />
    </div>
  );
}
/** Text that matches nothing stays, and the popup says so. */
export const Empty: Story = {
  render: (args) => <EmptyStory {...args} />,
};

async function searchTags(
  query: string,
  signal: AbortSignal,
): Promise<string[]> {
  await searchDelay(signal, 600);
  const needle = query.toLowerCase();
  return TAGS.filter((tag) => tag.includes(needle));
}

function AsyncFilteringStory(args: StoryArgs) {
  const { results, status, search } = useAsyncOptions(searchTags, 150);
  const [query, setQuery] = React.useState("");
  return (
    <div className="w-72">
      <Autocomplete
        disabled={args.disabled}
        aria-label="Tags"
        items={results}
        filter={null}
        value={query}
        onValueChange={(value, { reason }) => {
          setQuery(value);
          void search(reason === "item-press" ? "" : value);
        }}
      >
        <AutocompleteInput {...args} placeholder="Search">
          <InputSlot>
            <IconSearch aria-hidden />
          </InputSlot>
        </AutocompleteInput>
        <AutocompletePopup>
          <AutocompleteStatus>
            {status === "pending"
              ? "Searching…"
              : status === "error"
                ? "Search failed. Try again."
                : null}
          </AutocompleteStatus>
          <AutocompleteEmpty>
            {status === "ready" ? "No tags found." : null}
          </AutocompleteEmpty>
          <Rows />
        </AutocompletePopup>
      </Autocomplete>
    </div>
  );
}
/**
 * Suggestions from a server: `filter={null}` turns off local filtering, and
 * the status says what the list is waiting for.
 */
export const AsyncFiltering: Story = {
  render: (args) => <AsyncFilteringStory {...args} />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const input = canvas.getByRole("combobox", { name: "Tags" });
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.type(input, "ani");
    await expect(
      await page.findByRole("option", { name: "animation" }),
    ).toBeVisible();
    await userEvent.clear(input);
    await userEvent.type(input, "test");
    await expect(page.queryByRole("option", { name: "animation" })).toBeNull();
    await expect(
      await page.findByRole("option", { name: "testing" }),
    ).toBeVisible();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(input).toHaveValue("testing"));
    await waitFor(() =>
      expect(input).toHaveAttribute("aria-expanded", "false"),
    );
  },
};

const COMMANDS = [
  {
    value: "Navigate",
    items: [
      { label: "Open settings", icon: IconSettings, shortcut: "⌘," },
      { label: "Open profile", icon: IconUser, shortcut: "⌘P" },
    ],
  },
  {
    value: "Files",
    items: [
      { label: "New file", icon: IconFile, shortcut: "⌘N" },
      { label: "Search files", icon: IconSearch, shortcut: "⌘F" },
    ],
  },
];

/**
 * A command palette: `inline` and `open` render the list without a popup,
 * under the input, with the popup's look. Rows hold an icon, the label and
 * a shortcut.
 */
export const CommandPalette: Story = {
  render: (args) => (
    <div className="flex h-72 w-96 flex-col gap-2 rounded-lg border border-line-default bg-surface-raised p-2">
      <Autocomplete
        disabled={args.disabled}
        aria-label="Command"
        items={COMMANDS}
        inline
        open
        autoHighlight="always"
        itemToStringValue={(
          command: (typeof COMMANDS)[number]["items"][number],
        ) => command.label}
      >
        <AutocompleteInput {...args} placeholder="Type a command">
          <InputSlot>
            <IconSearch aria-hidden />
          </InputSlot>
        </AutocompleteInput>
        <AutocompleteEmpty>No commands found.</AutocompleteEmpty>
        <AutocompleteList>
          {(group: (typeof COMMANDS)[number]) => (
            <AutocompleteGroup key={group.value} items={group.items}>
              <AutocompleteGroupLabel>{group.value}</AutocompleteGroupLabel>
              <AutocompleteCollection>
                {(command: (typeof COMMANDS)[number]["items"][number]) => (
                  <AutocompleteItem key={command.label} value={command}>
                    <command.icon aria-hidden />
                    {command.label}
                    <Kbd className="ms-auto">{command.shortcut}</Kbd>
                  </AutocompleteItem>
                )}
              </AutocompleteCollection>
            </AutocompleteGroup>
          )}
        </AutocompleteList>
      </Autocomplete>
    </div>
  ),
};
