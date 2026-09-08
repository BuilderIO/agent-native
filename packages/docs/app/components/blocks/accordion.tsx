import { defineBlock } from "@agent-native/core/blocks";
import type { BlockReadProps } from "@agent-native/core/blocks";
import { IconChevronDown } from "@tabler/icons-react";

import {
  accordionSchema,
  accordionMdx,
  type AccordionData,
} from "./accordion.config";

export type { AccordionData };

export function AccordionBlock({ data, ctx }: BlockReadProps<AccordionData>) {
  return (
    <div className="docs-accordion">
      {data.items.map((item, i) => (
        <details key={i} className="docs-accordion-item">
          <summary className="docs-accordion-trigger">
            <span>{item.title}</span>
            <IconChevronDown
              className="docs-accordion-chevron"
              aria-hidden="true"
            />
          </summary>
          <div className="docs-accordion-body">
            {ctx.renderMarkdown?.(item.body) ?? <p>{item.body}</p>}
          </div>
        </details>
      ))}
    </div>
  );
}

export const accordionBlock = defineBlock<AccordionData>({
  type: "accordion",
  schema: accordionSchema,
  mdx: accordionMdx,
  Read: AccordionBlock,
  placement: ["block"],
  label: "Accordion",
  description:
    "Collapsed-by-default items for FAQ-style content — a title per item, expand on click, native <details> semantics.",
  empty: () => ({
    items: [{ title: "Question", body: "Answer." }],
  }),
});
