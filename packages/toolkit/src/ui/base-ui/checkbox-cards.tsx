import {
  type CheckboxCardsOwnProps,
  checkboxCardsProps,
  checkboxProps,
} from "@agent-native/design-system";
import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { CheckboxGroup as BaseCheckboxGroup } from "@base-ui/react/checkbox-group";
import { IconCheck, IconMinus } from "@tabler/icons-react";
import * as React from "react";

import { createGroupProps } from "./group-props.js";
import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export interface CheckboxCardsProps
  extends Omit<BaseCheckboxGroup.Props, "color">, CheckboxCardsOwnProps {}

const checkboxCardsItemProps = createGroupProps(checkboxCardsProps);

/**
 * A set of cards that each check on and off, on Base UI's Checkbox Group as in
 * Radix Themes' CheckboxCards. Use it when each choice needs more than a label;
 * set the grid's columns with `--checkbox-cards-columns` and its gap with
 * `--checkbox-cards-gap`.
 *
 * @import import { CheckboxCards, CheckboxCardsItem } from "@agent-native/toolkit/ui/base-ui/checkbox-cards";
 */
const CheckboxCards = React.forwardRef<HTMLDivElement, CheckboxCardsProps>(
  (props, ref) => {
    const [attributes, { className, ...rest }] = splitProps(
      checkboxCardsProps,
      props,
    );
    return (
      <checkboxCardsItemProps.GroupProps value={props}>
        <BaseCheckboxGroup
          ref={ref}
          {...rest}
          {...attributes}
          className={partClassName("checkbox-cards", className)}
        />
      </checkboxCardsItemProps.GroupProps>
    );
  },
);
CheckboxCards.displayName = "CheckboxCards";

export type CheckboxCardsItemProps = Omit<BaseCheckbox.Root.Props, "color">;

/**
 * One card: a checkbox whose content is its name, so the whole card is the hit
 * area, with a check drawn at its inline end.
 *
 * @import import { CheckboxCardsItem } from "@agent-native/toolkit/ui/base-ui/checkbox-cards";
 */
const CheckboxCardsItem = React.forwardRef<HTMLElement, CheckboxCardsItemProps>(
  ({ className, children, ...props }, ref) => {
    const group = checkboxCardsItemProps.useGroupProps<CheckboxCardsOwnProps>(
      {},
    );
    const [attributes] = splitProps(checkboxCardsProps, group);
    // The corner box is the checkbox part drawn at the card's size, always
    // surface as in Radix; the card itself is the control.
    const [boxAttributes] = splitProps(checkboxProps, {
      ...group,
      variant: "surface",
    });
    return (
      <BaseCheckbox.Root
        ref={ref}
        {...props}
        {...attributes}
        className={partClassName("checkbox-cards-item", className)}
      >
        {children}
        <BaseCheckbox.Indicator
          keepMounted
          {...boxAttributes}
          className="checkbox checkbox-cards-checkbox"
          render={(indicatorProps, state) => (
            <span {...indicatorProps} aria-hidden>
              {state.checked || state.indeterminate ? (
                <span className="checkbox-indicator">
                  {state.indeterminate ? <IconMinus /> : <IconCheck />}
                </span>
              ) : null}
            </span>
          )}
        />
      </BaseCheckbox.Root>
    );
  },
);
CheckboxCardsItem.displayName = "CheckboxCardsItem";

export { CheckboxCards, CheckboxCardsItem };
