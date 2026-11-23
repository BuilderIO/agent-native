import { Accordion as BaseAccordion } from "@base-ui/react/accordion";
import { IconChevronDown } from "@tabler/icons-react";
import * as React from "react";

import { partClassName } from "./part-class.js";

export type AccordionProps = BaseAccordion.Root.Props;

/**
 * A stack of headed sections that each show or hide their content, on Base UI's
 * Accordion. Use it to let people scan headings and open only what they need.
 *
 * @import import { Accordion, AccordionItem, AccordionTrigger, AccordionPanel } from "@agent-native/toolkit/ui/base-ui/accordion";
 */
const Accordion = React.forwardRef<HTMLDivElement, AccordionProps>(
  ({ className, ...props }, ref) => (
    <BaseAccordion.Root
      ref={ref}
      className={partClassName("accordion", className)}
      {...props}
    />
  ),
);
Accordion.displayName = "Accordion";

export type AccordionItemProps = BaseAccordion.Item.Props;

/**
 * One section of the accordion: a trigger and the panel it opens.
 *
 * @import import { AccordionItem } from "@agent-native/toolkit/ui/base-ui/accordion";
 */
const AccordionItem = React.forwardRef<HTMLDivElement, AccordionItemProps>(
  ({ className, ...props }, ref) => (
    <BaseAccordion.Item
      ref={ref}
      className={partClassName("accordion-item", className)}
      {...props}
    />
  ),
);
AccordionItem.displayName = "AccordionItem";

export type AccordionTriggerProps = BaseAccordion.Trigger.Props;

/**
 * The heading button that opens and closes its item's panel. It is Base UI's
 * header and trigger together, with a chevron after the label.
 *
 * @import import { AccordionTrigger } from "@agent-native/toolkit/ui/base-ui/accordion";
 */
const AccordionTrigger = React.forwardRef<
  HTMLButtonElement,
  AccordionTriggerProps
>(({ className, children, ...props }, ref) => (
  <BaseAccordion.Header className="accordion-header">
    <BaseAccordion.Trigger
      ref={ref}
      className={partClassName("accordion-trigger", className)}
      {...props}
    >
      {children}
      <IconChevronDown className="accordion-chevron" aria-hidden />
    </BaseAccordion.Trigger>
  </BaseAccordion.Header>
));
AccordionTrigger.displayName = "AccordionTrigger";

export type AccordionPanelProps = BaseAccordion.Panel.Props;

/**
 * The content an item shows while open.
 *
 * @import import { AccordionPanel } from "@agent-native/toolkit/ui/base-ui/accordion";
 */
const AccordionPanel = React.forwardRef<HTMLDivElement, AccordionPanelProps>(
  ({ className, ...props }, ref) => (
    <BaseAccordion.Panel
      ref={ref}
      className={partClassName("accordion-panel", className)}
      {...props}
    />
  ),
);
AccordionPanel.displayName = "AccordionPanel";

export { Accordion, AccordionItem, AccordionTrigger, AccordionPanel };
