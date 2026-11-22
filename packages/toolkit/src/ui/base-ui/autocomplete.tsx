import {
  type AutocompleteOwnProps,
  autocompletePopupProps,
  autocompleteProps,
} from "@agent-native/design-system";
import { Autocomplete as BaseAutocomplete } from "@base-ui/react/autocomplete";
import { IconChevronDown, IconX } from "@tabler/icons-react";
import * as React from "react";

import type { AccessibleName } from "./accessible-name.js";
import {
  createListboxList,
  listboxIconButton,
  listboxActionName,
  createListboxPopup,
  ListboxRootProvider,
  type ListboxPopupProps,
  useListboxInput,
  useListboxOpenChange,
} from "./combobox-parts.js";
import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

type SuggestionItems<Item> =
  | BaseAutocomplete.Root.Props<Item>["items"]
  | readonly { readonly items: readonly Item[] }[];

export type AutocompleteProps<Item> = Omit<
  BaseAutocomplete.Root.Props<Item>,
  "items" | "filteredItems"
> &
  AccessibleName & {
    items?: SuggestionItems<Item>;
    filteredItems?: SuggestionItems<Item>;
  };

const AutocompleteRoot: <Item>(
  props: Omit<AutocompleteProps<Item>, keyof AccessibleName>,
) => React.JSX.Element = BaseAutocomplete.Root;

/**
 * A text input that suggests matches as you type and keeps whatever text is
 * entered, on Base UI's Autocomplete. Use it for search and free text; to pick
 * one value from a list, use Combobox. With `inline` and `open` it is a list
 * without a popup, as in a command palette.
 *
 * @import import { Autocomplete, AutocompleteInput, AutocompletePopup, AutocompleteList, AutocompleteItem, AutocompleteEmpty } from "@agent-native/toolkit/ui/base-ui/autocomplete";
 */
function Autocomplete<ItemValue>({
  "aria-label": label,
  "aria-labelledby": labelledBy,
  ...props
}: AutocompleteProps<ItemValue>) {
  const localActions = React.useRef<BaseAutocomplete.Root.Actions>(null);
  const actionsRef = props.actionsRef ?? localActions;
  const { closeRequests, positionerRef, onOpenChange } = useListboxOpenChange(
    props.onOpenChange,
    actionsRef,
  );
  return (
    <ListboxRootProvider
      aria-label={label}
      aria-labelledby={labelledBy}
      inline={props.inline}
      actionsRef={actionsRef}
      closeRequests={closeRequests}
      positionerRef={positionerRef}
    >
      <AutocompleteRoot<ItemValue>
        {...props}
        actionsRef={actionsRef}
        onOpenChange={onOpenChange}
      />
    </ListboxRootProvider>
  );
}

export interface AutocompleteInputProps
  extends
    Omit<
      BaseAutocomplete.Input.Props,
      "size" | "color" | "className" | "style"
    >,
    AutocompleteOwnProps {
  className?: BaseAutocomplete.InputGroup.Props["className"];
  style?: BaseAutocomplete.InputGroup.Props["style"];
  /** `InputSlot`s: an icon, a shortcut, a trigger or a clear button. */
  children?: React.ReactNode;
}

/**
 * The text field, drawn as the input part with Radix Themes' TextField props.
 * Its children are InputSlots, which can hold an AutocompleteTrigger or an
 * AutocompleteClear; `className` and `style` go on its edge.
 *
 * @import import { AutocompleteInput } from "@agent-native/toolkit/ui/base-ui/autocomplete";
 */
const AutocompleteInput = React.forwardRef<
  HTMLInputElement,
  AutocompleteInputProps
>((props, ref) => {
  const [attributes, { className, style, children, ...rest }] = splitProps(
    autocompleteProps,
    props,
  );
  const name = useListboxInput(attributes["data-size"], rest);
  return (
    <BaseAutocomplete.InputGroup
      {...attributes}
      className={partClassName("input", className)}
      style={style}
    >
      <BaseAutocomplete.Input
        ref={ref}
        className="input-control"
        {...rest}
        {...name}
      />
      {children}
    </BaseAutocomplete.InputGroup>
  );
});
AutocompleteInput.displayName = "AutocompleteInput";

/**
 * A chevron button in the input that opens the suggestions.
 *
 * @import import { AutocompleteTrigger } from "@agent-native/toolkit/ui/base-ui/autocomplete";
 */
const AutocompleteTrigger = React.forwardRef<
  HTMLButtonElement,
  BaseAutocomplete.Trigger.Props
>(({ className, children, render = listboxIconButton, ...props }, ref) => {
  return (
    <BaseAutocomplete.Trigger
      ref={ref}
      render={render}
      {...props}
      {...listboxActionName(children, props, "Show suggestions", render)}
      className={partClassName("autocomplete-trigger", className)}
    >
      {children ?? <IconChevronDown aria-hidden />}
    </BaseAutocomplete.Trigger>
  );
});
AutocompleteTrigger.displayName = "AutocompleteTrigger";

/**
 * A button in the input that clears its text.
 *
 * @import import { AutocompleteClear } from "@agent-native/toolkit/ui/base-ui/autocomplete";
 */
const AutocompleteClear = React.forwardRef<
  HTMLButtonElement,
  BaseAutocomplete.Clear.Props
>(({ className, children, render = listboxIconButton, ...props }, ref) => {
  return (
    <BaseAutocomplete.Clear
      ref={ref}
      render={render}
      {...props}
      {...listboxActionName(children, props, "Clear", render)}
      className={partClassName("autocomplete-clear", className)}
    >
      {children ?? <IconX aria-hidden />}
    </BaseAutocomplete.Clear>
  );
});
AutocompleteClear.displayName = "AutocompleteClear";

