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
} from "../../../src/ui/base-ui/autocomplete.js";
import { InputSlot } from "../../../src/ui/base-ui/input.js";
import { Kbd } from "../../../src/ui/base-ui/kbd.js";
import { propControls } from "../prop-controls.js";

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

const GROUPED = [
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
    <Autocomplete items={TAGS} {...(disabled ? { disabled } : {})}>
      <AutocompleteInput
        aria-label={label}
        placeholder="Search tags"
        {...input}
      >
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

function OpenList({
  label,
  ...popup
}: Pick<AutocompletePopupProps, "variant" | "color" | "highContrast"> & {
  label: string;
}) {
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  return (
    <div className="flex w-44 flex-col gap-1">
      <span className="text-xs text-fg-muted">{label}</span>
      <Autocomplete
        items={TAGS.slice(0, 4)}
        open
        autoHighlight="always"
        defaultValue="a"
      >
        <AutocompleteInput aria-label={label} />
        {container ? (
          <AutocompletePopup {...popup} container={container}>
            <Rows />
          </AutocompletePopup>
        ) : null}
      </Autocomplete>
      <div ref={setContainer} className="h-32" />
    </div>
  );
}

const meta = {
  title: "Components/Autocomplete",
  parameters: { layout: "padded" },
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

/** Type to see suggestions; any text is kept. The input takes the controls. */
export const Playground: Story = {};

/** Sizes 1 to 4: the field is Input's, and the rows follow its size. */
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
  parameters: { a11y: { test: "todo" } },
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

/** Grouped suggestions with labels and separators between the groups. */
export const Groups: Story = {
  render: (args) => (
    <div className="w-72">
      <Autocomplete items={GROUPED} openOnInputClick>
        <AutocompleteInput {...args} aria-label="Go to" placeholder="Go to">
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
};

/** Text that matches nothing stays, and the popup says so. */
export const Empty: Story = {
  render: (args) => {
    const [container, setContainer] = React.useState<HTMLDivElement | null>(
      null,
    );
    return (
      <div className="flex w-72 flex-col gap-1">
        <Autocomplete items={TAGS} open defaultValue="kubernetes">
          <AutocompleteInput {...args} aria-label="Tags" />
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
  },
};

function searchTags(query: string, signal: AbortSignal): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const needle = query.trim().toLowerCase();
      resolve(TAGS.filter((tag) => tag.includes(needle)));
    }, 600);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}

/**
 * Suggestions from a server: `filter={null}` turns off local filtering, and
 * the status says what the list is waiting for.
 */
export const AsyncFiltering: Story = {
  render: (args) => {
    const [results, setResults] = React.useState<string[]>([]);
    const [pending, setPending] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const request = React.useRef<AbortController | null>(null);

    function search(value: string) {
      setQuery(value);
      request.current?.abort();
      if (value.trim() === "") {
        setResults([]);
        setPending(false);
        return;
      }
      const controller = new AbortController();
      request.current = controller;
      setPending(true);
      searchTags(value, controller.signal).then(
        (next) => {
          setResults(next);
          setPending(false);
        },
        () => {},
      );
    }

    return (
      <div className="w-72">
        <Autocomplete
          items={results}
          filter={null}
          value={query}
          onValueChange={search}
        >
          <AutocompleteInput {...args} aria-label="Tags" placeholder="Search">
            <InputSlot>
              <IconSearch aria-hidden />
            </InputSlot>
          </AutocompleteInput>
          <AutocompletePopup>
            <AutocompleteStatus>
              {pending ? "Searching…" : null}
            </AutocompleteStatus>
            <AutocompleteEmpty>
              {pending ? null : "No tags found."}
            </AutocompleteEmpty>
            <Rows />
          </AutocompletePopup>
        </Autocomplete>
      </div>
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
        items={COMMANDS}
        inline
        open
        autoHighlight="always"
        itemToStringValue={(
          command: (typeof COMMANDS)[number]["items"][number],
        ) => command.label}
      >
        <AutocompleteInput
          {...args}
          aria-label="Command"
          placeholder="Type a command"
        >
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
