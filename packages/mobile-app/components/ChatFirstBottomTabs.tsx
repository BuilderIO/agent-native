import type { AppConfig } from "@agent-native/shared-app-config";
import {
  IconMessageCircle,
  IconPlus,
  IconSettings,
} from "@tabler/icons-react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { ProgressiveBlur, useTabBarMinimized } from "expo-glass-tabs";
import type { BottomTabBarProps } from "expo-router/build/react-navigation/bottom-tabs";
import { useEffect, useState, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { AppIcon } from "@/components/AppCard";
import { AppLauncherMenu } from "@/components/AppLauncherMenu";
import { getAppRoute } from "@/lib/mobile-app-navigation";
import { useMobileThemeColors } from "@/lib/mobile-colors";
import { useMobileTabLayout } from "@/lib/mobile-tab-layout";
import {
  TAB_BAR_ACTION_GAP,
  TAB_BAR_ACTION_SIZE,
  TAB_BAR_BLUR_BLEED,
  TAB_BAR_MARGIN,
  TAB_BAR_MINIMIZED_HEIGHT,
  TAB_BAR_PILL_HEIGHT,
  TAB_BAR_PILL_RADIUS,
  TAB_BAR_ROW_PAD,
  useTabBarLayout,
} from "@/lib/tab-bar-layout";
import { useApps } from "@/lib/use-apps";

/**
 * Interruptible on purpose: hopping between tabs retargets the travel with
 * velocity preserved rather than restarting it from a standstill.
 */
const SLIDE_SPRING = { duration: 420, dampingRatio: 0.82 };

const HIGHLIGHT_RADIUS = 16;
/** Label height plus its gap, folded together so it can collapse to nothing. */
const LABEL_BLOCK = 16;
/** Breathing room per side, so the chip never abuts its neighbour or the wall. */
const HIGHLIGHT_INSET = 4;

const PILL_SURFACE = {
  borderCurve: "continuous",
  borderRadius: TAB_BAR_PILL_RADIUS,
} as const;

const ACTION_SURFACE = {
  borderCurve: "continuous",
  borderRadius: TAB_BAR_ACTION_SIZE / 2,
} as const;

type TabItem = {
  key: string;
  label: string;
  routeName: string;
  app?: AppConfig;
};

function routeNameForApp(appId: string): string {
  return getAppRoute(appId).replace(/^\//, "");
}

function TabButton({
  item,
  active,
  onPress,
}: {
  item: TabItem;
  active: boolean;
  onPress: () => void;
}) {
  const { foreground, mutedForeground } = useMobileThemeColors();
  const minimized = useTabBarMinimized();
  const tint = active ? foreground : mutedForeground;

  // The label collapses to zero height rather than being clipped, so the glyph
  // stays optically centred at every point of the minimize animation. Clipping
  // a fixed-height box left the icon sitting low once the labels went away.
  const labelStyle = useAnimatedStyle(() => ({
    height: interpolate(
      minimized.value,
      [0, 1],
      [LABEL_BLOCK, 0],
      Extrapolation.CLAMP,
    ),
    opacity: interpolate(
      minimized.value,
      [0, 0.4],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <Pressable
      accessibilityLabel={item.label}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      className="min-w-0 flex-1 items-center justify-center active:opacity-70"
      onPress={onPress}
      style={{ flexBasis: 0 }}
    >
      <View className="items-center justify-center">
        {item.app ? (
          <AppIcon color={tint} iconName={item.app.icon} size={21} />
        ) : item.key === "settings" ? (
          <IconSettings
            color={tint}
            size={22}
            strokeWidth={active ? 2.3 : 1.9}
          />
        ) : (
          <IconMessageCircle
            color={tint}
            size={22}
            strokeWidth={active ? 2.3 : 1.9}
          />
        )}
        <Animated.View className="overflow-hidden" style={labelStyle}>
          <Text
            numberOfLines={1}
            style={{
              color: tint,
              fontSize: 11,
              fontWeight: active ? "700" : "500",
              marginTop: 2,
            }}
          >
            {item.label}
          </Text>
        </Animated.View>
      </View>
    </Pressable>
  );
}

function navigateToTab({
  item,
  state,
  navigation,
}: {
  item: TabItem;
  state: BottomTabBarProps["state"];
  navigation: BottomTabBarProps["navigation"];
}) {
  const route = state.routes.find(
    (candidate) => candidate.name === item.routeName,
  );
  if (!route) return;
  const event = navigation.emit({
    type: "tabPress",
    target: route.key,
    canPreventDefault: true,
  });
  if (state.index !== state.routes.indexOf(route) && !event.defaultPrevented) {
    navigation.navigate(route.name);
  }
}

export default function ChatFirstBottomTabs({
  state,
  navigation,
}: BottomTabBarProps) {
  const { border, card, foreground, secondary, theme } = useMobileThemeColors();
  const { bottom, contentInset } = useTabBarLayout();
  const { enabledApps } = useApps();
  const { selectedAppIds } = useMobileTabLayout(enabledApps);
  const { width: windowWidth } = useWindowDimensions();
  const minimized = useTabBarMinimized();
  const [launcherOpen, setLauncherOpen] = useState(false);

  // The apps you pinned ride between Chat and Settings; everything else is
  // one tap away behind the action button.
  const items: TabItem[] = [
    { key: "chat", label: "Chat", routeName: "chat" },
    ...selectedAppIds
      .map((id) => enabledApps.find((app) => app.id === id))
      .filter((app): app is AppConfig => Boolean(app))
      .map((app) => ({
        key: app.id,
        label: app.name,
        routeName: routeNameForApp(app.id),
        app,
      })),
    { key: "settings", label: "Settings", routeName: "settings" },
  ];

  const currentRouteName = state.routes[state.index]?.name;
  const activeIndex = Math.max(
    items.findIndex((item) => item.routeName === currentRouteName),
    0,
  );
  // Routes opened from the launcher own no slot, so the highlight fades out
  // rather than parking on a tab the user is not actually on.
  const hasActiveTab = items.some(
    (item) => item.routeName === currentRouteName,
  );

  const slotCount = items.length;

  /**
   * Travel between tabs and the minimize shrink are separate motions. Spring
   * the slot *index* and multiply by the live slot width, rather than springing
   * the final offset — a spring whose target moves every frame of the shrink
   * visibly trails the icons it is meant to sit under.
   */
  const slideIndex = useSharedValue(activeIndex);
  const highlightOpacity = useSharedValue(hasActiveTab ? 1 : 0);

  useEffect(() => {
    slideIndex.value = withSpring(activeIndex, SLIDE_SPRING);
  }, [activeIndex, slideIndex]);

  useEffect(() => {
    highlightOpacity.value = withSpring(hasActiveTab ? 1 : 0, SLIDE_SPRING);
  }, [hasActiveTab, highlightOpacity]);

  /**
   * The capsule is `flex: 1` beside an action button that shrinks as the bar
   * minimizes, so the capsule silently widens by the same amount. Deriving the
   * slot from a constant button size drifts a few points per slot — worst at
   * the last one — and the highlight stops sitting under its icon. Recompute
   * per frame from the same interpolation the button uses.
   */
  const slotWidthAt = (progress: number) => {
    "worklet";
    const actionSize = interpolate(
      progress,
      [0, 1],
      [TAB_BAR_ACTION_SIZE, TAB_BAR_MINIMIZED_HEIGHT],
      Extrapolation.CLAMP,
    );
    const pillWidth =
      windowWidth - TAB_BAR_MARGIN * 2 - actionSize - TAB_BAR_ACTION_GAP;
    return (pillWidth - TAB_BAR_ROW_PAD * 2) / slotCount;
  };

  const pillHeight = (progress: number) => {
    "worklet";
    return interpolate(
      progress,
      [0, 1],
      [TAB_BAR_PILL_HEIGHT, TAB_BAR_MINIMIZED_HEIGHT],
      Extrapolation.CLAMP,
    );
  };

  const pillStyle = useAnimatedStyle(() => ({
    height: pillHeight(minimized.value),
  }));

  const shapeStyle = useAnimatedStyle(() => ({
    borderRadius: pillHeight(minimized.value) / 2,
  }));

  // Transform-only, so the travel is GPU-composited with no per-frame layout.
  const highlightStyle = useAnimatedStyle(() => {
    const height = interpolate(
      minimized.value,
      [0, 1],
      [TAB_BAR_PILL_HEIGHT - 10, TAB_BAR_MINIMIZED_HEIGHT - 10],
      Extrapolation.CLAMP,
    );
    const slotWidth = slotWidthAt(minimized.value);
    return {
      height,
      width: slotWidth - HIGHLIGHT_INSET * 2,
      top: (pillHeight(minimized.value) - height) / 2,
      opacity: highlightOpacity.value,
      transform: [
        {
          translateX:
            TAB_BAR_ROW_PAD + HIGHLIGHT_INSET + slotWidth * slideIndex.value,
        },
      ],
    };
  });

  const actionStyle = useAnimatedStyle(() => {
    const size = interpolate(
      minimized.value,
      [0, 1],
      [TAB_BAR_ACTION_SIZE, TAB_BAR_MINIMIZED_HEIGHT],
      Extrapolation.CLAMP,
    );
    return { height: size, width: size, borderRadius: size / 2 };
  });

  const surface = (shape: object): ReactNode =>
    isLiquidGlassAvailable() ? (
      <GlassView
        colorScheme={theme === "dark" ? "dark" : "light"}
        glassEffectStyle="regular"
        style={[StyleSheet.absoluteFill, shape]}
      />
    ) : (
      <View
        style={[
          StyleSheet.absoluteFill,
          shape,
          {
            backgroundColor: card,
            borderColor: border,
            borderWidth: StyleSheet.hairlineWidth,
          },
        ]}
      />
    );

  return (
    <View
      accessibilityLabel="Primary navigation"
      pointerEvents="box-none"
      style={{ bottom: 0, left: 0, position: "absolute", right: 0 }}
    >
      {/* Dissolves scrolling content into the bar instead of ending it at a
          hard edge. */}
      <ProgressiveBlur
        direction="bottom"
        style={{
          bottom: 0,
          height: contentInset + TAB_BAR_BLUR_BLEED,
          left: 0,
          position: "absolute",
          right: 0,
        }}
      />

      <View
        className="flex-row items-center"
        pointerEvents="box-none"
        style={{
          gap: TAB_BAR_ACTION_GAP,
          marginBottom: bottom,
          marginHorizontal: TAB_BAR_MARGIN,
        }}
      >
        <Animated.View style={[{ flex: 1 }, pillStyle]}>
          {/* The capsule comes from the glass view's own corner configuration —
              an RN clip would drop the squircle and its rim lighting. */}
          <Animated.View style={[StyleSheet.absoluteFill, shapeStyle]}>
            {surface(PILL_SURFACE)}
          </Animated.View>

          <Animated.View
            style={[
              {
                backgroundColor: secondary,
                borderCurve: "continuous",
                borderRadius: HIGHLIGHT_RADIUS,
                left: 0,
                position: "absolute",
              },
              highlightStyle,
            ]}
          />

          <View
            className="flex-1 flex-row items-center"
            style={{ paddingHorizontal: TAB_BAR_ROW_PAD }}
          >
            {items.map((item) => (
              <TabButton
                active={hasActiveTab && item.routeName === currentRouteName}
                item={item}
                key={item.key}
                onPress={() => navigateToTab({ item, navigation, state })}
              />
            ))}
          </View>
        </Animated.View>

        <Animated.View style={actionStyle}>
          <Pressable
            accessibilityLabel="All apps"
            accessibilityRole="button"
            className="h-full w-full items-center justify-center active:opacity-75"
            onPress={() => setLauncherOpen(true)}
          >
            {surface(ACTION_SURFACE)}
            <IconPlus color={foreground} size={24} strokeWidth={2.2} />
          </Pressable>
        </Animated.View>
      </View>

      <AppLauncherMenu
        bottomOffset={bottom + TAB_BAR_PILL_HEIGHT + TAB_BAR_ACTION_GAP}
        onClose={() => setLauncherOpen(false)}
        visible={launcherOpen}
      />
    </View>
  );
}
