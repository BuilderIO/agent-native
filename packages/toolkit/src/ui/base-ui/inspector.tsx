import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

/** The property editor for a selection. Name the landmark with aria-label or aria-labelledby.
 * @import import { Inspector } from "@agent-native/toolkit/ui/base-ui/inspector";
 */
export function Inspector({
  render,
  ...props
}: useRender.ComponentProps<"aside">) {
  return useRender({
    defaultTagName: "aside",
    render,
    props: mergeProps<"aside">({ className: "inspector" }, props),
  });
}

/** Holds the selection heading and optional trailing actions.
 * @import import { InspectorHeader } from "@agent-native/toolkit/ui/base-ui/inspector";
 */
export function InspectorHeader({
  render,
  ...props
}: useRender.ComponentProps<"header">) {
  return useRender({
    defaultTagName: "header",
    render,
    props: mergeProps<"header">({ className: "inspector-header" }, props),
  });
}

/** Groups related controls. Compose Collapsible inside for a disclosure.
 * @import import { InspectorSection } from "@agent-native/toolkit/ui/base-ui/inspector";
 */
export function InspectorSection({
  render,
  ...props
}: useRender.ComponentProps<"section">) {
  return useRender({
    defaultTagName: "section",
    render,
    props: mergeProps<"section">({ className: "inspector-section" }, props),
  });
}

/** Keeps the section heading and independent actions on one line.
 * @import import { InspectorSectionHeader } from "@agent-native/toolkit/ui/base-ui/inspector";
 */
export function InspectorSectionHeader({
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "inspector-section-header" }, props),
  });
}

/** Stacks controls and property lists inside a section.
 * @import import { InspectorContent } from "@agent-native/toolkit/ui/base-ui/inspector";
 */
export function InspectorContent({
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "inspector-content" }, props),
  });
}

/** Two property columns and a trailing action slot. */
export function InspectorGrid({
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "inspector-grid" }, props),
  });
}

/** A caption directly above its control. Associate labels with their input using htmlFor. */
export function InspectorField({
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "inspector-field" }, props),
  });
}
