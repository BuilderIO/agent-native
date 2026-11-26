import {
  type ComboboxOwnProps,
  comboboxPopupProps,
  comboboxProps,
} from "@agent-native/design-system";
import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { IconCheck, IconChevronDown, IconX } from "@tabler/icons-react";
import * as React from "react";

import { inheritedName, type AccessibleName } from "./accessible-name.js";
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

export type ComboboxProps<
  Value,
  Multiple extends boolean | undefined = false,
  Item = Value,
> = BaseCombobox.Root.Props<Value, Multiple, Item> & AccessibleName;

/**
 * A select you can type in to filter its options, on Base UI's Combobox. Use it
 * to pick one or, with `multiple`, several values from a long list; for free
 * text with suggestions, use Autocomplete.
 *
 * @import import { Combobox, ComboboxInput, ComboboxPopup, ComboboxList, ComboboxItem, ComboboxEmpty } from "@agent-native/toolkit/ui/base-ui/combobox";
 */
function Combobox<
  Value,
  Multiple extends boolean | undefined = false,
  Item = Value,
>({
  "aria-label": label,
  "aria-labelledby": labelledBy,
  ...props
}: ComboboxProps<Value, Multiple, Item>) {
  const localActions = React.useRef<BaseCombobox.Root.Actions>(null);
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
      <BaseCombobox.Root<Value, Multiple, Item>
        {...props}
        actionsRef={actionsRef}
        onOpenChange={onOpenChange}
      />
    </ListboxRootProvider>
  );
}

/** Names a standalone value trigger when the search input lives in the popup. */
export const ComboboxLabel = React.forwardRef<
  HTMLDivElement,
  BaseCombobox.Label.Props
>(({ className, ...props }, ref) => (
  <BaseCombobox.Label
    {...props}
    ref={ref}
    className={partClassName("field-label", className)}
  />
));
ComboboxLabel.displayName = "ComboboxLabel";

const ChipsInputContext = React.createContext<React.ReactNode>(null);

export interface ComboboxInputProps
  extends
    Omit<BaseCombobox.Input.Props, "size" | "color" | "className" | "style">,
    ComboboxOwnProps {
  className?: BaseCombobox.InputGroup.Props["className"];
  style?: BaseCombobox.InputGroup.Props["style"];
  /** A ComboboxChips part or a component that renders it for a multiple selection. */
  chips?: React.ReactElement | null;
  /** `InputSlot`s, and in a `multiple` combobox its `ComboboxChips`. */
  children?: React.ReactNode;
}

/**
 * The text field, drawn as the input part with Radix Themes' TextField props.
 * Its children are InputSlots holding a ComboboxTrigger or a ComboboxClear, and
 * ComboboxChips in a `multiple` combobox; `className` and `style` go on its
 * edge.
 *
 * @import import { ComboboxInput } from "@agent-native/toolkit/ui/base-ui/combobox";
 */
const ComboboxInput = React.forwardRef<HTMLInputElement, ComboboxInputProps>(
  (props, ref) => {
    const [attributes, { className, style, children, chips, ...rest }] =
      splitProps(comboboxProps, props);
    const name = useListboxInput(attributes["data-size"], rest);
    const input = (
      <BaseCombobox.Input
        ref={ref}
        className="input-control"
        {...rest}
        {...name}
      />
    );
    const isChips = (child: React.ReactNode) =>
      React.isValidElement(child) && child.type === ComboboxChips;
    const parts = chips ? undefined : React.Children.toArray(children);
    const chipGroup = chips ?? parts?.find(isChips);
    return (
      <BaseCombobox.InputGroup
        {...attributes}
        className={partClassName("input", className)}
        style={style}
      >
        {chipGroup == null ? (
          input
        ) : (
          <ChipsInputContext.Provider value={input}>
            {chipGroup}
          </ChipsInputContext.Provider>
        )}
        {parts ? parts.filter((child) => !isChips(child)) : children}
      </BaseCombobox.InputGroup>
    );
  },
);
ComboboxInput.displayName = "ComboboxInput";

export interface ComboboxChipsProps<Value> extends Omit<
  BaseCombobox.Chips.Props,
  "children"
> {
  /** A `ComboboxChip` for each selected value. */
  children: (value: Value[]) => React.ReactNode;
}

