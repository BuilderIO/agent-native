import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import { Button } from "../../../src/ui/base-ui/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../src/ui/base-ui/tooltip.js";

interface TooltipCase {
  id: string;
  label: string;
  text: string;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

const CASES: readonly TooltipCase[] = [
  { id: "default", label: "Rank", text: "Rank order" },
  { id: "shortcut", label: "New", side: "bottom", text: "new chat(\\u2318K)" },
  {
    id: "wrapping",
    label: "Details",
    side: "right",
    className: "max-w-48 whitespace-normal",
    text: "Long descriptions wrap once a template narrows the tooltip.",
  },
];

function TooltipSection() {
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  return (
    <div className="relative">
      <TooltipProvider>
        <div className="flex flex-col items-start gap-16 py-10">
          {CASES.map((testCase) => (
            <Tooltip key={testCase.id} open>
              <TooltipTrigger
                render={<Button variant="surface" color="gray" size="2" />}
              >
                {testCase.label}
              </TooltipTrigger>
              {container ? (
                <TooltipContent
                  side={testCase.side}
                  className={testCase.className}
                  container={container}
                >
                  {testCase.text}
                </TooltipContent>
              ) : null}
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
      <div ref={setContainer} />
    </div>
  );
}

const meta = {
  title: "Components/Tooltip",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

/** Every case open at once: default, shortcut text, and a wrapping tooltip. */
export const States: StoryObj = {
  render: () => <TooltipSection />,
};
