import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

/** A stack of editable properties. Each row accepts a native label or a named group of controls.
 * @import import { PropertyList } from "@agent-native/toolkit/ui/base-ui/property-list";
 */
export function PropertyList({
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "property-list" }, props),
  });
}

/** Aligns a label with one or more controls.
 * @import import { PropertyRow } from "@agent-native/toolkit/ui/base-ui/property-list";
 */
export function PropertyRow({
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "property-list-row" }, props),
  });
}

/** Use htmlFor for one input. For a group, render a span and reference its id with aria-labelledby.
 * @import import { PropertyLabel } from "@agent-native/toolkit/ui/base-ui/property-list";
 */
export function PropertyLabel({
  render,
  ...props
}: useRender.ComponentProps<"label">) {
  return useRender({
    defaultTagName: "label",
    render,
    props: mergeProps<"label">({ className: "property-list-label" }, props),
  });
}

/** The control area. Sibling controls share available width.
 * @import import { PropertyValue } from "@agent-native/toolkit/ui/base-ui/property-list";
 */
export function PropertyValue({
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "property-list-value" }, props),
  });
}
