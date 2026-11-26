Use an accordion when several related sections compete for space. In a property panel, each heading can disclose its controls while the other headings stay available.

Give every `AccordionItem` a stable `value`. Its `AccordionTrigger` supplies the heading and button semantics and links the button to its `AccordionPanel`. Use a short heading that still makes sense when the panel is closed. The focused trigger responds to Enter and Space.

The example starts with Layout open. Add `multiple` to allow simultaneous sections, or supply `value` and `onValueChange` to remember the open sections with the document. The value is an array even in single-section mode.

```tsx
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionPanel,
} from "@agent-native/toolkit/ui/base-ui/accordion";

export function FrameDetails() {
  return (
    <Accordion defaultValue={["layout"]}>
      <AccordionItem value="layout">
        <AccordionTrigger>Layout</AccordionTrigger>
        <AccordionPanel>Horizontal stack with an 8 px gap</AccordionPanel>
      </AccordionItem>
      <AccordionItem value="appearance">
        <AccordionTrigger>Appearance</AccordionTrigger>
        <AccordionPanel>Surface fill at 100% opacity</AccordionPanel>
      </AccordionItem>
    </Accordion>
  );
}
```

[Multiple open sections and a disabled item](?path=/story/components-accordion--states)

[Base UI Accordion](https://base-ui.com/react/components/accordion) · [Radix Accordion](https://www.radix-ui.com/primitives/docs/components/accordion)
