import type { BlockEditProps, BlockReadProps } from "@agent-native/core/blocks";
import type { DiagramData } from "@shared/blocks/diagram.config";
import { SketchDiagram } from "../wireframe/Wireframe";

/**
 * Read-only renderer for a `diagram` block. Mirrors the legacy `PlanBlockView`
 * diagram branch (same `plan-block` section + title + `SketchDiagram` + trailing
 * summary) so converting the block to the registry does not change the rendered
 * output. `SketchDiagram`'s `compact` mode (used only in dense tab panes) is not
 * threaded through the registry context, so the registry path renders the
 * standard, non-compact diagram — matching the normal document flow.
 */
export function DiagramBlock({
  data,
  blockId,
  title,
  summary,
}: BlockReadProps<DiagramData>) {
  return (
    <section className="plan-block" data-block-id={blockId}>
      {title && <h2>{title}</h2>}
      <SketchDiagram data={data} />
      {summary && <p className="mt-5 text-plan-muted">{summary}</p>}
    </section>
  );
}

/**
 * Edit renderer for a `diagram` block. Diagram editing stays comment/patch-driven
 * (the node/edge/note graph is positional structured data, not form fields), so
 * the editor renders the same read-only `SketchDiagram` rather than the schema
 * auto-editor — which would otherwise show "needs a custom editor" hints for the
 * array fields. This keeps edit mode from regressing the diagram's appearance.
 *
 * Like the schema auto-editor, this renders BARE content (just the diagram
 * canvas, no `<section>`/title/summary). In edit mode `PlanBlockView` wraps the
 * registry output in the standard titled `plan-block` section itself, so the
 * editor must not render its own section or the chrome double-nests.
 */
export function DiagramBlockEdit({ data }: BlockEditProps<DiagramData>) {
  return <SketchDiagram data={data} />;
}
