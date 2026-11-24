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

export interface CheckboxCardsItemProps
  extends Omit<BaseCheckbox.Root.Props, "color">, CheckboxCardsOwnProps {
  /** Replaces the trailing checkbox. Use CheckboxIndicator for a custom selection mark. */
  indicator?: React.ReactNode;
}

/**
 * One card: a checkbox whose content is its name, so the whole card is the hit
 * area, with a check drawn at its inline end.
 *
 * @import import { CheckboxCardsItem } from "@agent-native/toolkit/ui/base-ui/checkbox-cards";
 */
const CheckboxCardsItem = React.forwardRef<HTMLElement, CheckboxCardsItemProps>(
  (props, ref) => {
    const merged = checkboxCardsItemProps.useGroupProps(props);
    const [attributes, { className, children, indicator, ...rest }] =
      splitProps(checkboxCardsProps, merged);
    const [boxAttributes] = splitProps(checkboxProps, {
      color: merged.color,
      highContrast: merged.highContrast,
      variant: "surface",
    });
    return (
      <BaseCheckbox.Root
        ref={ref}
        {...rest}
        {...attributes}
        className={partClassName("checkbox-cards-item", className)}
      >
        {children}
        {indicator === undefined ? (
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
        ) : indicator == null ? null : (
          <span className="checkbox-cards-mark" aria-hidden>
            {indicator}
          </span>
        )}
      </BaseCheckbox.Root>
    );
  },
);
CheckboxCardsItem.displayName = "CheckboxCardsItem";

export { CheckboxCards, CheckboxCardsItem };
