import {
  type SelectPopupOwnProps,
  selectPopupProps,
  type SelectRootOwnProps,
  selectRootProps,
  type SelectTriggerOwnProps,
  selectTriggerProps,
} from "@agent-native/design-system";
import { Select as BaseSelect } from "@base-ui/react/select";
import { useRender } from "@base-ui/react/use-render";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import * as React from "react";

import { inheritedName, type AccessibleName } from "./accessible-name.js";
import { scopePortal } from "./overlay-scope.js";
import { partClassName } from "./part-class.js";
import { splitPositionerProps } from "./positioning.js";
import { splitProps } from "./props.js";
import { activeElementInRoot } from "./surface-target.js";

const SelectPortal = scopePortal(BaseSelect.Portal);

const SelectContext = React.createContext<{
  size?: string | undefined;
  name?: AccessibleName;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  listRef?: React.RefObject<HTMLDivElement | null>;
}>({});

export type SelectProps<
  Value,
  Multiple extends boolean | undefined = false,
> = BaseSelect.Root.Props<Value, Multiple> &
  SelectRootOwnProps &
  AccessibleName;

/**
 * A button that opens a list of options to pick one from, on Base UI's Select
 * with Radix Themes' props. Pass `items` so SelectValue shows the selected
 * item's label rather than its value.
 *
 * @import import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "@agent-native/toolkit/ui/base-ui/select";
 */
function Select<Value, Multiple extends boolean | undefined = false>(
  props: SelectProps<Value, Multiple>,
) {
  const [
    attributes,
    { "aria-label": label, "aria-labelledby": labelledBy, ...rest },
  ] = splitProps(selectRootProps, props);
  const size = attributes["data-size"];
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const [returnFocus, requestReturnFocus] = React.useReducer(
    (n: number) => n + 1,
    0,
  );
  React.useLayoutEffect(() => {
    if (!returnFocus) return;
    queueMicrotask(() => {
      const trigger = triggerRef.current;
      const list = listRef.current;
      if (
        trigger?.getAttribute("aria-expanded") === "false" &&
        list?.contains(activeElementInRoot(list))
      )
        trigger.focus({ preventScroll: true });
    });
  }, [returnFocus]);
  const context = React.useMemo(
    () => ({
      size,
      triggerRef,
      listRef,
      name: {
        ...(label === undefined ? {} : { "aria-label": label }),
        ...(labelledBy === undefined ? {} : { "aria-labelledby": labelledBy }),
      },
    }),
    [size, label, labelledBy],
  );
  return (
    <SelectContext.Provider value={context}>
      <BaseSelect.Root<Value, Multiple>
        {...rest}
        onOpenChange={(open, details) => {
          rest.onOpenChange?.(open, details);
          if (
            !open &&
            !details.isCanceled &&
            details.reason === "item-press" &&
            listRef.current
          )
            requestReturnFocus();
        }}
      />
    </SelectContext.Provider>
  );
}

/**
 * Groups related options, labelled by a SelectGroupLabel inside it. It is Base UI's
 * own part.
 *
 * @import import { SelectGroup } from "@agent-native/toolkit/ui/base-ui/select";
 */
export const SelectGroup = BaseSelect.Group;

/**
 * The selected option's label, shown in the trigger, or a placeholder while
 * nothing is selected.
 *
 * @import import { SelectValue } from "@agent-native/toolkit/ui/base-ui/select";
 */
const SelectValue = React.forwardRef<HTMLSpanElement, BaseSelect.Value.Props>(
  ({ className, ...props }, ref) => (
    <BaseSelect.Value
      ref={ref}
      className={partClassName("select-value", className)}
      {...props}
    />
  ),
);
SelectValue.displayName = "SelectValue";

export interface SelectTriggerProps
  extends Omit<BaseSelect.Trigger.Props, "color">, SelectTriggerOwnProps {}

/**
 * The button that shows the selected value and opens the list, with a chevron
 * after it.
 *
 * @import import { SelectTrigger } from "@agent-native/toolkit/ui/base-ui/select";
 */
