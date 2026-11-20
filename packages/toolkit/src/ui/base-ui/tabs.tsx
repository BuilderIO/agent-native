import {
  type TabsListOwnProps,
  tabsListProps,
} from "@agent-native/design-system";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import * as React from "react";

import { labelText } from "./label-text.js";
import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export type TabsProps = BaseTabs.Root.Props;

/**
 * Panels of content on one page, switched by a row of tabs over an underline,
 * on Base UI's Tabs with Radix Themes' look. To choose a value rather than
 * switch panels, use SegmentedControl.
 *
 * @import import { Tabs, TabsList, TabsTab, TabsPanel } from "@agent-native/toolkit/ui/base-ui/tabs";
 */
const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ className, ...props }, ref) => (
    <BaseTabs.Root
      ref={ref}
      className={partClassName("tabs", className)}
      {...props}
    />
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
        <BaseTabs.Indicator className="tabs-indicator" />
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
  ({ className, children, ...props }, ref) => (
    <BaseTabs.Tab
      ref={ref}
      className={partClassName("tabs-tab", className)}
      {...props}
    >
      {labelText(children)}
    </BaseTabs.Tab>
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
