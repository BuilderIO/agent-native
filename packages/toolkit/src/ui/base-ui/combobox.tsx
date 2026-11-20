import {
  type ComboboxOwnProps,
  comboboxPopupProps,
  comboboxProps,
} from "@agent-native/design-system";
import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { IconCheck, IconChevronDown, IconX } from "@tabler/icons-react";
import * as React from "react";

import { cn } from "../../utils.js";
import { IconButton } from "./button.js";
import {
  createListboxList,
  createListboxPopup,
  ListboxRootProvider,
  type ListboxPopupProps,
  useReportInputSize,
  useSlotButtonSize,
} from "./combobox-parts.js";
import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export type ComboboxProps<
  Value,
  Multiple extends boolean | undefined = false,
> = BaseCombobox.Root.Props<Value, Multiple>;

/**
 * A select you can type in to filter its options, on Base UI's Combobox. Use it
 * to pick one or, with `multiple`, several values from a long list; for free
 * text with suggestions, use Autocomplete.
 *
 * @import import { Combobox, ComboboxInput, ComboboxPopup, ComboboxList, ComboboxItem, ComboboxEmpty } from "@agent-native/toolkit/ui/base-ui/combobox";
 */
function Combobox<Value, Multiple extends boolean | undefined = false>(
  props: ComboboxProps<Value, Multiple>,
) {
  return (
    <ListboxRootProvider inline={props.inline}>
      <BaseCombobox.Root<Value, Multiple> {...props} />
    </ListboxRootProvider>
  );
}

const ChipsInputContext = React.createContext<React.ReactNode>(null);

export interface ComboboxInputProps
  extends
    Omit<BaseCombobox.Input.Props, "size" | "color" | "className" | "style">,
    ComboboxOwnProps {
  className?: string;
  style?: React.CSSProperties;
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
    const [attributes, { className, style, children, ...rest }] = splitProps(
      comboboxProps,
      props,
    );
    useReportInputSize(attributes["data-size"]);
    const input = (
      <BaseCombobox.Input ref={ref} className="input-control" {...rest} />
    );
    const isChips = (child: React.ReactNode) =>
      React.isValidElement(child) && child.type === ComboboxChips;
    const parts = React.Children.toArray(children);
    const chips = parts.find(isChips) ?? null;
    const slots = parts.filter((child) => !isChips(child));
    return (
      <BaseCombobox.InputGroup
        {...attributes}
        className={cn("input", className)}
        style={style}
      >
        {chips === null ? (
          input
        ) : (
          <ChipsInputContext.Provider value={input}>
            {chips}
          </ChipsInputContext.Provider>
        )}
        {slots}
      </BaseCombobox.InputGroup>
    );
  },
);
ComboboxInput.displayName = "ComboboxInput";

export interface ComboboxChipsProps<Value> extends Omit<
  BaseCombobox.Chips.Props,
  "children" | "className"
> {
  className?: string;
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
    <BaseCombobox.Chips className={cn("combobox-chips", className)} {...props}>
      <BaseCombobox.Value>
        {(value: Value[]) => children(value)}
      </BaseCombobox.Value>
      {input}
    </BaseCombobox.Chips>
  );
}

export interface ComboboxChipProps extends Omit<
  BaseCombobox.Chip.Props,
  "className"
> {
  className?: string;
  /** The remove button's accessible name; name the value, as "Remove Rust". */
  removeLabel?: string;
}

/**
 * One selected value in ComboboxChips, with a button that removes it.
 *
 * @import import { ComboboxChip } from "@agent-native/toolkit/ui/base-ui/combobox";
 */
const ComboboxChip = React.forwardRef<HTMLDivElement, ComboboxChipProps>(
  ({ className, children, removeLabel = "Remove", ...props }, ref) => (
    <BaseCombobox.Chip
      ref={ref}
      className={cn("combobox-chip", className)}
      {...props}
    >
      {children}
      <BaseCombobox.ChipRemove
        className="combobox-chip-remove"
        aria-label={removeLabel}
      >
        <IconX aria-hidden />
      </BaseCombobox.ChipRemove>
    </BaseCombobox.Chip>
  ),
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
>(({ className, children, ...props }, ref) => {
  const size = useSlotButtonSize();
  return (
    <BaseCombobox.Trigger
      ref={ref}
      aria-label="Show options"
      {...props}
      className={partClassName("combobox-trigger", className)}
      render={<IconButton size={size} variant="ghost" color="gray" />}
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
>(({ className, children, ...props }, ref) => {
  const size = useSlotButtonSize();
  return (
    <BaseCombobox.Clear
      ref={ref}
      aria-label="Clear"
      {...props}
      className={partClassName("combobox-clear", className)}
      render={<IconButton size={size} variant="ghost" color="gray" />}
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
