import type { BlockReadProps, BlockEditProps } from "@agent-native/core/blocks";
import type { WireframeData } from "@shared/blocks/wireframe.config";
import type { PlanWireframeBlock } from "@shared/plan-content";
import { KitWireframeBlock } from "../wireframe/Wireframe";

/**
 * Read-only renderer for a `wireframe` block. Mirrors the legacy `PlanBlockView`
 * wireframe branch byte-for-byte (same `plan-block` section + optional title +
 * `KitWireframeBlock` + optional summary) so converting the block to the
 * registry does not change rendered output. `KitWireframeBlock` owns the actual
 * sketch surface render from the kit tree / html mockup.
 */
export function WireframeBlock({
  data,
  blockId,
  title,
  summary,
}: BlockReadProps<WireframeData>) {
  return (
    <section className="plan-block" data-block-id={blockId}>
      {title && <h2>{title}</h2>}
      <KitWireframeBlock block={{ data } as PlanWireframeBlock} />
      {summary && <p className="mt-5 text-plan-muted">{summary}</p>}
    </section>
  );
}

/**
 * Custom editor for the `wireframe` block. The wireframe is canvas / agent-patch
 * edited (node-addressable `update-wireframe-node` / `replace-wireframe-screen`
 * content patches applied server-side), NOT schema-form edited in the browser.
 * So edit mode REUSES the existing read render — it never calls `onChange`, which
 * preserves today's behavior exactly: agent patches mutate the stored data and
 * the new `data` flows back in and re-renders identically.
 *
 * `PlanBlockView` already wraps the registry edit path in a titled `plan-block`
 * section (with title + summary), so here we render only the `KitWireframeBlock`
 * surface to avoid double-nesting — the resulting markup matches the legacy
 * wireframe branch (section → title → wireframe → summary).
 */
export function WireframeEditor({ data }: BlockEditProps<WireframeData>) {
  return <KitWireframeBlock block={{ data } as PlanWireframeBlock} />;
}
