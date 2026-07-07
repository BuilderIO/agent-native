import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { renderPlanBlockAuthoringExamples } from "../server/plan-block-examples.js";
import {
  describePlanBlocksForAgent,
  renderPlanBlockVocabulary,
} from "../shared/plan-block-registry.js";

/**
 * Appended to the block vocabulary so the agent learns the heading convention
 * from the same authoritative source it reads before authoring. Blocks no longer
 * carry a bespoke `title` label; headings are standard Markdown `###` headings in
 * a `rich-text` block, which are inline-editable and join the document outline.
 */
const BLOCK_HEADING_NOTE = `

## Block headings

Blocks do not take a \`title\`. To give a block a heading, place a \`rich-text\` block whose markdown is a \`###\` (h3) heading directly above the block. Those headings are real, inline-editable, and appear in the document outline — unlike the legacy block \`title\` field, which renders as a small muted label and cannot be edited in place. This includes the bottom Open Questions form: put an \`### Open Questions\` heading above the \`question-form\` block rather than titling it. The \`title\` field still renders for older plans, but do not set it on new blocks.`;

/**
 * Authoritative authoring canon appended to the block catalog return value.
 * Lives here so the style rules are backed by the registry and apply to every
 * create/update action that defers to get-plan-blocks instead of repeating the
 * rules in per-action describe strings.
 */
const AUTHORING_RULES_NOTE = `

## Authoring rules

**Diagrams**: use \`diagram\` blocks with \`data.html\`/\`data.css\`. Use renderer-owned classes: \`.diagram-panel\`, \`.diagram-card\`, \`.diagram-node\`, \`.diagram-box\`, \`.diagram-pill\`, \`.diagram-muted\`, plus \`data-rough\`. Use \`--wf-*\` CSS tokens for color; never set custom fonts or hard-code hex/rgb/hsl values. Legacy nodes/edges only for tiny previews or true step-by-step flows. Use \`mermaid\` only when textual grammar is materially clearer than a spatial layout.

**Wireframes**: set \`data.html\` to a semantic HTML fragment; pick a surface (desktop/mobile/popover/panel/browser). The renderer owns theme, footprint/aspect, Excalifont, and rough.js sketch overlay. Use \`--wf-*\` CSS tokens for any custom color (never hex). Prototype screens use semantic HTML with \`data-goto\` attributes for navigation.

**Visual frames**: \`wireframe\` and \`diagram\` data accept \`frame: "auto" | "show" | "hide"\`. Leave it unset/\`auto\` when the host context should decide: Plan and recap surfaces default to framed; docs default to unframed. Use \`frame: "show"\` for standalone product screens, before/after recap comparisons, screenshot-like artifacts, and visuals that need containment from surrounding prose. Use \`frame: "hide"\` when a docs page, tab, column, card, canvas artboard, or the visual's own internal chrome already supplies the boundary. Hiding the outer frame must not remove inner padding, meaningful card/field/button borders, or the visual's readable structure.

**Canvas storyboards**: if the user asks for a canvas, storyboard, wireframe, light storyboard, UI flow, screen flow, product flow, mockup, or visual comparison, the primary artifact must be \`content.canvas\` / \`canvas.mdx\` with \`DesignBoard\` artboards containing \`Screen\` HTML wireframes. Each canvas \`Screen\` must carry \`html\` / \`data.html\`; never author fresh nested kit-tree children such as \`<FrameScreen>\`, \`<Card>\`, \`<Row>\`, or \`<Btn>\` inside canvas \`<Screen>\` tags. Kit trees are old-plan compatibility only and often render worse on the pan/zoom canvas than HTML wireframes. Do not use document-body \`diagram\` blocks for the primary UI story. Use \`diagram\` only for architecture, data flow, or implementation mechanics below the canvas, and only after the UI storyboard exists.

**Before/After columns**: compose a \`columns\` block from \`<Column>\` CHILDREN — never a \`columns=\` attribute or inline JSON array. Author it as \`<Columns><Column label="Before">…child block(s)…</Column><Column label="After">…child block(s)…</Column></Columns>\`. Each \`<Column>\` wraps real nested blocks (e.g. a \`Wireframe\`); the parser fills in column ids and child-block \`data\` from that markup, whereas a \`columns=\` attribute array leaves them missing and FAILS schema validation. For UI state comparisons put one \`wireframe\` block in each side and label the columns \`Before\` and \`After\`; the renderer draws labels as headings and lays narrow surfaces side by side. Never bake Before/After labels inside the wireframe HTML or hand-stack the pair.

**MDX prose and component syntax**: write ordinary top-level prose as normal Markdown; it imports as rich-text automatically. Use \`<RichText id="...">…</RichText>\` only when prose needs explicit metadata such as \`title\`, \`summary\`, or \`editable\`, or when preserving a referenced block id. Every capitalized block component must be self-closing (\`<Diagram id="..." data={{ ... }} />\`) or have a matching closing tag around children (\`<RichText id="...">…</RichText>\`). Never write a bare opening tag like \`<RichText ...>\` as a paragraph; the MDX parser treats it as unclosed JSX and import fails before the plan can render.

**Code-bearing blocks**: \`code\`, \`annotated-code\`, and \`diff\` are whitespace-sensitive. Prefer the exact MDX form emitted by the authoring examples / source exporter, where multiline code is encoded as JSON string attributes such as \`code={\"const x =\\\\n  y\"}\`. Static template literals are accepted and preserve indentation, but they must be static strings with no \`\${...}\` interpolation.

**File maps**: prefer \`annotated-code\` blocks (real code + line-anchored notes) grouped in a vertical \`tabs\` block, one tab per key file. Drop to a plain \`code\` block only for throwaway snippets with nothing to call out.

**Tabs grouping**: use horizontal \`TabsBlock\` groups for multiple related diffs so each split diff gets full document width.

**API endpoints**: keep \`api-endpoint\` and \`openapi-spec\` blocks in normal single-column document flow. Use \`columns\` only for an explicit before/after contract comparison.

**renderMode**: leave unset or set to \`wireframe\` unless a design-only editable mock is required.\``;

