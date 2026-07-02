import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { PlanContent } from "../shared/plan-content.js";
import createVisualPlan from "./create-visual-plan.js";

/**
 * DEV-ONLY one-off seed: creates a real, persisted plan packed with `tabs`
 * blocks in `orientation: "vertical"` so the vertical side-rail layout can be
 * exercised by hand. Covers the cases most likely to surface bugs: a baseline,
 * a long tab list that should scroll the rail, very long labels that should
 * truncate, tabs full of heavy nested blocks, a single-tab edge case, a
 * horizontal block for side-by-side comparison, and tabs nested inside tabs.
 * Made public so it opens at /plans/<id> without a session. Run against a
 * throwaway local SQLite DB; safe to delete.
 */

const SAMPLE_TS = `export function renderTab(tab: TabsTab, active: boolean) {
  return (
    <button role="tab" aria-selected={active} className={cx(active && "is-active")}>
      <span className="truncate">{tab.label}</span>
    </button>
  );
}`;

const ANNOTATED_TS = `export function TabsBlockReader({ block, ctx }: ReaderProps) {
  const vertical = block.data.orientation === "vertical";
  const [active, setActive] = useState(block.data.tabs[0]?.id);
  return (
    <div className={vertical ? "grid md:grid-cols-[14rem_1fr]" : "flex flex-col"}>
      <TabRail tabs={block.data.tabs} active={active} onSelect={setActive} />
      <TabPanel block={findTab(block, active)} render={ctx.renderBlock} />
    </div>
  );
}`;

const DIFF_BEFORE = `<div className="flex gap-2 overflow-x-auto">
  {tabs.map((t) => (
    <button key={t.id}>{t.label}</button>
  ))}
</div>`;

const DIFF_AFTER = `<div className={cx(
  vertical
    ? "md:flex-col md:max-h-[62vh] md:overflow-y-auto"
    : "flex gap-2 overflow-x-auto",
)}>
  {tabs.map((t) => (
    <button key={t.id} className="md:w-full md:text-left">
      <span className="truncate">{t.label}</span>
    </button>
  ))}
</div>`;

// Ten tabs to exercise the scrollable side rail (max-h-[62vh] + overflow-y-auto).
const manyTabs = Array.from({ length: 10 }, (_, i) => {
  const n = i + 1;
  return {
    id: `vt-many-tab-${n}`,
    label: `Step ${n}`,
    blocks: [
      {
        id: `vt-many-tab-${n}-body`,
        type: "rich-text" as const,
        data: {
          markdown: `### Step ${n}\n\nContent for step ${n}. With ten tabs the left rail should scroll independently while the panel on the right stays put. Selecting a far-down tab should keep it visible in the rail.`,
        },
      },
      {
        id: `vt-many-tab-${n}-code`,
        type: "code" as const,
        data: {
          language: "ts",
          filename: `step-${n}.ts`,
          code: `export const step${n} = () => ${n} * ${n}; // = ${n * n}`,
        },
      },
    ],
  };
});

