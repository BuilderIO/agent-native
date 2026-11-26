import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import * as React from "react";

import { partClassName } from "./part-class.js";

export type CollapsibleProps = BaseCollapsible.Root.Props;

/**
 * A single section that shows or hides its content, on Base UI's Collapsible.
 * For several sections, use Accordion.
 *
 * @import import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "@agent-native/toolkit/ui/base-ui/collapsible";
 */
const Collapsible = React.forwardRef<HTMLDivElement, CollapsibleProps>(
  ({ className, ...props }, ref) => (
    <BaseCollapsible.Root
      ref={ref}
      className={partClassName("collapsible", className)}
      {...props}
    />
  ),
);
Collapsible.displayName = "Collapsible";

export type CollapsibleTriggerProps = BaseCollapsible.Trigger.Props;

/**
 * The button that opens and closes the panel. It has no look of its own; render
 * it as a Button or a row.
 *
 * @import import { CollapsibleTrigger } from "@agent-native/toolkit/ui/base-ui/collapsible";
 */
const CollapsibleTrigger = React.forwardRef<
  HTMLButtonElement,
  CollapsibleTriggerProps
>(({ className, ...props }, ref) => (
  <BaseCollapsible.Trigger
    ref={ref}
    className={partClassName("collapsible-trigger", className)}
    {...props}
  />
));
CollapsibleTrigger.displayName = "CollapsibleTrigger";

export type CollapsiblePanelProps = BaseCollapsible.Panel.Props;

/**
 * The content shown while the collapsible is open.
 *
 * @import import { CollapsiblePanel } from "@agent-native/toolkit/ui/base-ui/collapsible";
 */
const CollapsiblePanel = React.forwardRef<
  HTMLDivElement,
  CollapsiblePanelProps
>(({ className, ...props }, ref) => (
  <BaseCollapsible.Panel
    ref={ref}
    className={partClassName("collapsible-panel", className)}
    {...props}
  />
));
CollapsiblePanel.displayName = "CollapsiblePanel";

export { Collapsible, CollapsibleTrigger, CollapsiblePanel };
