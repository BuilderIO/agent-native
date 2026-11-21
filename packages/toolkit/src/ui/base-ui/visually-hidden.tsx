import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

export type VisuallyHiddenProps = useRender.ComponentProps<"span">;

/**
 * Content for assistive technology only, as Radix Themes' VisuallyHidden, such
 * as the name of a control that shows only an icon.
 *
 * @import import { VisuallyHidden } from "@agent-native/toolkit/ui/base-ui/visually-hidden";
 */
function VisuallyHidden({ render, ...props }: VisuallyHiddenProps) {
  return useRender({
    defaultTagName: "span",
    render,
    props: mergeProps<"span">({ className: "visually-hidden" }, props),
  });
}

export { VisuallyHidden };
