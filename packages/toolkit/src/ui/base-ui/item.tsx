import {
  type ItemGroupOwnProps,
  itemGroupProps,
  type ItemMediaOwnProps,
  itemMediaProps,
  type ItemOwnProps,
  itemProps,
} from "@agent-native/design-system";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { ComponentProps } from "react";

import { splitProps } from "./props.js";

type Attributes<Tag extends "div" | "h2" | "p" | "span"> =
  ComponentProps<Tag> & {
    [attribute: `data-${string}`]: string | undefined;
  };

export interface ItemGroupProps
  extends useRender.ComponentProps<"div">, ItemGroupOwnProps {}

/**
 * A list of Items, such as people, settings, files or connections. It sets
 * no role: give it `role="list"` only when it holds nothing but Items.
 *
 * @import import { ItemGroup, Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from "@agent-native/toolkit/ui/base-ui/item";
 */
function ItemGroup(props: ItemGroupProps) {
  const [attributes, { render, ...rest }] = splitProps(itemGroupProps, props);
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "item-group", ...attributes }, rest),
  });
}

export type ItemGroupHeaderProps = useRender.ComponentProps<"div">;

/**
 * The row above a list, holding its label and an action at the end.
 *
 * @import import { ItemGroupHeader } from "@agent-native/toolkit/ui/base-ui/item";
 */
function ItemGroupHeader({ render, ...props }: ItemGroupHeaderProps) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "item-group-header" }, props),
  });
}

export interface ItemGroupLabelProps extends useRender.ComponentProps<"h2"> {
  /** Names the list for assistive technology only, drawing nothing. */
  visuallyHidden?: boolean;
}

/**
 * Names the list under it: a heading, `h2` unless rendered as another.
 *
 * @import import { ItemGroupLabel } from "@agent-native/toolkit/ui/base-ui/item";
 */
function ItemGroupLabel({
  render,
  visuallyHidden = false,
  ...props
}: ItemGroupLabelProps) {
  const own: Attributes<"h2"> = {
    className: "item-group-label",
    "data-visually-hidden": visuallyHidden ? "" : undefined,
  };
  return useRender({
    defaultTagName: "h2",
    render,
    props: mergeProps<"h2">(own, props),
  });
}

export interface ItemProps
  extends useRender.ComponentProps<"div">, ItemOwnProps {}

/**
 * A row in a list: media, a title and description, actions at the end, and
 * an optional footer. Radix Themes has no Item; render it as a link or a
 * button to make the whole row act.
 *
 * @import import { Item } from "@agent-native/toolkit/ui/base-ui/item";
 */
function Item(props: ItemProps) {
  const [attributes, { render, ...rest }] = splitProps(itemProps, props);
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "item", ...attributes }, rest),
  });
}

export interface ItemMediaProps
  extends useRender.ComponentProps<"span">, ItemMediaOwnProps {}

/**
 * The icon or picture at the start of a row. A framed icon is decorative;
 * unframed media, such as an Avatar, is not.
 *
 * @import import { ItemMedia } from "@agent-native/toolkit/ui/base-ui/item";
 */
function ItemMedia(props: ItemMediaProps) {
  const [attributes, { render, ...rest }] = splitProps(itemMediaProps, props);
  const own: Attributes<"span"> = {
    className: "item-media",
    ...attributes,
    "aria-hidden": props.framed === true ? true : undefined,
  };
  return useRender({
    defaultTagName: "span",
    render,
    props: mergeProps<"span">(own, rest),
  });
}

export type ItemContentProps = useRender.ComponentProps<"div">;

/**
 * Holds the title and description, taking the row's free width.
 *
 * @import import { ItemContent } from "@agent-native/toolkit/ui/base-ui/item";
 */
function ItemContent({ render, ...props }: ItemContentProps) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "item-content" }, props),
  });
}

export type ItemTitleProps = useRender.ComponentProps<"div">;

/**
 * The row's name, the first line of its content.
 *
 * @import import { ItemTitle } from "@agent-native/toolkit/ui/base-ui/item";
 */
function ItemTitle({ render, ...props }: ItemTitleProps) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "item-title" }, props),
  });
}

export type ItemDescriptionProps = useRender.ComponentProps<"p">;

/**
 * A line of detail under the row's title.
 *
 * @import import { ItemDescription } from "@agent-native/toolkit/ui/base-ui/item";
 */
function ItemDescription({ render, ...props }: ItemDescriptionProps) {
  return useRender({
    defaultTagName: "p",
    render,
    props: mergeProps<"p">({ className: "item-description" }, props),
  });
}

export type ItemActionsProps = useRender.ComponentProps<"div">;

/**
 * Controls at the row's end, such as a Switch, Buttons or a menu trigger.
 *
 * @import import { ItemActions } from "@agent-native/toolkit/ui/base-ui/item";
 */
function ItemActions({ render, ...props }: ItemActionsProps) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "item-actions" }, props),
  });
}

export type ItemFooterProps = useRender.ComponentProps<"div">;

/**
 * Content under the row across its full width, such as a form it opens.
 *
 * @import import { ItemFooter } from "@agent-native/toolkit/ui/base-ui/item";
 */
function ItemFooter({ render, ...props }: ItemFooterProps) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "item-footer" }, props),
  });
}

export {
  ItemGroup,
  ItemGroupHeader,
  ItemGroupLabel,
  Item,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
  ItemFooter,
};
