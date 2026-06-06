import { useState } from "react";
import { IconLayoutNavbar, IconPlus, IconX } from "@tabler/icons-react";
import { cn } from "../../utils.js";
import { defineBlock } from "../types.js";
import type { BlockReadProps, BlockEditProps, NestedBlock } from "../types.js";
import {
  tabsSchema,
  tabsMdx,
  type TabsData,
  type TabsTab,
} from "./tabs.config.js";

/**
 * Standard `tabs` block: a horizontal pill-tab container whose tabs each hold a
 * list of child blocks. Lives in core so any app (plan today, content later) can
 * register it.
 *
 * `Read`/`Edit` mirror the legacy plan `TabsBlock` markup byte-for-byte (same
 * `plan-block` section, the `inline-flex` pill tab rail with `role="tablist"`/
 * `role="tab"`, the same active-tab `useState`, and the `compactVisuals`
 * heuristic on the block title) so converting the block to the registry does not
 * change rendered output. The plan CSS classes (`plan-block`, `bg-plan-block`,
 * `text-plan-*`) resolve against the plan app's stylesheet at render time,
 * exactly as before.
 *
 * Child rendering flows through `ctx.renderBlock` — the app's own block
 * dispatcher — so registered children render via their spec and unconverted
 * children fall through the app's legacy switch. This is the coexistence seam:
 * the core tabs block never has to know app-specific child block types.
 */

/** Mint a reasonably-unique tab id without pulling a dep into core. */
function newTabId(): string {
  return `tab-${Math.random().toString(36).slice(2, 10)}`;
}

/** Compact embedded visuals for dense tab panes, matching legacy behavior. */
function isCompact(title: string | undefined): boolean {
  return /interaction|component|note/i.test(title ?? "");
}