export type AutocompletePopupProps = ListboxPopupProps;

/**
 * The popup that holds the suggestions, positioned under the input. Its rows
 * match the input's size.
 *
 * @import import { AutocompletePopup } from "@agent-native/toolkit/ui/base-ui/autocomplete";
 */
const AutocompletePopup = createListboxPopup(
  "autocomplete",
  autocompletePopupProps,
  "AutocompletePopup",
);

/**
 * The list of suggestions inside the popup, or on its own when the autocomplete
 * is inline.
 *
 * @import import { AutocompleteList } from "@agent-native/toolkit/ui/base-ui/autocomplete";
 */
const AutocompleteList = createListboxList(
  "autocomplete",
  autocompletePopupProps,
  "AutocompleteList",
);

/**
 * A suggestion. Its children are the row: an icon, the label, a shortcut.
 *
 * @import import { AutocompleteItem } from "@agent-native/toolkit/ui/base-ui/autocomplete";
 */
const AutocompleteItem = React.forwardRef<
  HTMLDivElement,
  BaseAutocomplete.Item.Props
>(({ className, ...props }, ref) => (
  <BaseAutocomplete.Item
    ref={ref}
    {...props}
    className={partClassName("autocomplete-item", className)}
  />
));
AutocompleteItem.displayName = "AutocompleteItem";

/**
 * Groups related suggestions under an AutocompleteGroupLabel.
 *
 * @import import { AutocompleteGroup } from "@agent-native/toolkit/ui/base-ui/autocomplete";
 */
const AutocompleteGroup = React.forwardRef<
  HTMLDivElement,
  BaseAutocomplete.Group.Props
>(({ className, ...props }, ref) => (
  <BaseAutocomplete.Group
    ref={ref}
    {...props}
    className={partClassName("autocomplete-group", className)}
  />
));
AutocompleteGroup.displayName = "AutocompleteGroup";

/**
 * The heading of a group of suggestions.
 *
 * @import import { AutocompleteGroupLabel } from "@agent-native/toolkit/ui/base-ui/autocomplete";
 */
const AutocompleteGroupLabel = React.forwardRef<
  HTMLDivElement,
  BaseAutocomplete.GroupLabel.Props
>(({ className, ...props }, ref) => (
  <BaseAutocomplete.GroupLabel
    ref={ref}
    {...props}
    className={partClassName("autocomplete-group-label", className)}
  />
));
AutocompleteGroupLabel.displayName = "AutocompleteGroupLabel";

/**
 * Shown when nothing matches. It stays mounted, as a live region.
 *
 * @import import { AutocompleteEmpty } from "@agent-native/toolkit/ui/base-ui/autocomplete";
 */
const AutocompleteEmpty = React.forwardRef<
  HTMLDivElement,
  BaseAutocomplete.Empty.Props
>(({ className, ...props }, ref) => (
  <BaseAutocomplete.Empty
    ref={ref}
    {...props}
    className={partClassName("autocomplete-empty", className)}
  />
));
AutocompleteEmpty.displayName = "AutocompleteEmpty";

/**
 * A loading or result-count message, announced politely.
 *
 * @import import { AutocompleteStatus } from "@agent-native/toolkit/ui/base-ui/autocomplete";
 */
const AutocompleteStatus = React.forwardRef<
  HTMLDivElement,
  BaseAutocomplete.Status.Props
>(({ className, ...props }, ref) => (
  <BaseAutocomplete.Status
    ref={ref}
    {...props}
    className={partClassName("autocomplete-status", className)}
  />
));
AutocompleteStatus.displayName = "AutocompleteStatus";

/**
 * A line between groups of suggestions.
 *
 * @import import { AutocompleteSeparator } from "@agent-native/toolkit/ui/base-ui/autocomplete";
 */
const AutocompleteSeparator = React.forwardRef<
  HTMLDivElement,
  BaseAutocomplete.Separator.Props
>(({ className, ...props }, ref) => (
  <BaseAutocomplete.Separator
    ref={ref}
    {...props}
    className={partClassName("autocomplete-separator", className)}
  />
));
AutocompleteSeparator.displayName = "AutocompleteSeparator";

/**
 * Renders the filtered items of a group, or of the whole list, through a
 * function of each item. It is Base UI's Autocomplete Collection.
 *
 * @import import { AutocompleteCollection } from "@agent-native/toolkit/ui/base-ui/autocomplete";
 */
export const AutocompleteCollection = BaseAutocomplete.Collection;

/**
 * A row of items in a grid of suggestions. It is Base UI's Autocomplete Row.
 *
 * @import import { AutocompleteRow } from "@agent-native/toolkit/ui/base-ui/autocomplete";
 */
export const AutocompleteRow = BaseAutocomplete.Row;

/**
 * The input's current text, for showing it elsewhere. It is Base UI's
 * Autocomplete Value.
 *
 * @import import { AutocompleteValue } from "@agent-native/toolkit/ui/base-ui/autocomplete";
 */
export const AutocompleteValue = BaseAutocomplete.Value;
const useAutocompleteFilter = BaseAutocomplete.useFilter;
const useAutocompleteFilteredItems = BaseAutocomplete.useFilteredItems;

export {
  Autocomplete,
  AutocompleteClear,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
  AutocompleteSeparator,
  AutocompleteStatus,
  AutocompleteTrigger,
  useAutocompleteFilter,
  useAutocompleteFilteredItems,
};
