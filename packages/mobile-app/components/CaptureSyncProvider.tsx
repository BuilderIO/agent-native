import * as Notifications from "expo-notifications";
import { useEffect, type PropsWithChildren } from "react";
import { AppState, Linking } from "react-native";

import { syncPendingCaptureJobs } from "@/lib/clips-api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function syncAndNotify(): Promise<void> {
  const result = await syncPendingCaptureJobs().catch(() => null);
  if (!result || result.completed === 0) return;

  let permission = await Notifications.getPermissionsAsync().catch(() => null);
  if (permission && !permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync().catch(
      () => permission,
    );
  }
  if (!permission?.granted) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: result.completed === 1 ? "Capture ready" : "Captures ready",
      body:
        result.completed === 1
          ? "Your Agent Native capture is ready in Clips."
          : `${result.completed} Agent Native captures are ready in Clips.`,
      data: { url: "agentnative://clips" },
    },
    trigger: null,
  });
}

export default function CaptureSyncProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    let active = AppState.currentState === "active";
    let syncing = false;
    const run = async () => {
      if (!active || syncing) return;
      syncing = true;
      try {
        await syncAndNotify();
      } catch {
        // The queue keeps its retry metadata; the next foreground tick retries.
      } finally {
        syncing = false;
      }
    };

    void run();
    const subscription = AppState.addEventListener("change", (state) => {
      active = state === "active";
      if (active) void run();
    });
    const retryTimer = setInterval(() => void run(), 5_000);
    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const url = response.notification.request.content.data?.url;
        if (typeof url === "string") void Linking.openURL(url);
      });
    return () => {
      clearInterval(retryTimer);
      subscription.remove();
      responseSubscription.remove();
    };
  }, []);

  return children;
}