/** Shared pill-tab rail. */
function TabRail({
  tabs,
  activeId,
  onSelect,
}: {
  tabs: TabsTab[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      className="mb-8 inline-flex max-w-full gap-1 overflow-x-auto"
      role="tablist"
      data-plan-interactive
    >
      {tabs.map((tab) => {
        const selected = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.id)}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
              selected
                ? "bg-plan-block text-plan-text shadow-sm"
                : "text-plan-muted hover:bg-plan-block/60 hover:text-plan-text",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/** Read renderer: pill tabs, child blocks rendered read-only via the app. */
export function TabsBlockReader({
  data,
  blockId,
  title,
  ctx,
}: BlockReadProps<TabsData>) {
  const [activeId, setActiveId] = useState(data.tabs[0]?.id ?? "");
  const active = data.tabs.find((tab) => tab.id === activeId) ?? data.tabs[0];
  const compact = isCompact(title);
  return (
    <section className="plan-block" data-block-id={blockId}>
      {title && <div className="plan-block-label">{title}</div>}
      <TabRail tabs={data.tabs} activeId={active?.id} onSelect={setActiveId} />
      {active && (
        <div>
          {active.blocks.map((child) => (
            <div key={child.id}>
              {ctx.renderBlock?.({
                block: child,
                editing: false,
                compactVisuals: compact,
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Editor: pill tabs plus tab management (add/remove/rename), with child blocks
 * rendered editable in place through the app dispatcher. A child change updates
 * that child within its tab and commits the whole tabs block — mirroring the
 * legacy `TabsBlock` onChange bubbling so the plan's recursive `updateBlocks`/
 * `findBlock` (`PlanContentRenderer`) keeps working unchanged.
 */
export function TabsBlockEditor({
  data,
  onChange,
  editable,
  blockId,
  title,
  ctx,
}: BlockEditProps<TabsData>) {
  const [activeId, setActiveId] = useState(data.tabs[0]?.id ?? "");
  const active = data.tabs.find((tab) => tab.id === activeId) ?? data.tabs[0];
  const compact = isCompact(title);

  const commit = (tabs: TabsTab[]) => onChange({ tabs });

  const renameTab = (id: string, label: string) =>
    commit(data.tabs.map((tab) => (tab.id === id ? { ...tab, label } : tab)));

  const removeTab = (id: string) => {
    const next = data.tabs.filter((tab) => tab.id !== id);
    if (next.length === 0) return; // tabs must keep at least one (schema min 1)
    commit(next);
    if (activeId === id) setActiveId(next[0]?.id ?? "");
  };

  const addTab = () => {
    if (data.tabs.length >= 12) return; // schema max
    const id = newTabId();
    commit([
      ...data.tabs,
      { id, label: `Tab ${data.tabs.length + 1}`, blocks: [] },
    ]);
    setActiveId(id);
  };

  const updateChild = (tabId: string, child: NestedBlock) =>
    commit(
      data.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              blocks: tab.blocks.map((existing) =>
                existing.id === child.id ? child : existing,
              ),
            }
          : tab,
      ),
    );

  // Renders BARE (no `plan-block` section / title): in edit mode the app's
  // block dispatcher already wraps registered editors in a titled `plan-block`
  // section, so wrapping again here would double-nest. The read renderer
  // (`TabsBlockReader`) owns its own section because read mode renders the spec
  // directly.
  return (
    <div data-tabs-edit-block={blockId}>
      <div
        className="mb-8 flex max-w-full flex-wrap items-center gap-1 overflow-x-auto"
        role="tablist"
        data-plan-interactive
      >
        {data.tabs.map((tab) => {
          const selected = tab.id === active?.id;
          return (
            <div
              key={tab.id}
              className={cn(
                "group flex items-center gap-1 rounded-lg pr-1 transition-colors",
                selected ? "bg-plan-block shadow-sm" : "hover:bg-plan-block/60",
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveId(tab.id)}
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
                  selected ? "text-plan-text" : "text-plan-muted",
                )}
              >
                {tab.label}
              </button>
              {editable && data.tabs.length > 1 && (
                <button
                  type="button"
                  data-plan-interactive
                  aria-label={`Remove ${tab.label}`}
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded text-plan-muted transition-opacity",
                    "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                    "hover:bg-muted hover:text-foreground",
                  )}
                  onClick={() => removeTab(tab.id)}
                >
                  <IconX className="size-3.5 shrink-0" />
                </button>
              )}
            </div>
          );
        })}
        {editable && data.tabs.length < 12 && (
          <button
            type="button"
            data-plan-interactive
            aria-label="Add tab"
            className="flex items-center gap-1.5 rounded-md px-2 py-2 text-sm text-plan-muted hover:bg-plan-block/60 hover:text-plan-text"
            onClick={addTab}
          >
            <IconPlus className="size-4" />
            Add tab
          </button>
        )}
      </div>
      {active && (
        <div className="grid gap-3">
          {editable && (
            <input
              type="text"
              data-plan-interactive
              className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Tab label"
              value={active.label}
              onChange={(event) => renameTab(active.id, event.target.value)}
            />
          )}
          <div>
            {active.blocks.map((child) => (
              <div key={child.id}>
                {ctx.renderBlock?.({
                  block: child,
                  editing: true,
                  compactVisuals: compact,
                  onChange: (next) => updateChild(active.id, next),
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The standard tabs block spec (with React `Read`/`Edit`). Apps register this in
 * their browser registry. The schema + MDX config come from `./tabs.config.ts`,
 * the exact same object server / agent code registers, so rendering and source
 * round-trip never drift.
 */
export const tabsBlock = defineBlock<TabsData>({
  type: "tabs",
  schema: tabsSchema,
  mdx: tabsMdx,
  Read: TabsBlockReader,
  Edit: TabsBlockEditor,
  placement: ["block", "inline"],
  label: "Tabs",
  icon: IconLayoutNavbar,
  description:
    "A horizontal pill-tab container; each tab holds its own list of blocks.",
  empty: () => ({ tabs: [{ id: newTabId(), label: "Tab 1", blocks: [] }] }),
});
