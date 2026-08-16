import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Text, View } from "react-native";

import AppWebView from "@/components/AppWebView";
import { NativeClipsLibraryScreen } from "@/components/NativeClipsLibrary";
import { SafeAreaView } from "@/components/uniwind-interop";
import { hasClipsSessionToken } from "@/lib/clips-api";
import {
  CLIPS_SESSION_OWNER_KEY,
  CLIPS_SESSION_TOKEN_KEY,
} from "@/lib/clips-session";
import { getAppUrl } from "@/lib/get-app-url";
import { useMobileThemeColors } from "@/lib/mobile-colors";
import { setMobileCaptureStateBestEffort } from "@/lib/mobile-state-api";
import { SESSION_TOKEN_KEY } from "@/lib/session-token-store";

const clips = TEMPLATE_APPS.find((a) => a.id === "clips")!;

export default function ClipsTab() {
  const colors = useMobileThemeColors();
  const [authState, setAuthState] = useState<
    "checking" | "connected" | "signed-out"
  >("checking");

  const refreshAuth = useCallback(async () => {
    setAuthState((current) => (current === "checking" ? "checking" : current));
    const connected = await hasClipsSessionToken().catch(() => false);
    setAuthState(connected ? "connected" : "signed-out");
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshAuth();
    }, [refreshAuth]),
  );

  useEffect(() => {
    if (authState !== "signed-out") return;
    let active = AppState.currentState === "active";
    let inFlight = false;
    const tick = () => {
      if (!active || inFlight) return;
      inFlight = true;
      void refreshAuth().finally(() => {
        inFlight = false;
      });
    };
    const interval = setInterval(tick, 800);
    const subscription = AppState.addEventListener("change", (state) => {
      active = state === "active";
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [authState, refreshAuth]);

  useEffect(() => {
    if (authState !== "connected") return;
    void setMobileCaptureStateBestEffort({
      view: "clips",
      phase: "browsing",
    });
  }, [authState]);

  if (authState === "checking") {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-background-dark">
        <View className="items-center flex-1 justify-center">
          <ActivityIndicator color={colors.mutedForeground} />
          <Text className="text-status-gray text-[13px] mt-2.5">
            Opening Clips…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (authState === "connected") {
    return (
      <NativeClipsLibraryScreen
        onAuthRequired={() => setAuthState("signed-out")}
        onSelectionChange={(recordingId) => {
          void setMobileCaptureStateBestEffort({
            view: "clips",
            phase: recordingId ? "playing" : "browsing",
            ...(recordingId ? { recordingId } : {}),
          });
        }}
      />
    );
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background-dark">
      <AppWebView
        url={getAppUrl(clips)}
        captureSessionToken
        workspaceAppId="clips"
        parentSessionTokenKey={SESSION_TOKEN_KEY}
        sessionOwnerKey={CLIPS_SESSION_OWNER_KEY}
        sessionTokenKey={CLIPS_SESSION_TOKEN_KEY}
      />
    </SafeAreaView>
  );
}