const content: PlanContent = {
  version: 1,
  title: "Vertical tabs — bug repro",
  brief:
    "A grab-bag of vertical (side-rail) tabs blocks to poke at: long lists, long labels, heavy nested content, single tab, horizontal comparison, and nested tabs.",
  blocks: [
    {
      id: "intro",
      type: "rich-text",
      data: {
        markdown:
          '# Vertical tabs test bed\n\nEvery `tabs` block below uses `orientation: "vertical"` except the one explicitly marked horizontal. Click around, resize the window across the `md` breakpoint, and watch for: rail not scrolling, labels not truncating, active state desyncing, content overflow, or layout jumps. Section 6 is a horizontal block with identical content for a side-by-side reference.',
      },
    },

    // 1 — Baseline
    {
      id: "h-basic",
      type: "rich-text",
      data: {
        markdown:
          "## 1 · Baseline — three tabs\n\nText, code, and a callout in three vertical tabs. The simplest case; everything else is a stress test of this.",
      },
    },
    {
      id: "vt-basic",
      type: "tabs",
      data: {
        orientation: "vertical",
        tabs: [
          {
            id: "vt-basic-overview",
            label: "Overview",
            blocks: [
              {
                id: "vt-basic-overview-text",
                type: "rich-text",
                data: {
                  markdown:
                    "Vertical tabs put the rail on the left at `md+` and collapse to a horizontal scroller below `md`. This is the baseline.",
                },
              },
            ],
          },
          {
            id: "vt-basic-code",
            label: "Code",
            blocks: [
              {
                id: "vt-basic-code-block",
                type: "code",
                data: {
                  language: "tsx",
                  filename: "tabs.tsx",
                  code: SAMPLE_TS,
                },
              },
            ],
          },
          {
            id: "vt-basic-notes",
            label: "Notes",
            blocks: [
              {
                id: "vt-basic-notes-callout",
                type: "callout",
                data: {
                  tone: "info",
                  body: "Switching tabs should not scroll the page or shift the rail width.",
                },
              },
            ],
          },
        ],
      },
    },

    // 2 — Long list (scrollable rail)
    {
      id: "h-many",
      type: "rich-text",
      data: {
        markdown:
          "## 2 · Long list — ten tabs (scrollable rail)\n\nThe rail is capped at `max-h-[62vh]` with `overflow-y-auto`. Scroll it independently of the content and select a tab near the bottom.",
      },
    },
    {
      id: "vt-many",
      type: "tabs",
      data: {
        orientation: "vertical",
        tabs: manyTabs,
      },
    },

    // 3 — Long labels (truncation)
    {
      id: "h-long",
      type: "rich-text",
      data: {
        markdown:
          "## 3 · Long labels — truncation\n\nLabels longer than the rail width should truncate with an ellipsis, not wrap or blow out the rail's fixed width.",
      },
    },
    {
      id: "vt-long",
      type: "tabs",
      data: {
        orientation: "vertical",
        tabs: [
          {
            id: "vt-long-1",
            label:
              "A very long tab label that definitely exceeds the rail width and should truncate",
            blocks: [
              {
                id: "vt-long-1-body",
                type: "rich-text",
                data: {
                  markdown:
                    "This tab's label is intentionally long. The rail width is `minmax(10rem,14rem)`; the label span has `truncate`.",
                },
              },
            ],
          },
          {
            id: "vt-long-2",
            label:
              "Another absurdly verbose label/with/slashes/that/keeps/going",
            blocks: [
              {
                id: "vt-long-2-body",
                type: "rich-text",
                data: { markdown: "Second long-label tab." },
              },
            ],
          },
          {
            id: "vt-long-3",
            label: "Short",
            blocks: [
              {
                id: "vt-long-3-body",
                type: "rich-text",
                data: { markdown: "A short label next to the long ones." },
              },
            ],
          },
        ],
      },
    },

    // 4 — Heavy nested content
    {
      id: "h-heavy",
      type: "rich-text",
      data: {
        markdown:
          "## 4 · Heavy nested content\n\nEach tab holds a different rich block (annotated-code, diff, data-model, file-tree). Tests recursive rendering inside the vertical grid and how the content column handles wide blocks.",
      },
    },
    {
      id: "vt-heavy",
      type: "tabs",
      data: {
        orientation: "vertical",
        tabs: [
          {
            id: "vt-heavy-annotated",
            label: "annotated-code",
            blocks: [
              {
                id: "vt-heavy-annotated-block",
                type: "annotated-code",
                data: {
                  filename: "tabs.tsx",
                  language: "tsx",
                  code: ANNOTATED_TS,
                  annotations: [
                    {
                      lines: "2",
                      label: "vertical",
                      note: "Branch on orientation to pick the grid vs flex layout.",
                    },
                    {
                      lines: "5",
                      label: "rail",
                      note: "Vertical → two-column grid; horizontal → stacked flex.",
                    },
                  ],
                },
              },
            ],
          },
          {
            id: "vt-heavy-diff",
            label: "diff (unified)",
            blocks: [
              {
                id: "vt-heavy-diff-block",
                type: "diff",
                data: {
                  filename: "tab-rail.tsx",
                  language: "tsx",
                  mode: "unified",
                  before: DIFF_BEFORE,
                  after: DIFF_AFTER,
                  annotations: [
                    {
                      lines: "2",
                      label: "rail",
                      note: "Vertical rail gets max height + vertical scroll.",
                    },
                    {
                      lines: "9",
                      label: "label",
                      note: "Full-width, left-aligned, truncating label in vertical mode.",
                    },
                  ],
                },
              },
            ],
          },
          {
            id: "vt-heavy-model",
            label: "data-model",
            blocks: [
              {
                id: "vt-heavy-model-block",
                type: "data-model",
                data: {
                  entities: [
                    {
                      id: "tabs_block",
                      name: "tabs_block",
                      fields: [
                        { name: "id", type: "string", pk: true },
                        { name: "orientation", type: "enum" },
                        { name: "tabs", type: "tab[]" },
                      ],
                    },
                    {
                      id: "tab",
                      name: "tab",
                      fields: [
                        { name: "id", type: "string", pk: true },
                        { name: "label", type: "string" },
                        { name: "blocks", type: "block[]" },
                      ],
                    },
                  ],
                  relations: [
                    {
                      from: "tabs_block",
                      to: "tab",
                      kind: "1-n",
                      label: "tabs",
                    },
                  ],
                },
              },
            ],
          },
          {
            id: "vt-heavy-files",
            label: "file-tree",
            blocks: [
              {
                id: "vt-heavy-files-block",
                type: "file-tree",
                data: {
                  title: "Vertical-tab surfaces",
                  entries: [
                    {
                      path: "packages/core/src/client/blocks/library/tabs.tsx",
                      change: "modified",
                      note: "Reader + editor + settings popover.",
                    },
                    {
                      path: "packages/core/src/client/blocks/library/tabs.config.ts",
                      change: "modified",
                      note: "orientation schema + MDX round-trip.",
                    },
                    {
                      path: "packages/core/src/client/blocks/library/tab-rails.spec.tsx",
                      change: "added",
                      note: "Vertical rail render + layout-switch tests.",
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    },

    // 5 — Single tab edge case
    {
      id: "h-single",
      type: "rich-text",
      data: {
        markdown:
          "## 5 · Single tab (edge case)\n\nThe minimum is one tab. A lone vertical tab still reserves the rail column — check it doesn't look broken or leave a dead gap.",
      },
    },
    {
      id: "vt-single",
      type: "tabs",
      data: {
        orientation: "vertical",
        tabs: [
          {
            id: "vt-single-only",
            label: "Only tab",
            blocks: [
              {
                id: "vt-single-only-body",
                type: "callout",
                data: {
                  tone: "warning",
                  body: "Single vertical tab: rail on the left, content on the right, nothing to switch to.",
                },
              },
            ],
          },
        ],
      },
    },

    // 6 — Horizontal comparison
    {
      id: "h-horizontal",
      type: "rich-text",
      data: {
        markdown:
          "## 6 · Horizontal comparison (reference)\n\nIdentical content to the baseline but `orientation` omitted (horizontal pill rail). Use this to tell renderer bugs apart from orientation-specific ones.",
      },
    },
    {
      id: "ht-basic",
      type: "tabs",
      data: {
        tabs: [
          {
            id: "ht-basic-overview",
            label: "Overview",
            blocks: [
              {
                id: "ht-basic-overview-text",
                type: "rich-text",
                data: {
                  markdown:
                    "Horizontal pill rail on top, content below. Same three tabs as section 1.",
                },
              },
            ],
          },
          {
            id: "ht-basic-code",
            label: "Code",
            blocks: [
              {
                id: "ht-basic-code-block",
                type: "code",
                data: {
                  language: "tsx",
                  filename: "tabs.tsx",
                  code: SAMPLE_TS,
                },
              },
            ],
          },
          {
            id: "ht-basic-notes",
            label: "Notes",
            blocks: [
              {
                id: "ht-basic-notes-callout",
                type: "callout",
                data: {
                  tone: "info",
                  body: "Compare active-state and spacing against the vertical baseline.",
                },
              },
            ],
          },
        ],
      },
    },

    // 7 — Nested tabs
    {
      id: "h-nested",
      type: "rich-text",
      data: {
        markdown:
          "## 7 · Nested tabs (vertical inside vertical)\n\nA vertical tab whose content is itself a vertical tabs block. Recursion + nested grids are a classic source of layout and active-state bugs.",
      },
    },
    {
      id: "vt-nested",
      type: "tabs",
      data: {
        orientation: "vertical",
        tabs: [
          {
            id: "vt-nested-outer-a",
            label: "Outer A",
            blocks: [
              {
                id: "vt-nested-outer-a-intro",
                type: "rich-text",
                data: {
                  markdown:
                    "Outer tab A contains a nested vertical tabs block:",
                },
              },
              {
                id: "vt-nested-inner",
                type: "tabs",
                data: {
                  orientation: "vertical",
                  tabs: [
                    {
                      id: "vt-nested-inner-1",
                      label: "Inner one",
                      blocks: [
                        {
                          id: "vt-nested-inner-1-body",
                          type: "rich-text",
                          data: {
                            markdown:
                              "Inner vertical tab one. Does the nested rail get its own width/scroll, or collide with the outer one?",
                          },
                        },
                      ],
                    },
                    {
                      id: "vt-nested-inner-2",
                      label: "Inner two",
                      blocks: [
                        {
                          id: "vt-nested-inner-2-body",
                          type: "code",
                          data: {
                            language: "ts",
                            code: "// nested vertical tab content\nconst nested = true;",
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
          {
            id: "vt-nested-outer-b",
            label: "Outer B",
            blocks: [
              {
                id: "vt-nested-outer-b-body",
                type: "callout",
                data: {
                  tone: "decision",
                  body: "Outer tab B is plain, to confirm switching outer tabs resets/keeps inner state sanely.",
                },
              },
            ],
          },
        ],
      },
    },
  ],
};

export default defineAction({
  description: "DEV-ONLY: seed a public vertical-tabs bug-repro plan.",
  agentTool: false,
  schema: z.object({}).optional(),
  run: async () => {
    if (process.env.NODE_ENV !== "development") {
      throw new Error(
        "seed actions are dev-only and disabled in production (NODE_ENV must be 'development')",
      );
    }
    const result = (await createVisualPlan.run({
      title: content.title,
      brief: content.brief,
      source: "manual",
      status: "review",
      content,
      sections: [],
      comments: [],
    } as never)) as { planId: string };

    const planId = result.planId;
    // Keep it PRIVATE so the local single-user identity (which an unauthenticated
    // localhost browser resolves to) stays the owner and can EDIT it. Marking it
    // public would flip the browser into a read-only public-viewer session.
    await getDb()
      .update(schema.plans)
      .set({ visibility: "private" })
      .where(eq(schema.plans.id, planId));

    console.log("SEEDED_PLAN_ID:", planId);
    console.log("OPEN: /plans/" + planId);
    return { planId, path: "/plans/" + planId };
  },
});
