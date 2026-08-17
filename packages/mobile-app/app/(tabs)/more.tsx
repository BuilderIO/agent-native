import type { AppConfig } from "@agent-native/shared-app-config";
import {
  IconArrowsMoveVertical,
  IconChevronRight,
  IconGripVertical,
  IconSettings,
} from "@tabler/icons-react-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import AppCard, {
  appAccentBackgroundColor,
  appAccentColor,
  AppIcon,
} from "@/components/AppCard";
import { SafeAreaView } from "@/components/uniwind-interop";
import * as AppStore from "@/lib/app-store";
import { getAppRoute } from "@/lib/mobile-app-navigation";
import { useMobileThemeColors } from "@/lib/mobile-colors";
import { useApps } from "@/lib/use-apps";
import { useWorkspaceApps } from "@/lib/workspace-apps";

const REORDER_ROW_STEP = 80;

function mergeAppLists(
  localApps: readonly AppConfig[],
  workspaceApps: readonly AppConfig[],
): AppConfig[] {
  const localIds = new Set(localApps.map((app) => app.id));
  return [
    ...localApps,
    ...workspaceApps.filter((app) => !localIds.has(app.id)),
  ];
}

function reconcileAppOrder(
  savedIds: readonly string[],
  apps: readonly AppConfig[],
): string[] {
  const availableIds = new Set(apps.map((app) => app.id));
  const saved = savedIds.filter((id) => availableIds.has(id));
  const savedSet = new Set(saved);
  return [
    ...saved,
    ...apps.map((app) => app.id).filter((id) => !savedSet.has(id)),
  ];
}

function orderedAppsForIds(
  apps: readonly AppConfig[],
  savedIds: readonly string[],
): AppConfig[] {
  const appsById = new Map(apps.map((app) => [app.id, app]));
  return reconcileAppOrder(savedIds, apps)
    .map((id) => appsById.get(id))
    .filter((app): app is AppConfig => Boolean(app));
}

function ReorderableAppRow({
  app,
  index,
  total,
  source,
  onReorder,
}: {
  app: AppConfig;
  index: number;
  total: number;
  source: "Local" | "Workspace";
  onReorder: (fromIndex: number, toIndex: number) => void;
}) {
  const colors = useMobileThemeColors();
  const accentColor = appAccentColor(app);
  const translateY = useRef(new Animated.Value(0)).current;
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (_event, gestureState) => {
          translateY.setValue(gestureState.dy);
        },
        onPanResponderRelease: (_event, gestureState) => {
          const toIndex = Math.max(
            0,
            Math.min(
              total - 1,
              index + Math.round(gestureState.dy / REORDER_ROW_STEP),
            ),
          );
          onReorder(index, toIndex);
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 4,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 4,
          }).start();
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [index, onReorder, total, translateY],
  );

  return (
    <Animated.View
      {...panResponder.panHandlers}
      accessibilityHint="Drag vertically to rearrange this app"
      accessibilityLabel={`${app.name}, ${source} app`}
      accessibilityRole="adjustable"
      className="bg-card-dark border border-border-dark rounded-2xl flex-row items-center px-4 h-[72px]"
      style={{ transform: [{ translateY }] }}
    >
      <View
        className="h-11 w-11 rounded-xl items-center justify-center"
        style={{ backgroundColor: appAccentBackgroundColor(accentColor) }}
      >
        <AppIcon iconName={app.icon} size={22} color={accentColor} />
      </View>
      <View className="flex-1 ml-3 min-w-0">
        <Text
          className="text-foreground text-[15px] font-semibold"
          numberOfLines={1}
        >
          {app.name}
        </Text>
        <Text className="text-status-gray text-xs mt-0.5" numberOfLines={1}>
          {source}
        </Text>
      </View>
      <IconGripVertical
        color={colors.mutedForeground}
        size={20}
        strokeWidth={1.8}
      />
    </Animated.View>
  );
}

