import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "../../../src/ui/base-ui/accordion.js";
import guide from "./accordion.docs.md?raw";

const QUESTIONS = [
  ["Where is my data stored?", "In your workspace's own database."],
  ["Can I export it?", "Yes, as JSON or CSV from Settings."],
  ["Who can see it?", "Members of your organization you share it with."],
] as const;

const items = QUESTIONS.map(([question, answer], index) => (
  <AccordionItem key={question} value={String(index)}>
    <AccordionTrigger>{question}</AccordionTrigger>
    <AccordionPanel>{answer}</AccordionPanel>
  </AccordionItem>
));

const meta = {
  title: "Components/Accordion",
  component: Accordion,
  parameters: { docs: { description: { component: guide } }, layout: "padded" },
  args: { defaultValue: ["0"], multiple: false, children: items },
  argTypes: {
    multiple: {
      control: "boolean",
      description: "Base UI's: lets more than one item stay open.",
    },
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Accordion>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Three items with the first open. Radix Themes has no accordion, so it
 * takes only Base UI's props.
 */
export const Playground: Story = {};

/** Several open at once, and an item that is disabled. */
export const States: Story = {
  render: () => (
    <Accordion multiple defaultValue={["0", "1"]}>
      {items}
      <AccordionItem value="3" disabled>
        <AccordionTrigger>Can I delete it?</AccordionTrigger>
        <AccordionPanel>Ask an owner of the workspace.</AccordionPanel>
      </AccordionItem>
    </Accordion>
  ),
};
