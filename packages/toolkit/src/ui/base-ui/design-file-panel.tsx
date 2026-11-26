import { IconChevronDown, IconFile } from "@tabler/icons-react";
import * as React from "react";

import {
  LayerTree,
  type LayerRecord,
  type LayerTreeProps,
} from "./layer-tree.js";
import {
  Tabs,
  SegmentedTabsList,
  type SegmentedTabsListProps,
  TabsList,
  TabsTab,
  TabsPanel,
  SegmentedTabsTab,
} from "./tabs.js";
import { Text } from "./text.js";

export type DesignFileTab = {
  value: string;
  label: React.ReactNode;
  panel: React.ReactNode;
};
export interface DesignFilePanelProps extends Omit<
  React.ComponentPropsWithRef<"aside">,
  "title" | "children"
> {
  title: React.ReactNode;
  brand?: React.ReactNode;
  headerActions?: React.ReactNode;
  tabsLabel: string;
  tabVariant?: "segmented" | "framed";
  tabListProps?: Pick<SegmentedTabsListProps, "variant" | "size" | "radius">;
  tabs: readonly DesignFileTab[];
  tab: string;
  onTabChange: (value: string) => void;
  footer?: React.ReactNode;
}

/** A controlled file sidebar. Each tab's panel, actions and footer belong to its consumer.
 * @import import { DesignFilePanel } from "@agent-native/toolkit/ui/base-ui/design-file-panel";
 */
export function DesignFilePanel({
  title,
  brand,
  headerActions,
  tabsLabel,
  tabVariant = "segmented",
  tabListProps,
  tabs,
  tab,
  onTabChange,
  footer,
  className,
  ...props
}: DesignFilePanelProps) {
  const framed = tabVariant === "framed";
  const Tab = framed ? TabsTab : SegmentedTabsTab;
  const triggers = tabs.map((item) => (
    <Tab key={item.value} value={item.value}>
      {item.label}
    </Tab>
  ));
  return (
    <aside
      {...props}
      className={["design-file-panel", className].filter(Boolean).join(" ")}
    >
      <header className="design-file-panel-header">
        {brand && <span className="design-file-panel-brand">{brand}</span>}
        <Text render={<strong />} textStyle="label-large">
          {title}
        </Text>
        {headerActions}
      </header>
      <Tabs
        variant={framed ? "framed" : "underline"}
        value={tab}
        onValueChange={(value) => {
          if (typeof value === "string") onTabChange(value);
        }}
      >
        {framed ? (
          <TabsList aria-label={tabsLabel}>{triggers}</TabsList>
        ) : (
          <SegmentedTabsList
            {...tabListProps}
            aria-label={tabsLabel}
            className="design-file-panel-tabs"
          >
            {triggers}
          </SegmentedTabsList>
        )}
        {tabs.map((item) => (
          <TabsPanel key={item.value} value={item.value}>
            {item.panel}
          </TabsPanel>
        ))}
      </Tabs>
      {footer && <footer className="design-file-panel-footer">{footer}</footer>}
    </aside>
  );
}

export interface DesignFileSectionProps {
  label: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
  fill?: boolean;
}
export function DesignFileSection({
  label,
  expanded,
  onExpandedChange,
  children,
  actions,
  fill,
}: DesignFileSectionProps) {
  const id = React.useId();
  return (
    <section
      className="design-file-panel-section"
      data-fill={(fill && expanded) || undefined}
    >
      <div className="design-file-panel-section-header">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => onExpandedChange(!expanded)}
        >
          <IconChevronDown className="disclosure-chevron" aria-hidden />
          {label}
        </button>
        {actions}
      </div>
      <div
        id={id}
        hidden={!expanded}
        className="design-file-panel-section-content"
      >
        {children}
      </div>
    </section>
  );
}

export interface DesignFilePageListProps {
  /** How assistive technology announces the current entry. Defaults to the current page. */
  current?: React.AriaAttributes["aria-current"];
  label: string;
  pages: readonly {
    id: string;
    label: React.ReactNode;
    icon?: React.ReactNode;
  }[];
  value: string;
  onValueChange: (id: string) => void;
}
export function DesignFilePageList({
  current = "page",
  label,
  pages,
  value,
  onValueChange,
}: DesignFilePageListProps) {
  return (
    <nav aria-label={label} className="design-file-panel-pages">
      {pages.map((page) => (
        <button
          type="button"
          key={page.id}
          className="design-file-panel-page"
          aria-current={value === page.id ? current : undefined}
          onClick={() => onValueChange(page.id)}
        >
          <span className="design-file-panel-page-icon" aria-hidden>
            {page.icon ?? <IconFile />}
          </span>
          <span
            className="design-file-panel-page-label"
            title={typeof page.label === "string" ? page.label : undefined}
          >
            {page.label}
          </span>
        </button>
      ))}
    </nav>
  );
}

/** Supplies the available block size to a windowed tree when its panel or sections resize. */
export function DesignFileTreeViewport({
  children,
}: {
  children: (height: number) => React.ReactNode;
}) {
  const host = React.useRef<HTMLDivElement>(null);
  const [height, setHeight] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    let last = node.clientHeight;
    if (last > 0) setHeight(last);
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(0);
      if (!entry) return;
      const next = entry.contentRect.height;
      if (next !== last) {
        last = next;
        setHeight(next);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={host} className="design-file-panel-tree" inert={height === 0}>
      {height !== null && children(height)}
    </div>
  );
}

type SectionControls = Omit<DesignFileSectionProps, "fill" | "children">;
export interface DesignFileContentsProps<T extends LayerRecord> {
  pages: SectionControls & Omit<DesignFilePageListProps, "label">;
  layers: SectionControls;
  tree: Omit<LayerTreeProps<T>, "viewportHeight">;
  treeKey?: React.Key;
  layerTools?: React.ReactNode;
  searchResults?: React.ReactNode;
}

/** The File tab's page navigation and measured, editable tree. Applications supply data and actions.
 * @import import { DesignFileContents } from "@agent-native/toolkit/ui/base-ui/design-file-panel";
 */
export function DesignFileContents<T extends LayerRecord>({
  pages,
  layers,
  tree,
  treeKey,
  layerTools,
  searchResults,
}: DesignFileContentsProps<T>) {
  const { expanded, onExpandedChange, actions, ...pageList } = pages;
  return (
    <>
      <DesignFileSection
        label={pageList.label}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        actions={actions}
      >
        <DesignFilePageList {...pageList} />
      </DesignFileSection>
      <DesignFileSection {...layers} fill>
        {layerTools && (
          <div className="design-file-panel-tools">{layerTools}</div>
        )}
        {searchResults ?? (
          <DesignFileTreeViewport>
            {(height) => (
              <LayerTree
                key={treeKey}
                aria-label={layers.label}
                {...tree}
                viewportHeight={height}
              />
            )}
          </DesignFileTreeViewport>
        )}
      </DesignFileSection>
    </>
  );
}