/**
 * The selected values of a `multiple` combobox, as chips before the text. It
 * goes inside ComboboxInput, which places its input after the chips so
 * Backspace and the arrow keys move from the text into them.
 *
 * @import import { ComboboxChips } from "@agent-native/toolkit/ui/base-ui/combobox";
 */
function ComboboxChips<Value>({
  className,
  children,
  ...props
}: ComboboxChipsProps<Value>) {
  const input = React.useContext(ChipsInputContext);
  return (
    <BaseCombobox.Chips
      className={partClassName("combobox-chips", className)}
      {...props}
    >
      <BaseCombobox.Value>
        {(value: Value[]) => children(value)}
      </BaseCombobox.Value>
      {input}
    </BaseCombobox.Chips>
  );
}

export interface ComboboxChipProps extends BaseCombobox.Chip.Props {
  /** The remove button's accessible name; name the value, as "Remove Rust". */
  removeLabel?: string;
}

/**
 * One selected value in ComboboxChips, with a button that removes it.
 *
 * @import import { ComboboxChip } from "@agent-native/toolkit/ui/base-ui/combobox";
 */
const ComboboxChip = React.forwardRef<HTMLDivElement, ComboboxChipProps>(
  ({ className, children, removeLabel, ...props }, ref) => {
    const id = React.useId();
    const labelId = id + "-label";
    return (
      <BaseCombobox.Chip
        ref={ref}
        role="group"
        aria-readonly={undefined}
        className={partClassName("combobox-chip", className)}
        {...props}
        {...inheritedName({ "aria-labelledby": labelId }, props)}
      >
        <span id={labelId} className="combobox-chip-label">
          {children}
        </span>
        <BaseCombobox.ChipRemove
          id={id}
          className="combobox-chip-remove"
          aria-label={removeLabel ?? "Remove"}
          aria-labelledby={
            removeLabel === undefined ? id + " " + labelId : undefined
          }
        >
          <IconX aria-hidden />
        </BaseCombobox.ChipRemove>
      </BaseCombobox.Chip>
    );
  },
);
ComboboxChip.displayName = "ComboboxChip";

/**
 * A chevron button in the input that opens the options.
 *
 * @import import { ComboboxTrigger } from "@agent-native/toolkit/ui/base-ui/combobox";
 */
const ComboboxTrigger = React.forwardRef<
  HTMLButtonElement,
  BaseCombobox.Trigger.Props
>(({ className, children, render = listboxIconButton, ...props }, ref) => {
  return (
    <BaseCombobox.Trigger
      ref={ref}
      render={render}
      {...props}
      {...listboxActionName(children, props, "Show options", render)}
      className={partClassName("combobox-trigger", className)}
    >
      {children ?? <IconChevronDown aria-hidden />}
    </BaseCombobox.Trigger>
  );
});
ComboboxTrigger.displayName = "ComboboxTrigger";

/**
 * A button in the input that clears the selection.
 *
 * @import import { ComboboxClear } from "@agent-native/toolkit/ui/base-ui/combobox";
 */
const ComboboxClear = React.forwardRef<
  HTMLButtonElement,
  BaseCombobox.Clear.Props
>(({ className, children, render = listboxIconButton, ...props }, ref) => {
  return (
    <BaseCombobox.Clear
      ref={ref}
      render={render}
      {...props}
      {...listboxActionName(children, props, "Clear", render)}
      className={partClassName("combobox-clear", className)}
    >
      {children ?? <IconX aria-hidden />}
    </BaseCombobox.Clear>
  );
});
ComboboxClear.displayName = "ComboboxClear";

export type ComboboxPopupProps = ListboxPopupProps;

/**
 * The popup that holds the options, positioned under the input. It takes
 * Select's content look, and its rows match the input's size.
 *
 * @import import { ComboboxPopup } from "@agent-native/toolkit/ui/base-ui/combobox";
 */
const ComboboxPopup = createListboxPopup(
  "combobox",
  comboboxPopupProps,
  "ComboboxPopup",
);

/**
 * The list of options inside the popup, or on its own when the combobox is
 * inline.
 *
 * @import import { ComboboxList } from "@agent-native/toolkit/ui/base-ui/combobox";
 */
const ComboboxList = createListboxList(
  "combobox",
  comboboxPopupProps,
  "ComboboxList",
);

/**
 * An option. A check marks the selected value in its leading column.
 *
 * @import import { ComboboxItem } from "@agent-native/toolkit/ui/base-ui/combobox";
 */
