import type { BlockReadProps } from "@agent-native/core/blocks";
import type { CalloutData } from "@shared/blocks/callout.config";
import { PlanMarkdownReader } from "../PlanMarkdownReader";

/**
 * Read-only renderer for a `callout` block. Mirrors the legacy `PlanBlockView`
 * callout branch byte-for-byte (same `plan-block plan-callout` section + title +
 * `PlanMarkdownReader` body) so converting the block to the registry does not
 * change the rendered output. A `data-tone` attribute is set when a tone is
 * present so future tone styling can hook in without touching the markup.
 */
export function CalloutBlock({
  data,
  blockId,
  title,
}: BlockReadProps<CalloutData>) {
  return (
    <section
      className="plan-block plan-callout"
      data-block-id={blockId}
      data-tone={data.tone}
    >
      {title && <div className="plan-block-label">{title}</div>}
      <PlanMarkdownReader markdown={data.body} />
    </section>
  );
}
