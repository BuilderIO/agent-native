import {
  BlockRegistry,
  defineBlock,
  registerBlocks,
} from "@agent-native/core/blocks/server";
import {
  calloutSchema,
  calloutMdx,
  type CalloutData,
} from "./blocks/callout.config.js";
import {
  diagramSchema,
  diagramMdx,
  type DiagramData,
} from "./blocks/diagram.config.js";
import {
  wireframeSchema,
  wireframeMdx,
  type WireframeData,
} from "./blocks/wireframe.config.js";
import {
  checklistSchema,
  checklistMdx,
  type ChecklistData,
  tableSchema,
  tableMdx,
  type TableData,
  codeTabsSchema,
  codeTabsMdx,
  type CodeTabsData,
  htmlSchema,
  htmlMdx,
  type HtmlBlockData,
  tabsSchema,
  tabsMdx,
  type TabsData,
} from "@agent-native/core/blocks/server";

/**
 * Server / shared plan block registry. Registers the React-free parts of each
 * converted block (schema + MDX config) so the MDX adapter (`plan-mdx.ts`) and
 * agent schema export can serialize/parse/describe blocks without importing
 * React. The CLIENT registry (`app/components/plan/planBlocks.tsx`) registers the
 * same blocks WITH their `Read`/`Edit` React components for rendering — both use
 * the identical `mdx`/`schema` config (`shared/blocks/*.config.ts`) so source
 * round-trip stays consistent.
 *
 * `Read` is required on `BlockSpec`, so each server spec gets a render-only stub
 * (`() => null`) that is never invoked on the server. Unregistered block types
 * keep using the legacy `serializeBlock`/`parseBlock` path unchanged.
 */
export function registerPlanBlocks(registry: BlockRegistry): void {
  registerBlocks(registry, [
    defineBlock<CalloutData>({
      type: "callout",
      schema: calloutSchema,
      mdx: calloutMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "Callout",
      description:
        "An emphasized note with a tone (info/decision/risk/warning/success) and a markdown body.",
    }),
    defineBlock<DiagramData>({
      type: "diagram",
      schema: diagramSchema,
      mdx: diagramMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "Diagram",
      description:
        "A sketch flow diagram of labeled nodes connected by edges, with optional notes.",
    }),
    defineBlock<ChecklistData>({
      type: "checklist",
      schema: checklistSchema,
      mdx: checklistMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "Checklist",
      description:
        "A list of toggleable items, each with a label and an optional note.",
    }),
    defineBlock<CodeTabsData>({
      type: "code-tabs",
      schema: codeTabsSchema,
      mdx: codeTabsMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "Code tabs",
      description:
        "A vertical file tab rail of syntax-highlighted code snippets, one tab per file with an optional language and caption.",
    }),
    defineBlock<TableData>({
      type: "table",
      schema: tableSchema,
      mdx: tableMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "Table",
      description:
        "A simple grid with header columns and string rows for comparisons, parameters, or structured lists.",
    }),
    defineBlock<WireframeData>({
      type: "wireframe",
      schema: wireframeSchema,
      mdx: wireframeMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "Wireframe",
      description:
        "A sketch wireframe of one screen built from kit primitives (or an HTML mockup), rendered in a chosen surface frame (desktop/mobile/popover/panel/browser).",
    }),
    defineBlock<HtmlBlockData>({
      type: "custom-html",
      schema: htmlSchema,
      mdx: htmlMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "HTML / Tailwind",
      description:
        "An author-supplied HTML (with optional CSS) fragment rendered in a sandboxed iframe, with inline source editing.",
    }),
    defineBlock<TabsData>({
      type: "tabs",
      schema: tabsSchema,
      mdx: tabsMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block", "inline"],
      label: "Tabs",
      description:
        "A horizontal pill-tab container; each tab holds its own list of blocks.",
    }),
  ]);
}
