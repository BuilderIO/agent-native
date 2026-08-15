import {
  IconHome,
  IconMessageCircle,
  IconPlus,
  IconSparkles,
  IconTerminal2,
} from "@tabler/icons-react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import {
  GlassTabBar,
  GlassTabButton,
  renderFadingTabScreen,
  TabBarMinimizeProvider,
  type GlassTabItem,
} from "expo-glass-tabs";
import { useRouter } from "expo-router";
import { TabList, TabSlot, Tabs, TabTrigger } from "expo-router/ui";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import QuickActionsSheet from "@/components/QuickActionsSheet";
import {
  TAB_BAR_ACTION_SIZE,
  TAB_BAR_THEME,
  useTabBarLayout,
} from "@/lib/tab-bar-layout";

const TABS: (GlassTabItem & { href: string })[] = [
  {
    name: "index",
    href: "/",
    label: "Home",
    renderIcon: ({ tint, size }) => (
      <IconHome color={tint} size={size} strokeWidth={1.9} />
    ),
  },
  {
    name: "clips",
    href: "/clips",
    label: "Clips",
    renderIcon: ({ tint, size }) => (
      <IconSparkles color={tint} size={size} strokeWidth={1.9} />
    ),
  },
  {
    name: "chat",
    href: "/chat",
    label: "Chat",
    renderIcon: ({ tint, size }) => (
      <IconMessageCircle color={tint} size={size} strokeWidth={1.9} />
    ),
  },
  {
    name: "sessions",
    href: "/sessions",
    label: "Sessions",
    renderIcon: ({ tint, size }) => (
      <IconTerminal2 color={tint} size={size} strokeWidth={1.9} />
    ),
  },
];

export default function TabLayout() {
  const router = useRouter();
  const { contentInset } = useTabBarLayout();
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);

  return (
    <TabBarMinimizeProvider>
      <Tabs>
        <TabSlot renderFn={renderFadingTabScreen} style={{ height: "100%" }} />
        <TabList asChild>
          <GlassTabBar
            onIndexSelected={(index) =>
              router.navigate(TABS[index].href as never)
            }
            theme={TAB_BAR_THEME}
          >
            {TABS.map(({ href, ...item }, index) => (
              <TabTrigger
                asChild
                href={href as never}
                key={item.name}
                name={item.name}
              >
                <GlassTabButton index={index} item={item} />
              </TabTrigger>
            ))}
          </GlassTabBar>
        </TabList>
        <View
          className="absolute right-3"
          pointerEvents="box-none"
          style={{ bottom: contentInset }}
        >
          <Pressable
            accessibilityLabel="Quick actions"
            accessibilityRole="button"
            className="items-center justify-center overflow-hidden active:opacity-75"
            onPress={() => setQuickActionsOpen(true)}
            style={{
              borderRadius: TAB_BAR_ACTION_SIZE / 2,
              height: TAB_BAR_ACTION_SIZE,
              width: TAB_BAR_ACTION_SIZE,
            }}
          >
            {isLiquidGlassAvailable() ? (
              <GlassView
                glassEffectStyle="regular"
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: TAB_BAR_THEME.glassTint,
                    borderCurve: "continuous",
                    borderRadius: TAB_BAR_ACTION_SIZE / 2,
                  },
                ]}
              />
            ) : (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: TAB_BAR_THEME.solidFallback,
                    borderCurve: "continuous",
                    borderRadius: TAB_BAR_ACTION_SIZE / 2,
                  },
                ]}
              />
            )}
            <IconPlus color="#c7f36b" size={24} strokeWidth={2.2} />
          </Pressable>
        </View>
      </Tabs>
      <QuickActionsSheet
        bottom={contentInset}
        onClose={() => setQuickActionsOpen(false)}
        visible={quickActionsOpen}
      />
    </TabBarMinimizeProvider>
  );
}