const ComboboxItem = React.forwardRef<HTMLDivElement, BaseCombobox.Item.Props>(
  ({ className, children, ...props }, ref) => (
    <BaseCombobox.Item
      ref={ref}
      {...props}
      className={partClassName("combobox-item", className)}
    >
      <BaseCombobox.ItemIndicator className="combobox-item-indicator">
        <IconCheck aria-hidden />
      </BaseCombobox.ItemIndicator>
      {children}
    </BaseCombobox.Item>
  ),
);
ComboboxItem.displayName = "ComboboxItem";

/**
 * Groups related options under a ComboboxGroupLabel.
 *
 * @import import { ComboboxGroup } from "@agent-native/toolkit/ui/base-ui/combobox";
 */
const ComboboxGroup = React.forwardRef<
  HTMLDivElement,
  BaseCombobox.Group.Props
>(({ className, ...props }, ref) => (
  <BaseCombobox.Group
    ref={ref}
    {...props}
    className={partClassName("combobox-group", className)}
  />
));
ComboboxGroup.displayName = "ComboboxGroup";

/**
 * The heading of a group of options.
 *
 * @import import { ComboboxGroupLabel } from "@agent-native/toolkit/ui/base-ui/combobox";
 */
const ComboboxGroupLabel = React.forwardRef<
  HTMLDivElement,
  BaseCombobox.GroupLabel.Props
>(({ className, ...props }, ref) => (
  <BaseCombobox.GroupLabel
    ref={ref}
    {...props}
    className={partClassName("combobox-group-label", className)}
  />
));
ComboboxGroupLabel.displayName = "ComboboxGroupLabel";

/**
 * Shown when nothing matches. It stays mounted, as a live region.
 *
 * @import import { ComboboxEmpty } from "@agent-native/toolkit/ui/base-ui/combobox";
 */
const ComboboxEmpty = React.forwardRef<
  HTMLDivElement,
  BaseCombobox.Empty.Props
>(({ className, ...props }, ref) => (
  <BaseCombobox.Empty
    ref={ref}
    {...props}
    className={partClassName("combobox-empty", className)}
  />
));
ComboboxEmpty.displayName = "ComboboxEmpty";

/**
 * A loading or result-count message, announced politely.
 *
 * @import import { ComboboxStatus } from "@agent-native/toolkit/ui/base-ui/combobox";
 */
const ComboboxStatus = React.forwardRef<
  HTMLDivElement,
  BaseCombobox.Status.Props
>(({ className, ...props }, ref) => (
  <BaseCombobox.Status
    ref={ref}
    {...props}
    className={partClassName("combobox-status", className)}
  />
));
ComboboxStatus.displayName = "ComboboxStatus";

/**
 * A line between groups of options.
 *
 * @import import { ComboboxSeparator } from "@agent-native/toolkit/ui/base-ui/combobox";
 */
const ComboboxSeparator = React.forwardRef<
  HTMLDivElement,
  BaseCombobox.Separator.Props
>(({ className, ...props }, ref) => (
  <BaseCombobox.Separator
    ref={ref}
    {...props}
    className={partClassName("combobox-separator", className)}
  />
));
ComboboxSeparator.displayName = "ComboboxSeparator";

/**
 * Renders the filtered items of a group, or of the whole list, through a
 * function of each item. It is Base UI's Combobox Collection.
 *
 * @import import { ComboboxCollection } from "@agent-native/toolkit/ui/base-ui/combobox";
 */
export const ComboboxCollection = BaseCombobox.Collection;

/**
 * A row of items in a grid of options. It is Base UI's Combobox Row.
 *
 * @import import { ComboboxRow } from "@agent-native/toolkit/ui/base-ui/combobox";
 */
export const ComboboxRow = BaseCombobox.Row;

/**
 * The selected value, for showing it elsewhere or rendering it through a
 * function. It is Base UI's Combobox Value.
 *
 * @import import { ComboboxValue } from "@agent-native/toolkit/ui/base-ui/combobox";
 */
export const ComboboxValue = BaseCombobox.Value;
export const createComboboxItems = BaseCombobox.createItems;
const useComboboxFilter = BaseCombobox.useFilter;
const useComboboxFilteredItems = BaseCombobox.useFilteredItems;

export {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxClear,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSeparator,
  ComboboxStatus,
  ComboboxTrigger,
  useComboboxFilter,
  useComboboxFilteredItems,
};
