import type { AppConfig } from "@agent-native/shared-app-config";
import { IconLayoutGrid } from "@tabler/icons-react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import {
  appAccentBackgroundColor,
  appAccentColor,
  AppIcon,
} from "@/components/AppCard";
import { getAppRoute } from "@/lib/mobile-app-navigation";
import { useMobileThemeColors } from "@/lib/mobile-colors";
import { useApps } from "@/lib/use-apps";

const PANEL_RADIUS = 28;
const ICON_SIZE = 44;

/**
 * Every workspace app, as a wrapping grid above the tab bar's action button.
 * The bar carries only the apps you pinned, so this is the complete list, and
 * it wraps rather than scrolling sideways: apps hidden off-screen behind a
 * swipe are apps nobody finds.
 */
export function AppLauncherMenu({
  visible,
  onClose,
  bottomOffset,
}: {
  visible: boolean;
  onClose: () => void;
  /** Clears the tab bar so the grid sits directly above it. */
  bottomOffset: number;
}) {
  const router = useRouter();
  const { border, card, foreground, mutedForeground, theme } =
    useMobileThemeColors();
  const { enabledApps } = useApps();

  const go = (href: string) => {
    onClose();
    router.push(href as never);
  };

  const tile = (
    key: string,
    label: string,
    accent: string,
    glyph: ReactNode,
    onPress: () => void,
  ) => (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className="w-1/4 items-center px-1 py-2.5 active:opacity-70"
      key={key}
      onPress={onPress}
    >
      <View
        className="items-center justify-center rounded-full"
        style={{
          backgroundColor: appAccentBackgroundColor(accent),
          height: ICON_SIZE,
          width: ICON_SIZE,
        }}
      >
        {glyph}
      </View>
      <Text
        className="mt-1.5 text-[11px] font-medium"
        numberOfLines={1}
        style={{ color: mutedForeground }}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <Pressable
        accessibilityLabel="Dismiss apps"
        className="flex-1 justify-end bg-black/50"
        onPress={onClose}
      >
        <View
          className="px-3"
          pointerEvents="box-none"
          style={{ marginBottom: bottomOffset }}
        >
          <Pressable className="w-full">
            {/* Opaque unless the platform can actually blur what is behind it.
                A translucent tint alone leaves the composer legible straight
                through the panel, which is worse than no glass at all. */}
            {isLiquidGlassAvailable() ? (
              <GlassView
                colorScheme={theme === "dark" ? "dark" : "light"}
                glassEffectStyle="regular"
                style={[
                  StyleSheet.absoluteFill,
                  { borderCurve: "continuous", borderRadius: PANEL_RADIUS },
                ]}
              />
            ) : (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: card,
                    borderColor: border,
                    borderCurve: "continuous",
                    borderRadius: PANEL_RADIUS,
                    borderWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              />
            )}
            <View className="flex-row flex-wrap px-2 py-2">
              {enabledApps.map((app: AppConfig) => {
                const accent = appAccentColor(app);
                return tile(
                  app.id,
                  app.name,
                  accent,
                  <AppIcon color={accent} iconName={app.icon} size={20} />,
                  () => go(getAppRoute(app.id)),
                );
              })}
              {/* The bar has no More tab, so this is the only way back to
                  reordering which apps are pinned to it. */}
              {tile(
                "manage",
                "Manage",
                "#71717a",
                <IconLayoutGrid
                  color={foreground}
                  size={20}
                  strokeWidth={1.9}
                />,
                () => go("/more"),
              )}
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
