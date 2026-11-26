import {
  type RadioCardsOwnProps,
  radioCardsProps,
} from "@agent-native/design-system";
import { Radio as BaseRadio } from "@base-ui/react/radio";
import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
import * as React from "react";

import { createGroupProps } from "./group-props.js";
import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export interface RadioCardsProps
  extends Omit<BaseRadioGroup.Props, "color">, RadioCardsOwnProps {}

const radioCardsItemProps = createGroupProps(radioCardsProps);

/**
 * A set of cards of which the user picks one, for options that need more than a
 * label: Base UI's Radio Group whose radios are cards, as in Radix Themes. Set
 * the grid's columns with `--radio-cards-columns`.
 *
 * @import import { RadioCards, RadioCardsItem } from "@agent-native/toolkit/ui/base-ui/radio-cards";
 */
const RadioCards = React.forwardRef<HTMLDivElement, RadioCardsProps>(
  (props, ref) => {
    const [attributes, { className, ...rest }] = splitProps(
      radioCardsProps,
      props,
    );
    return (
      <radioCardsItemProps.GroupProps value={props}>
        <BaseRadioGroup
          ref={ref}
          {...rest}
          {...attributes}
          className={partClassName("radio-cards", className)}
        />
      </radioCardsItemProps.GroupProps>
    );
  },
);
RadioCards.displayName = "RadioCards";

export interface RadioCardsItemProps
  extends Omit<BaseRadio.Root.Props, "color">, RadioCardsOwnProps {}

/**
 * One card in the set: a radio holding its own content, so the whole card is
 * the hit area and its content is its name.
 *
 * @import import { RadioCardsItem } from "@agent-native/toolkit/ui/base-ui/radio-cards";
 */
const RadioCardsItem = React.forwardRef<HTMLElement, RadioCardsItemProps>(
  (props, ref) => {
    const [attributes, { className, ...rest }] = splitProps(
      radioCardsProps,
      radioCardsItemProps.useGroupProps(props),
    );
    return (
      <BaseRadio.Root
        ref={ref}
        {...rest}
        {...attributes}
        className={partClassName("radio-cards-item", className)}
      />
    );
  },
);
RadioCardsItem.displayName = "RadioCardsItem";

export { RadioCards, RadioCardsItem };