export default function AppsScreen() {
  const colors = useMobileThemeColors();
  const router = useRouter();
  const { enabledApps: localApps } = useApps();
  const workspace = useWorkspaceApps();
  const workspaceEnabled = workspace.enabled;
  const localAppIds = useMemo(
    () => new Set(localApps.map((app) => app.id)),
    [localApps],
  );
  const workspaceAppIds = useMemo(
    () =>
      new Set(
        workspace.apps
          .filter((app) => !localAppIds.has(app.id))
          .map((app) => app.id),
      ),
    [localAppIds, workspace.apps],
  );
  const availableApps = useMemo(
    () =>
      workspaceEnabled ? mergeAppLists(localApps, workspace.apps) : localApps,
    [localApps, workspace.apps, workspaceEnabled],
  );
  const [savedAppOrder, setSavedAppOrder] = useState<string[]>([]);
  const [appOrderReady, setAppOrderReady] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const enabledApps = useMemo(
    () =>
      workspaceEnabled && appOrderReady
        ? orderedAppsForIds(availableApps, savedAppOrder)
        : availableApps,
    [appOrderReady, availableApps, savedAppOrder, workspaceEnabled],
  );
  useEffect(() => {
    let active = true;
    void AppStore.readAppOrder().then((result) => {
      if (!active) return;
      setSavedAppOrder(result.ok ? result.ids : []);
      setAppOrderReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!workspaceEnabled || !appOrderReady) {
      setReorderMode(false);
      return;
    }
    setSavedAppOrder((current) => {
      const next = reconcileAppOrder(current, availableApps);
      if (
        next.length === current.length &&
        next.every((id, i) => id === current[i])
      ) {
        return current;
      }
      void AppStore.writeAppOrder(next);
      return next;
    });
  }, [appOrderReady, availableApps, workspaceEnabled]);

  const reorderApps = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!workspaceEnabled || !appOrderReady || fromIndex === toIndex) return;
      setSavedAppOrder((current) => {
        const next = orderedAppsForIds(availableApps, current).map(
          (app) => app.id,
        );
        const [movedId] = next.splice(fromIndex, 1);
        if (!movedId) return current;
        next.splice(toIndex, 0, movedId);
        void AppStore.writeAppOrder(next);
        return next;
      });
    },
    [appOrderReady, availableApps, workspaceEnabled],
  );

  const openApp = useCallback(
    (id: string) => {
      router.push(getAppRoute(id) as never);
    },
    [router],
  );

  return (
    <SafeAreaView edges={["top"]} className="bg-background-dark flex-1">
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 36 }}>
        <View className="items-center flex-row justify-between">
          <Text className="text-foreground text-[30px] font-bold tracking-[-1px]">
            Apps
          </Text>
          <View className="flex-row items-center gap-2">
            {workspaceEnabled && enabledApps.length > 1 ? (
              <Pressable
                accessibilityLabel={
                  reorderMode ? "Done reordering" : "Reorder apps"
                }
                accessibilityRole="button"
                accessibilityState={{ selected: reorderMode }}
                onPress={() => setReorderMode((current) => !current)}
                className={`flex-row items-center rounded-full border px-3 h-11 active:opacity-75 ${reorderMode ? "bg-gray-charcoal border-gray-charcoal" : "bg-card-dark border-border-dark"}`}
              >
                <IconArrowsMoveVertical
                  color={colors.foreground}
                  size={18}
                  strokeWidth={1.8}
                />
                <Text className="text-text-light text-xs font-semibold ml-1.5">
                  {reorderMode ? "Done" : "Reorder"}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel="Settings"
              accessibilityRole="button"
              onPress={() => router.push("/settings" as never)}
              className="items-center bg-card-dark border border-border-dark rounded-full h-11 w-11 justify-center active:opacity-75"
            >
              <IconSettings
                color={colors.foreground}
                size={21}
                strokeWidth={1.8}
              />
            </Pressable>
          </View>
        </View>

        <Text className="text-status-gray text-[11px] font-bold tracking-[1.2px] mb-2.5 mt-7">
          APPS
        </Text>
        {enabledApps.length > 0 ? (
          reorderMode ? (
            <View className="gap-2">
              {enabledApps.map((app, index) => (
                <ReorderableAppRow
                  key={app.id}
                  app={app}
                  index={index}
                  total={enabledApps.length}
                  source={workspaceAppIds.has(app.id) ? "Workspace" : "Local"}
                  onReorder={reorderApps}
                />
              ))}
            </View>
          ) : (
            <View className="flex-row flex-wrap -mx-[6px]">
              {enabledApps.map((app) => (
                <View key={app.id} className="w-[50%]">
                  <AppCard
                    app={app}
                    onPress={() => openApp(app.id)}
                    sourceLabel={
                      workspaceAppIds.has(app.id) ? "Workspace" : undefined
                    }
                  />
                </View>
              ))}
            </View>
          )
        ) : workspaceEnabled ? (
          <View className="rounded-2xl border border-border-dark bg-card-dark px-4 py-5">
            <Text className="text-text-light text-sm font-semibold">
              No apps yet
            </Text>
            <Text className="text-status-gray text-xs mt-1">
              Apps added to this workspace will appear here.
            </Text>
          </View>
        ) : null}

        <Text className="text-status-gray text-[11px] font-bold tracking-[1.2px] mb-2.5 mt-7">
          TOOLS
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/settings" as never)}
          className="items-center bg-card-dark border border-border-dark rounded-2xl flex-row p-[14px] active:opacity-75"
        >
          <View className="items-center bg-gray-charcoal rounded-xl h-[42px] w-[42px] justify-center">
            <IconSettings
              color={colors.foreground}
              size={20}
              strokeWidth={1.8}
            />
          </View>
          <View className="flex-1 ml-3">
            <Text className="text-text-light text-[15px] font-semibold">
              Customize navigation
            </Text>
            <Text className="text-status-gray text-xs leading-[17px] mt-0.5">
              Choose which apps sit beside Chat.
            </Text>
          </View>
          <IconChevronRight color={colors.mutedForeground} size={20} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