/**
 * Expose the live plan block vocabulary to the agent. The list is generated from
 * the block registry (`registerPlanBlocks`) — the same config the MDX adapter and
 * the browser renderer use — so the schema/tags the agent sees always match what
 * the app can actually render and round-trip. Surface it before authoring or
 * editing structured plan `content` so `/visual-plan` only emits valid blocks.
 */
export default defineAction({
  description:
    "List the structured plan block types the app can render and round-trip (type, MDX tag, placement, key data fields, JSON schema). Read this before writing structured plan content so the blocks you emit are valid. Generated from the live block registry. Blocks take no `title`: give a block a heading by placing a `rich-text` block with a Markdown `###` heading directly above it.",
  schema: z.object({
    format: z
      .enum(["reference", "schema"])
      .optional()
      .default("reference")
      .describe(
        "`reference` returns a compact markdown table; `schema` returns the full per-block JSON schemas.",
      ),
  }),
  http: { method: "GET" },
  requiresAuth: false,
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: false,
    title: "List Plan Blocks",
    description:
      "List the plan block vocabulary (types, MDX tags, and schemas) the plan editor can render.",
  },
  mcpApp: {
    compactCatalog: true,
  },
  run: async (args) => {
    const blocks = describePlanBlocksForAgent();
    // The authoring examples are generated at runtime from canonical blocks via
    // the real source serializer, so the copy-able MDX can never drift from the
    // schema (see plan-block-examples.ts + block-authoring-examples.spec.ts).
    const authoringExamples = await renderPlanBlockAuthoringExamples();
    return {
      reference:
        renderPlanBlockVocabulary() +
        BLOCK_HEADING_NOTE +
        AUTHORING_RULES_NOTE +
        authoringExamples,
      ...(args.format === "schema" ? { blocks } : {}),
      count: blocks.length,
    };
  },
});