const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  (props, ref) => {
    const [attributes, { className, children, ...rest }] = splitProps(
      selectTriggerProps,
      props,
    );
    const { size, name, triggerRef } = React.useContext(SelectContext);
    return useRender({
      defaultTagName: "button",
      ref: [ref, triggerRef ?? null],
      render: (
        <BaseSelect.Trigger
          data-slot="select-trigger"
          {...rest}
          {...inheritedName(name, rest)}
          {...attributes}
          data-size={size}
          className={partClassName("select-trigger", className)}
        >
          {children}
          <BaseSelect.Icon className="select-icon">
            <IconChevronDown />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
      ),
    });
  },
);
SelectTrigger.displayName = "SelectTrigger";

type PositionerProps = Pick<
  BaseSelect.Positioner.Props,
  | "anchor"
  | "side"
  | "align"
  | "sideOffset"
  | "alignOffset"
  | "collisionBoundary"
  | "collisionPadding"
  | "collisionAvoidance"
  | "sticky"
  | "arrowPadding"
  | "disableAnchorTracking"
  | "positionMethod"
  | "alignItemWithTrigger"
>;

export type SelectPopupProps = Omit<BaseSelect.Popup.Props, "color"> &
  PositionerProps &
  SelectPopupOwnProps & {
    container?: BaseSelect.Portal.Props["container"];
  };

/**
 * The list's popup, anchored below the trigger; it can overlap the trigger like
 * a native menu instead.
 *
 * @import import { SelectPopup } from "@agent-native/toolkit/ui/base-ui/select";
 */
const SelectPopup = React.forwardRef<HTMLDivElement, SelectPopupProps>(
  (props, ref) => {
    const [
      attributes,
      {
        className,
        children,
        container,
        "aria-label": label,
        "aria-labelledby": labelledBy,
        alignItemWithTrigger = false,
        ...rest
      },
    ] = splitProps(selectPopupProps, props);
    const [positioner, popup] = splitPositionerProps(rest);
    const { size, name, listRef } = React.useContext(SelectContext);
    return (
      <SelectPortal container={container}>
        <BaseSelect.Positioner
          className="select-positioner"
          align="start"
          sideOffset={4}
          alignItemWithTrigger={alignItemWithTrigger}
          {...positioner}
        >
          <BaseSelect.Popup
            ref={ref}
            data-slot="select-content"
            {...popup}
            {...attributes}
            data-size={size}
            className={partClassName("select-popup", className)}
          >
            <BaseSelect.List
              ref={
                props.finalFocus === undefined || props.finalFocus === true
                  ? listRef
                  : undefined
              }
              className="select-list"
              aria-label={label}
              aria-labelledby={labelledBy}
              {...inheritedName(name, props)}
            >
              {children}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </SelectPortal>
    );
  },
);
SelectPopup.displayName = "SelectPopup";

/**
 * The heading of a SelectGroup.
 *
 * @import import { SelectGroupLabel } from "@agent-native/toolkit/ui/base-ui/select";
 */
const SelectGroupLabel = React.forwardRef<
  HTMLDivElement,
  BaseSelect.GroupLabel.Props
>(({ className, ...props }, ref) => (
  <BaseSelect.GroupLabel
    ref={ref}
    className={partClassName("select-group-label", className)}
    {...props}
  />
));
SelectGroupLabel.displayName = "SelectGroupLabel";

/**
 * One option in the list, with a check beside it while selected.
 *
 * @import import { SelectItem } from "@agent-native/toolkit/ui/base-ui/select";
 */
const SelectItem = React.forwardRef<HTMLDivElement, BaseSelect.Item.Props>(
  ({ className, children, ...props }, ref) => (
    <BaseSelect.Item
      ref={ref}
      className={partClassName("select-item", className)}
      {...props}
    >
      <BaseSelect.ItemIndicator className="select-item-indicator">
        <IconCheck />
      </BaseSelect.ItemIndicator>
      <BaseSelect.ItemText className="select-item-text">
        {children}
      </BaseSelect.ItemText>
    </BaseSelect.Item>
  ),
);
SelectItem.displayName = "SelectItem";

/**
 * A line between groups of options.
 *
 * @import import { SelectSeparator } from "@agent-native/toolkit/ui/base-ui/select";
 */
const SelectSeparator = React.forwardRef<
  HTMLDivElement,
  BaseSelect.Separator.Props
>(({ className, ...props }, ref) => (
  <BaseSelect.Separator
    ref={ref}
    className={partClassName("select-separator", className)}
    {...props}
  />
));
SelectSeparator.displayName = "SelectSeparator";

export {
  Select,
  SelectPopup,
  SelectItem,
  SelectGroupLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
