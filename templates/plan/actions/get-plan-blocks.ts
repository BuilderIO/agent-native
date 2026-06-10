import { defineAction } from "@agent-native/core";
import { z } from "zod";
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

**Before/After columns**: for UI state comparisons, put one \`wireframe\` block in each side of a \`columns\` block and set the column labels to \`Before\` and \`After\`; the renderer draws labels as headings and lays narrow surfaces side by side. Never bake Before/After labels inside the wireframe HTML or hand-stack the pair.

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
    return {
      reference:
        renderPlanBlockVocabulary() + BLOCK_HEADING_NOTE + AUTHORING_RULES_NOTE,
      ...(args.format === "schema" ? { blocks } : {}),
      count: blocks.length,
    };
  },
});
