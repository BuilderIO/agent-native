import type { BlockEditProps, BlockReadProps } from "@agent-native/core/blocks";
import type { DiagramData } from "@shared/blocks/diagram.config";
import { SketchDiagram } from "../wireframe/Wireframe";

/**
 * Read-only renderer for a `diagram` block. `SketchDiagram` now handles both
 * preferred HTML/SVG diagrams and legacy node graphs.
 */
export function DiagramBlock({
  data,
  blockId,
  title,
  summary,
}: BlockReadProps<DiagramData>) {
  return (
    <section className="plan-block" data-block-id={blockId}>
      {title && <div className="plan-block-label">{title}</div>}
      <SketchDiagram data={data} />
      {summary && <p className="mt-5 text-plan-muted">{summary}</p>}
    </section>
  );
}

/**
 * Edit renderer for a `diagram` block. Diagram editing stays comment/patch-driven
 * (HTML/SVG or graph data is easier to patch than form-edit), so the editor
 * renders the same read-only `SketchDiagram` rather than the schema auto-editor.
 *
 * Like the schema auto-editor, this renders BARE content (just the diagram
 * canvas, no `<section>`/title/summary). In edit mode `PlanBlockView` wraps the
 * registry output in the standard titled `plan-block` section itself, so the
 * editor must not render its own section or the chrome double-nests.
 */
export function DiagramBlockEdit({ data }: BlockEditProps<DiagramData>) {
  return <SketchDiagram data={data} />;
}
