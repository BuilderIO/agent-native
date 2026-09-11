import {
  IconLayoutNavbar,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.js";
import { cn } from "../../utils.js";
import { defineBlock } from "../types.js";
import type {
  BlockContainerRegion,
  BlockReadProps,
  BlockEditProps,
  NestedBlock,
} from "../types.js";
import { NarrowContainerProvider } from "./narrow-container.js";
import {
  tabsSchema,
  tabsMdx,
  type TabsData,
  type TabsOrientation,
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
 * change rendered output. The block chrome uses semantic shadcn tokens so the
 * same renderer stays quiet in both the plan and content apps.
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

const tabSettingsInputClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function tabOrientation(data: Pick<TabsData, "orientation">): TabsOrientation {
  return data.orientation === "vertical" ? "vertical" : "horizontal";
}

function tabsUseWideLayout(data: TabsData): boolean {
  return (
    tabOrientation(data) === "vertical" ||
    data.tabs.some((tab) => nestedBlocksContainDiffLike(tab.blocks))
  );
}

function nestedBlocksContainDiffLike(blocks: NestedBlock[]): boolean {
  return blocks.some(nestedBlockContainsDiffLike);
}

function nestedBlockContainsDiffLike(block: NestedBlock): boolean {
  if (block.type === "diff" || block.type === "annotated-code") return true;

  const data = (block as { data?: unknown }).data;
  if (!data || typeof data !== "object") return false;

  const tabs = (data as { tabs?: unknown }).tabs;
  if (Array.isArray(tabs)) {
    return tabs.some((tab) => {
      const blocks = (tab as { blocks?: unknown }).blocks;
      return Array.isArray(blocks)
        ? nestedBlocksContainDiffLike(blocks as NestedBlock[])
        : false;
    });
  }

  const columns = (data as { columns?: unknown }).columns;
  if (Array.isArray(columns)) {
    return columns.some((column) => {
      const blocks = (column as { blocks?: unknown }).blocks;
      return Array.isArray(blocks)
        ? nestedBlocksContainDiffLike(blocks as NestedBlock[])
        : false;
    });
  }

  return false;
}

function tabsWith(data: TabsData, tabs: TabsTab[]): TabsData {
  return { ...data, tabs };
}

function tabButtonClass(
  selected: boolean,
  orientation: TabsOrientation,
): string {
  return cn(
    "rounded-lg border border-transparent text-sm font-semibold transition-colors",
    orientation === "vertical"
      ? "min-w-0 max-w-72 shrink-0 px-3 py-2 text-left @xl/tabs:w-full @xl/tabs:max-w-none"
      : "shrink-0 whitespace-nowrap px-4 py-2",
    selected
      ? "bg-primary/5 text-foreground dark:bg-primary/10"
      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
  );
}

function tabLabelClass(orientation: TabsOrientation): string | undefined {
  return orientation === "vertical" ? "block min-w-0 truncate" : undefined;
}

/** Shared pill-tab rail. */
function TabRail({
  tabs,
  activeId,
  onSelect,
  orientation,
}: {
  tabs: TabsTab[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
  orientation: TabsOrientation;
}) {
  const vertical = orientation === "vertical";
  return (
    <div
      className={cn(
        vertical
          ? "mb-5 flex w-full min-w-0 max-w-full flex-nowrap gap-1 overflow-x-auto @xl/tabs:mb-0 @xl/tabs:max-h-[62vh] @xl/tabs:flex-col @xl/tabs:overflow-x-hidden @xl/tabs:overflow-y-auto @xl/tabs:pr-2"
          : "mb-8 flex w-full min-w-0 max-w-full flex-nowrap gap-1 overflow-x-auto",
      )}
      role="tablist"
      aria-orientation={orientation}
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
            className={tabButtonClass(selected, orientation)}
          >
            <span className={tabLabelClass(orientation)}>{tab.label}</span>
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
  const orientation = tabOrientation(data);
  const vertical = orientation === "vertical";
  const wideLayout = tabsUseWideLayout(data);
  return (
    <section
      className="plan-block"
      data-block-id={blockId}
      data-tabs-orientation={orientation}
      data-wide-layout-block={wideLayout ? "" : undefined}
    >
      {title && <div className="plan-block-label">{title}</div>}
      <div className={cn("min-w-0 max-w-full", vertical && "@container/tabs")}>
        <div
          className={cn(
            "min-w-0 max-w-full",
            vertical &&
              "grid min-w-0 gap-5 @xl/tabs:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)] @xl/tabs:items-start",
          )}
        >
          <TabRail
            tabs={data.tabs}
            activeId={active?.id}
            onSelect={setActiveId}
            orientation={orientation}
          />
          {active &&
            (vertical ? (
              <NarrowContainerProvider>
                <div className="min-w-0 max-w-full">
                  {active.blocks.map((child) => (
                    <div key={child.id} className="min-w-0 max-w-full">
                      {ctx.renderBlock?.({
                        block: child,
                        editing: false,
                        compactVisuals: compact,
                      })}
                    </div>
                  ))}
                </div>
              </NarrowContainerProvider>
            ) : (
              <div className="min-w-0 max-w-full">
                {active.blocks.map((child) => (
                  <div key={child.id} className="min-w-0 max-w-full">
                    {ctx.renderBlock?.({
                      block: child,
                      editing: false,
                      compactVisuals: compact,
                    })}
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>
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
  const orientation = tabOrientation(data);
  const vertical = orientation === "vertical";
  const wideLayout = tabsUseWideLayout(data);

  const commit = (tabs: TabsTab[]) => onChange(tabsWith(data, tabs));

  const setOrientation = (next: TabsOrientation) =>
    onChange({
      ...data,
      orientation: next === "vertical" ? "vertical" : undefined,
    });

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
    <div
      className={cn("min-w-0", vertical && "@container/tabs")}
      data-tabs-edit-block={blockId}
      data-tabs-orientation={orientation}
      data-wide-layout-block={wideLayout ? "" : undefined}
    >
      <div
        className={cn(
          vertical &&
            "grid min-w-0 gap-5 @xl/tabs:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)] @xl/tabs:items-start",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 items-start gap-2",
            vertical ? "mb-5 @xl/tabs:mb-0" : "mb-8 w-full",
          )}
        >
          <div
            className={cn(
              "flex min-w-0 flex-1 gap-1",
              vertical
                ? "flex-nowrap overflow-x-auto @xl/tabs:max-h-[62vh] @xl/tabs:flex-col @xl/tabs:overflow-x-hidden @xl/tabs:overflow-y-auto @xl/tabs:pr-2"
                : "w-full flex-nowrap items-center overflow-x-auto",
            )}
            role="tablist"
            aria-orientation={orientation}
            data-plan-interactive
          >
            {data.tabs.map((tab) => {
              const selected = tab.id === active?.id;
              const tabLabel = (
                <span className={tabLabelClass(orientation)}>{tab.label}</span>
              );
              if (!vertical) {
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActiveId(tab.id)}
                    className={tabButtonClass(selected, orientation)}
                  >
                    {tabLabel}
                  </button>
                );
              }
              const tabButton = (
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveId(tab.id)}
                  className={cn(
                    tabButtonClass(selected, orientation),
                    vertical && editable && selected && "pr-9",
                  )}
                >
                  {tabLabel}
                </button>
              );
              return (
                <div
                  key={tab.id}
                  className="group/tab relative flex min-w-0 max-w-72 shrink-0 @xl/tabs:w-full @xl/tabs:max-w-none"
                >
                  {tabButton}
                  {editable && selected && (
                    <TabsSettingsPopover
                      active={active}
                      orientation={orientation}
                      tabs={data.tabs}
                      triggerClassName="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 group-focus-within/tab:pointer-events-auto group-focus-within/tab:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100"
                      onRename={renameTab}
                      onOrientationChange={setOrientation}
                      onAdd={addTab}
                      onRemove={removeTab}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {editable && !vertical && (
            <TabsSettingsPopover
              active={active}
              orientation={orientation}
              tabs={data.tabs}
              onRename={renameTab}
              onOrientationChange={setOrientation}
              onAdd={addTab}
              onRemove={removeTab}
            />
          )}
        </div>
        {active && (
          <div className="min-w-0 max-w-full">
            {ctx.renderBlocksEditor
              ? ctx.renderBlocksEditor({
                  blocks: active.blocks,
                  onChange: (nextBlocks) =>
                    onChange(
                      {
                        ...data,
                        tabs: data.tabs.map((tab) =>
                          tab.id === active.id
                            ? { ...tab, blocks: nextBlocks }
                            : tab,
                        ),
                      },
                      {
                        containerRegion: {
                          regionId: active.id,
                          blocks: nextBlocks,
                        },
                      },
                    ),
                  editable,
                  containerBlockId: blockId,
                  regionId: active.id,
                  regionLabel: active.label,
                  compactVisuals: compact,
                })
              : active.blocks.map((child) => (
                  <div key={child.id} className="min-w-0 max-w-full">
                    {ctx.renderBlock?.({
                      block: child,
                      editing: true,
                      compactVisuals: compact,
                      onChange: (next) => updateChild(active.id, next),
                    })}
                  </div>
                ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TabsSettingsPopover({
  active,
  orientation,
  tabs,
  onRename,
  onOrientationChange,
  onAdd,
  onRemove,
  triggerClassName,
}: {
  active: TabsTab | undefined;
  orientation: TabsOrientation;
  tabs: TabsTab[];
  onRename: (id: string, label: string) => void;
  onOrientationChange: (orientation: TabsOrientation) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  triggerClassName?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-plan-interactive
          aria-label="Edit tabs"
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md text-plan-muted transition-colors hover:text-plan-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            triggerClassName,
          )}
        >
          <IconPencil className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        className="w-80 p-0"
        data-plan-interactive
      >
        <div className="border-b border-border px-3 py-2">
          <div className="text-sm font-semibold text-foreground">
            Tab settings
          </div>
          <div className="text-xs text-muted-foreground">
            Rename the active tab, change layout, or manage the tab set.
          </div>
        </div>
        <div className="grid gap-3 p-3">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Active tab label
            </span>
            <input
              type="text"
              data-plan-interactive
              className={tabSettingsInputClass}
              value={active?.label ?? ""}
              disabled={!active}
              onChange={(event) => {
                if (!active) return;
                onRename(active.id, event.target.value);
              }}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Layout
            </span>
            <div
              className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted/30 p-1"
              role="radiogroup"
              aria-label="Tabs layout"
            >
              {(
                [
                  ["horizontal", "Top"],
                  ["vertical", "Side"],
                ] satisfies Array<[TabsOrientation, string]>
              ).map(([value, label]) => {
                const selected = orientation === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-plan-interactive
                    onClick={() => onOrientationChange(value)}
                    className={cn(
                      "h-8 rounded px-2 text-xs font-medium transition-colors",
                      selected
                        ? "bg-background text-foreground"
                        : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-plan-interactive
              disabled={tabs.length >= 12}
              onClick={onAdd}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconPlus className="size-3.5" />
              Add tab
            </button>
            <button
              type="button"
              data-plan-interactive
              disabled={!active || tabs.length <= 1}
              onClick={() => {
                if (!active) return;
                onRemove(active.id);
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconTrash className="size-3.5" />
              Remove current
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function tabRegions(data: TabsData): BlockContainerRegion[] {
  return data.tabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    blocks: tab.blocks,
  }));
}

function addTabRegion(data: TabsData, afterRegionId?: string): TabsData {
  if (data.tabs.length >= 12) return data;
  const nextTab: TabsTab = {
    id: newTabId(),
    label: `Tab ${data.tabs.length + 1}`,
    blocks: [],
  };
  if (!afterRegionId) return tabsWith(data, [...data.tabs, nextTab]);
  const afterIndex = data.tabs.findIndex((tab) => tab.id === afterRegionId);
  if (afterIndex < 0) return tabsWith(data, [...data.tabs, nextTab]);
  return tabsWith(data, [
    ...data.tabs.slice(0, afterIndex + 1),
    nextTab,
    ...data.tabs.slice(afterIndex + 1),
  ]);
}

function removeTabRegion(data: TabsData, regionId: string): TabsData {
  if (data.tabs.length <= 1) return data;
  return tabsWith(
    data,
    data.tabs.filter((tab) => tab.id !== regionId),
  );
}

function reorderTabRegion(
  data: TabsData,
  fromRegionId: string,
  toRegionId: string,
): TabsData {
  const fromIndex = data.tabs.findIndex((tab) => tab.id === fromRegionId);
  const toIndex = data.tabs.findIndex((tab) => tab.id === toRegionId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return data;
  const next = [...data.tabs];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return data;
  next.splice(toIndex, 0, moved);
  return tabsWith(data, next);
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
  editSurface: "container",
  container: {
    regions: tabRegions,
    updateRegion: (data, regionId, blocks) =>
      tabsWith(
        data,
        data.tabs.map((tab) =>
          tab.id === regionId ? { ...tab, blocks } : tab,
        ),
      ),
    addRegion: addTabRegion,
    removeRegion: removeTabRegion,
    reorderRegion: reorderTabRegion,
  },
  label: "Tabs",
  icon: IconLayoutNavbar,
  description:
    "A top or side tab container; each tab holds its own list of blocks.",
  empty: () => ({ tabs: [{ id: newTabId(), label: "Tab 1", blocks: [] }] }),
});
