import { ExtensionStorage } from "@bacons/apple-targets";
import { Directory, File, Paths } from "expo-file-system";
import { NativeEventEmitter, NativeModules, Platform } from "react-native";

import { enqueueCaptureJob } from "./capture-queue";
import { getClipsSession } from "./clips-session";
import { persistCaptureFile } from "./persist-capture";

const APP_GROUP = "group.com.agentnative.mobile";

interface IOSCompanionModule {
  startCaptureActivity(
    captureId: string,
    kind: string,
    startedAtMs: number,
  ): Promise<string | null>;
  updateCaptureActivity(captureId: string, phase: string): Promise<void>;
  endCaptureActivity(captureId: string, phase: string): Promise<void>;
  endStaleCaptureActivities(): Promise<void>;
}

interface SharedCaptureManifest {
  captureId: string;
  capturedAt: string;
  durationMs?: number;
  fileName: string;
  kind: "audio" | "video";
  mimeType: string;
  status?: "completed" | "recording";
  title: string;
  updatedAt?: string;
}

const ACTIVE_SHARED_CAPTURE_WINDOW_MS = 30_000;

const nativeCompanion =
  Platform.OS === "ios"
    ? (NativeModules.AgentNativeIOSCompanion as IOSCompanionModule | undefined)
    : undefined;
const companionEvents = nativeCompanion
  ? new NativeEventEmitter(NativeModules.AgentNativeIOSCompanion)
  : null;

export function startIOSCaptureActivity(input: {
  captureId: string;
  kind: "audio" | "dictation" | "meeting" | "video";
  startedAt: number;
}) {
  return nativeCompanion
    ?.startCaptureActivity(input.captureId, input.kind, input.startedAt)
    .catch(() => null);
}

export function updateIOSCaptureActivity(
  captureId: string,
  phase: "paused" | "recording",
) {
  return nativeCompanion
    ?.updateCaptureActivity(captureId, phase)
    .catch(() => null);
}

export function endIOSCaptureActivity(
  captureId: string,
  phase: "completed" | "discarded" | "failed",
) {
  return nativeCompanion
    ?.endCaptureActivity(captureId, phase)
    .catch(() => null);
}

export function endStaleIOSCaptureActivities() {
  return nativeCompanion?.endStaleCaptureActivities().catch(() => null);
}

export function subscribeToIOSCaptureStop(
  listener: (captureId: string) => void,
) {
  const subscription = companionEvents?.addListener(
    "captureStopRequested",
    (event: { captureId?: unknown }) => {
      if (typeof event.captureId === "string") listener(event.captureId);
    },
  );
  return () => subscription?.remove();
}

export function subscribeToSharedCapture(
  listener: (captureId: string) => void,
) {
  const subscription = companionEvents?.addListener(
    "sharedCaptureAvailable",
    (event: { captureId?: unknown }) => {
      if (typeof event.captureId === "string") listener(event.captureId);
    },
  );
  return () => subscription?.remove();
}

export function publishKeyboardDictation(text: string, requestId?: string) {
  if (Platform.OS !== "ios" || !requestId) return;
  const storage = new ExtensionStorage(APP_GROUP);
  storage.set("keyboard.latestText", text);
  storage.set("keyboard.resultRequestId", requestId);
}

export function getPendingKeyboardDictationRequestId(): string | undefined {
  if (Platform.OS !== "ios") return undefined;
  const storage = new ExtensionStorage(APP_GROUP);
  const activeRequest = storage.get("keyboard.activeRequestId");
  const insertedRequest = storage.get("keyboard.lastInsertedRequestId");
  return activeRequest &&
    activeRequest !== insertedRequest &&
    /^[a-z0-9-]{20,80}$/i.test(activeRequest)
    ? activeRequest
    : undefined;
}

function parseSharedCaptureManifest(
  value: string,
): SharedCaptureManifest | null {
  try {
    const parsed = JSON.parse(value) as Partial<SharedCaptureManifest>;
    if (
      typeof parsed.captureId !== "string" ||
      typeof parsed.capturedAt !== "string" ||
      typeof parsed.fileName !== "string" ||
      (parsed.kind !== "audio" && parsed.kind !== "video") ||
      typeof parsed.mimeType !== "string" ||
      typeof parsed.title !== "string" ||
      (parsed.durationMs !== undefined &&
        (typeof parsed.durationMs !== "number" ||
          !Number.isFinite(parsed.durationMs))) ||
      (parsed.status !== undefined &&
        parsed.status !== "completed" &&
        parsed.status !== "recording") ||
      (parsed.updatedAt !== undefined && typeof parsed.updatedAt !== "string")
    ) {
      return null;
    }
    return parsed as SharedCaptureManifest;
  } catch {
    return null;
  }
}

export function isSharedCaptureReadyForImport(
  manifest: Pick<SharedCaptureManifest, "status" | "updatedAt">,
  now = Date.now(),
): boolean {
  if (manifest.status !== "recording") return true;
  if (!manifest.updatedAt) return true;
  const updatedAt = Date.parse(manifest.updatedAt);
  return (
    !Number.isFinite(updatedAt) ||
    now - updatedAt >= ACTIVE_SHARED_CAPTURE_WINDOW_MS
  );
}

export async function importIOSSharedCaptures(): Promise<number> {
  if (Platform.OS !== "ios") return 0;
  const sharedRoot = Paths.appleSharedContainers[APP_GROUP];
  if (!sharedRoot?.exists) return 0;
  const directory = new Directory(sharedRoot, "captures");
  if (!directory.exists) return 0;

  const manifests = directory
    .list()
    .filter(
      (entry): entry is File =>
        entry instanceof File && entry.extension.toLowerCase() === ".json",
    );
  const session = await getClipsSession();
  let imported = 0;

  for (const manifestFile of manifests) {
    const manifest = parseSharedCaptureManifest(await manifestFile.text());
    if (!manifest) continue;
    if (!isSharedCaptureReadyForImport(manifest)) continue;
    const mediaFile = new File(directory, manifest.fileName);
    if (!mediaFile.exists) continue;
    if (typeof mediaFile.size === "number" && mediaFile.size <= 0) continue;
    try {
      const localUri = await persistCaptureFile(
        mediaFile.uri,
        manifest.mimeType,
        manifest.captureId,
      );
      await enqueueCaptureJob({
        id: manifest.captureId,
        localUri,
        ownerKey: session?.ownerKey,
        kind: manifest.kind === "audio" ? "meeting" : "video",
        durationMs: Math.max(0, manifest.durationMs ?? 0),
        mimeType: manifest.mimeType,
        title: manifest.title,
        capturedAt: manifest.capturedAt,
        retainLocalFile: false,
      });
      manifestFile.delete();
      mediaFile.delete();
      imported += 1;
    } catch {
      // Keep shared metadata and media intact so a later foreground tick can retry.
    }
  }

  return imported;
}
