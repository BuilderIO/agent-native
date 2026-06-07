import { useEffect, useId, useState } from "react";
import {
  AiEditableFieldLabel,
  type BlockEditProps,
  type BlockReadProps,
} from "@agent-native/core/blocks";
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

export function DiagramBlockEdit({
  data,
  onChange,
  editable,
  blockId,
  title,
  summary,
  ctx,
}: BlockEditProps<DiagramData>) {
  const htmlId = useId();
  const cssId = useId();
  const captionId = useId();
  const legacyId = useId();
  const [html, setHtml] = useState(data.html ?? "");
  const [css, setCss] = useState(data.css ?? "");
  const [caption, setCaption] = useState(data.caption ?? "");
  const [legacyJson, setLegacyJson] = useState(() =>
    JSON.stringify(
      {
        nodes: data.nodes ?? [],
        edges: data.edges ?? [],
        notes: data.notes ?? [],
      },
      null,
      2,
    ),
  );

  useEffect(() => {
    setHtml(data.html ?? "");
    setCss(data.css ?? "");
    setCaption(data.caption ?? "");
    setLegacyJson(
      JSON.stringify(
        {
          nodes: data.nodes ?? [],
          edges: data.edges ?? [],
          notes: data.notes ?? [],
        },
        null,
        2,
      ),
    );
  }, [data]);

  const saveHtmlDiagram = () => {
    onChange({
      html: html.trim() || undefined,
      css: css.trim() || undefined,
      caption: caption.trim() || undefined,
      nodes: data.nodes,
      edges: data.edges,
      notes: data.notes,
    });
  };

  const saveLegacyDiagram = () => {
    const parsed = JSON.parse(legacyJson) as Pick<
      DiagramData,
      "nodes" | "edges" | "notes"
    >;
    onChange({
      ...data,
      nodes: parsed.nodes ?? [],
      edges: parsed.edges ?? [],
      notes: parsed.notes ?? [],
    });
  };

  const fieldAction = (
    field: "HTML / SVG fragment" | "CSS" | "caption" | "legacy node graph JSON",
    value: string,
  ) => ({
    blockId,
    blockType: "diagram",
    blockTitle: title,
    blockSummary: summary,
    fieldValue: value,
    draftScope: `plan:diagram:${blockId}:${field.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    disabled: !editable,
    instructions:
      "Update the plan with update-visual-plan using a targeted update-block content patch for this diagram block id. Preserve unrelated diagram fields unless the requested edit requires changing them. Keep diagram HTML/CSS on renderer-owned .diagram-* primitives and --wf-* tokens; do not introduce custom font-family or hard-coded hex/rgb/hsl colors.",
    companionFields: [
      {
        label: "HTML / SVG fragment",
        value: html.trim() || "(empty)",
        language: "html",
      },
      { label: "CSS", value: css.trim() || "(empty)", language: "css" },
      {
        label: "caption",
        value: caption.trim() || "(empty)",
        language: "text",
      },
    ],
  });

  return (
    <div className="grid gap-4" data-plan-interactive>
      <button
        type="button"
        className="inline-flex h-8 w-fit items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
        disabled={!editable}
        onClick={saveHtmlDiagram}
      >
        Save diagram
      </button>
      <div className="group/field grid gap-1.5">
        <AiEditableFieldLabel
          htmlFor={htmlId}
          label="HTML / SVG fragment"
          ctx={ctx}
          action={fieldAction("HTML / SVG fragment", html)}
        />
        <textarea
          id={htmlId}
          className="min-h-48 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-5 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={html}
          disabled={!editable}
          onChange={(event) => setHtml(event.target.value)}
          placeholder="<div class='diagram'>...</div>"
        />
      </div>
      <div className="group/field grid gap-1.5">
        <AiEditableFieldLabel
          htmlFor={cssId}
          label="CSS"
          ctx={ctx}
          action={fieldAction("CSS", css)}
        />
        <textarea
          id={cssId}
          className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-5 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={css}
          disabled={!editable}
          onChange={(event) => setCss(event.target.value)}
          placeholder=".diagram { display: grid; }"
        />
      </div>
      <div className="group/field grid gap-1.5">
        <AiEditableFieldLabel
          htmlFor={captionId}
          label="Caption"
          ctx={ctx}
          action={fieldAction("caption", caption)}
        />
        <input
          id={captionId}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={caption}
          disabled={!editable}
          onChange={(event) => setCaption(event.target.value)}
        />
      </div>
      {!data.html && (
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
            Legacy node graph data
          </summary>
          <div className="group/field mt-3 grid gap-1.5">
            <AiEditableFieldLabel
              htmlFor={legacyId}
              label="JSON"
              ctx={ctx}
              action={fieldAction("legacy node graph JSON", legacyJson)}
            />
            <textarea
              id={legacyId}
              className="min-h-44 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-5 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={legacyJson}
              disabled={!editable}
              onChange={(event) => setLegacyJson(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="mt-3 inline-flex h-8 items-center justify-center rounded-md border border-input px-3 text-xs font-medium text-foreground disabled:opacity-50"
            disabled={!editable}
            onClick={saveLegacyDiagram}
          >
            Save graph data
          </button>
        </details>
      )}
    </div>
  );
}
