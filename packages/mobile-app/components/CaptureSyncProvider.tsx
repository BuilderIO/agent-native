import * as Notifications from "expo-notifications";
import { useEffect, type PropsWithChildren } from "react";
import { AppState, Linking } from "react-native";

import {
  enqueueCaptureJob,
  listCaptureJobs,
  recoverCaptureQueueStore,
} from "@/lib/capture-queue";
import { syncPendingCaptureJobs } from "@/lib/clips-api";
import { getClipsSession } from "@/lib/clips-session";
import {
  endStaleIOSCaptureActivities,
  importIOSSharedCaptures,
  subscribeToSharedCapture,
} from "@/lib/ios-companion";
import {
  listRecoverableCaptureFiles,
  sweepOrphanedCaptureFiles,
} from "@/lib/persist-capture";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

let handledNotificationResponseKey: string | null = null;

async function syncAndNotify(): Promise<void> {
  const result = await syncPendingCaptureJobs().catch(() => null);
  if (!result || (result.completed === 0 && result.exhausted === 0)) return;

  let permission = await Notifications.getPermissionsAsync().catch(() => null);
  if (permission && !permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync().catch(
      () => permission,
    );
  }
  if (!permission?.granted) return;
  if (result.completed > 0) {
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
  if (result.exhausted > 0) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title:
          result.exhausted === 1 ? "Capture needs help" : "Captures need help",
        body:
          result.exhausted === 1
            ? "Automatic retries stopped. Open Agent Native to retry safely."
            : `Automatic retries stopped for ${result.exhausted} captures. Open Agent Native to retry.`,
        data: { url: "agentnative://" },
      },
      trigger: null,
    });
  }
}

function notificationUrl(response: Notifications.NotificationResponse) {
  const url = response.notification.request.content.data?.url;
  if (typeof url !== "string") return null;
  try {
    return new URL(url).protocol === "agentnative:" ? url : null;
  } catch {
    return null;
  }
}

async function handleNotificationResponse(
  response: Notifications.NotificationResponse | null,
) {
  if (!response) return;
  const responseKey = `${response.notification.request.identifier}:${response.actionIdentifier}`;
  if (handledNotificationResponseKey === responseKey) return;
  handledNotificationResponseKey = responseKey;
  const url = notificationUrl(response);
  if (url) await Linking.openURL(url);
  await Notifications.clearLastNotificationResponseAsync().catch(() => null);
}

async function initializeCaptureStorage() {
  const resetCorruptedStore = await recoverCaptureQueueStore();
  await endStaleIOSCaptureActivities();
  await importIOSSharedCaptures();
  let jobs = await listCaptureJobs();
  if (resetCorruptedStore) {
    const session = await getClipsSession();
    for (const capture of listRecoverableCaptureFiles(
      jobs.map((job) => job.localUri),
    )) {
      await enqueueCaptureJob({
        id: capture.captureId,
        localUri: capture.localUri,
        ownerKey: session?.ownerKey,
        kind: capture.kind,
        durationMs: 0,
        mimeType: capture.mimeType,
        title: capture.title,
      });
    }
    jobs = await listCaptureJobs();
  }
  try {
    sweepOrphanedCaptureFiles(jobs.map((job) => job.localUri));
  } catch {
    // Queue sync can proceed even when a stale local file cannot be cleaned up.
  }
}

export default function CaptureSyncProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    let active = AppState.currentState === "active";
    let syncing = false;
    const initialized = initializeCaptureStorage();
    const run = async () => {
      if (!active || syncing) return;
      syncing = true;
      try {
        await initialized;
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
        void handleNotificationResponse(response);
      });
    const removeSharedCaptureListener = subscribeToSharedCapture(() => {
      void importIOSSharedCaptures().then(() => run());
    });
    void Notifications.getLastNotificationResponseAsync()
      .then(handleNotificationResponse)
      .catch(() => null);
    return () => {
      clearInterval(retryTimer);
      subscription.remove();
      responseSubscription.remove();
      removeSharedCaptureListener();
    };
  }, []);

  return children;
}
