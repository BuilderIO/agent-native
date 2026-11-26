import {
  segmentedControlProps,
  type SegmentedControlOwnProps,
  type TabsListOwnProps,
  tabsListProps,
} from "@agent-native/design-system";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import * as React from "react";

import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

const ShowIndicator = React.createContext(true);

export interface TabsProps extends BaseTabs.Root.Props {
  /** Join a horizontal tab strip to its content surface. */
  variant?: "underline" | "framed";
}

/**
 * Panels of content on one page, switched by a row of tabs over an underline,
 * on Base UI's Tabs with Radix Themes' look. To choose a value rather than
 * switch panels, use SegmentedControl.
 *
 * @import import { Tabs, TabsList, TabsTab, TabsPanel } from "@agent-native/toolkit/ui/base-ui/tabs";
 */
const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ className, variant = "underline", ...props }, ref) => (
    <ShowIndicator.Provider
      value={variant !== "framed" || props.orientation === "vertical"}
    >
      <BaseTabs.Root
        ref={ref}
        data-variant={variant}
        className={partClassName("tabs", className)}
        {...props}
      />
    </ShowIndicator.Provider>
  ),
);
Tabs.displayName = "Tabs";

export interface TabsListProps
  extends Omit<BaseTabs.List.Props, "color">, TabsListOwnProps {}

/**
 * The row of tabs, with the indicator that marks the active one in the accent.
 *
 * @import import { TabsList } from "@agent-native/toolkit/ui/base-ui/tabs";
 */
const TabsList = React.forwardRef<HTMLDivElement, TabsListProps>(
  (props, ref) => {
    const showIndicator = React.useContext(ShowIndicator);
    const [attributes, { className, children, ...rest }] = splitProps(
      tabsListProps,
      props,
    );
    return (
      <BaseTabs.List
        ref={ref}
        {...rest}
        {...attributes}
        className={partClassName("tabs-list", className)}
      >
        {children}
        {showIndicator && <BaseTabs.Indicator className="tabs-indicator" />}
      </BaseTabs.List>
    );
  },
);
TabsList.displayName = "TabsList";

export type TabsTabProps = BaseTabs.Tab.Props;

/**
 * One tab in the list, which shows its panel when chosen.
 *
 * @import import { TabsTab } from "@agent-native/toolkit/ui/base-ui/tabs";
 */
const TabsTab = React.forwardRef<HTMLButtonElement, TabsTabProps>(
  ({ className, ...props }, ref) => (
    <BaseTabs.Tab
      ref={ref}
      className={partClassName("tabs-tab", className)}
      {...props}
    />
  ),
);
TabsTab.displayName = "TabsTab";

export type TabsPanelProps = BaseTabs.Panel.Props;

/**
 * The content shown while its tab is active.
 *
 * @import import { TabsPanel } from "@agent-native/toolkit/ui/base-ui/tabs";
 */
const TabsPanel = React.forwardRef<HTMLDivElement, TabsPanelProps>(
  ({ className, ...props }, ref) => (
    <BaseTabs.Panel
      ref={ref}
      className={partClassName("tabs-panel", className)}
      {...props}
    />
  ),
);
TabsPanel.displayName = "TabsPanel";

export { Tabs, TabsList, TabsTab, TabsPanel };

export interface SegmentedTabsListProps
  extends Omit<BaseTabs.List.Props, "color">, SegmentedControlOwnProps {}

/** Base UI panel navigation with the shared segmented track, size and radius.
 * @import import { Tabs, SegmentedTabsList, SegmentedTabsTab, TabsPanel } from "@agent-native/toolkit/ui/base-ui/tabs";
 */
export const SegmentedTabsList = React.forwardRef<
  HTMLDivElement,
  SegmentedTabsListProps
>((props, ref) => {
  const [attributes, { className, ...rest }] = splitProps(
    segmentedControlProps,
    props,
  );
  return (
    <BaseTabs.List
      ref={ref}
      {...rest}
      {...attributes}
      className={partClassName("segmented-control", className)}
    />
  );
});
SegmentedTabsList.displayName = "SegmentedTabsList";

export const SegmentedTabsTab = React.forwardRef<
  HTMLButtonElement,
  TabsTabProps
>(({ className, ...props }, ref) => (
  <BaseTabs.Tab
    ref={ref}
    {...props}
    className={partClassName("segmented-control-item", className)}
  />
));
SegmentedTabsTab.displayName = "SegmentedTabsTab";
