import {
  type ScrollAreaOwnProps,
  scrollAreaProps,
} from "@agent-native/design-system";
import { ScrollArea as BaseScrollArea } from "@base-ui/react/scroll-area";
import * as React from "react";

import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export interface ScrollAreaProps
  extends BaseScrollArea.Root.Props, ScrollAreaOwnProps {}

/**
 * A scrolling region with overlay scrollbars that show while it scrolls or is
 * hovered, on Base UI's Scroll Area with Radix Themes' props. Use it where the
 * platform's own scrollbars would clash with the design.
 *
 * @import import { ScrollArea } from "@agent-native/toolkit/ui/base-ui/scroll-area";
 */
const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  (props, ref) => {
    const [attributes, { className, children, ...rest }] = splitProps(
      scrollAreaProps,
      props,
    );
    const scrollbars = attributes["data-scrollbars"];
    return (
      <BaseScrollArea.Root
        ref={ref}
        {...rest}
        {...attributes}
        className={partClassName("scroll-area", className)}
      >
        <BaseScrollArea.Viewport className="scroll-area-viewport">
          {children}
        </BaseScrollArea.Viewport>
        {scrollbars !== "horizontal" ? (
          <BaseScrollArea.Scrollbar
            orientation="vertical"
            className="scroll-area-scrollbar"
          >
            <BaseScrollArea.Thumb className="scroll-area-thumb" />
          </BaseScrollArea.Scrollbar>
        ) : null}
        {scrollbars !== "vertical" ? (
          <BaseScrollArea.Scrollbar
            orientation="horizontal"
            className="scroll-area-scrollbar"
          >
            <BaseScrollArea.Thumb className="scroll-area-thumb" />
          </BaseScrollArea.Scrollbar>
        ) : null}
        {scrollbars === "both" ? (
          <BaseScrollArea.Corner className="scroll-area-corner" />
        ) : null}
      </BaseScrollArea.Root>
    );
  },
);
ScrollArea.displayName = "ScrollArea";

export { ScrollArea };
