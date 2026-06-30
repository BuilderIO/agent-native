import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useState, useEffect } from "react";

export type LocalRecordingMode = "off" | "composed" | "separate";

export interface RegionGuideRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RegionGuidesConfig {
  enabled: boolean;
  rects: RegionGuideRect[];
  alwaysVisible?: boolean;
}

export interface ScreenMemoryConfig {
  enabled: boolean;
  paused: boolean;
  retentionHours: number;
  maxBytes: number;
  segmentSeconds: number;
  sampleIntervalSeconds: number;
}

export type ScreenMemoryRuntimeState =
  | "disabled"
  | "idle"
  | "recording"
  | "paused";

export interface ScreenMemorySegmentMetadata {
  id: string;
  path: string;
  fileName: string;
  mimeType: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  width?: number | null;
  height?: number | null;
  bytes: number;
  corrupt: boolean;
  error?: string | null;
}

export interface ScreenMemoryActiveSegment {
  id: string;
  path: string;
  mimeType: string;
  startedAt: string;
  durationMs: number;
  width?: number | null;
  height?: number | null;
}

export interface ScreenMemoryStatus {
  available: boolean;
  state: ScreenMemoryRuntimeState;
  config: ScreenMemoryConfig;
  storageDir: string;
  activeSegment?: ScreenMemoryActiveSegment | null;
  recentSegments: ScreenMemorySegmentMetadata[];
  lastError?: string | null;
}

export interface ScreenMemoryDeleteResult {
  deletedSegments: number;
  deletedBytes: number;
}

export interface ScreenMemoryEvent {
  capturedAt: string;
  appName?: string | null;
  windowTitle?: string | null;
  bundleId?: string | null;
  source: string;
}

export interface ScreenMemoryQueryResult {
  query?: string | null;
  minutes: number;
  events: ScreenMemoryEvent[];
  segments: ScreenMemorySegmentMetadata[];
}

export interface ScreenMemoryExportFile {
  path: string;
  fileName: string;
  bytes: number;
  mimeType: string;
}

export interface ScreenMemoryExportResult {
  folderPath: string;
  files: ScreenMemoryExportFile[];
}

export interface FeatureConfig {
  clipsEnabled: boolean;
  meetingsEnabled: boolean;
  voiceEnabled: boolean;
  launchAtLoginEnabled: boolean;
  autoHidePopoverEnabled: boolean;
  meetingTranscriptionMode: "manual" | "ask" | "auto";
  localRecordingMode: LocalRecordingMode;
  showMeetingWidgetEnabled: boolean;
  showInScreenCapture: boolean;
  regionGuides: RegionGuidesConfig;
  screenMemory: ScreenMemoryConfig;
  onboardingComplete: boolean;
  whisperModelEnabled: boolean;
}

export function useFeatureConfig() {
  const [config, setConfig] = useState<FeatureConfig | null>(null);

  useEffect(() => {
    invoke<FeatureConfig>("get_feature_config")
      .then(setConfig)
      .catch(() => {});

    const unlistens: Array<() => void> = [];
    let stopped = false;

    const p = listen<FeatureConfig>("app:feature-config-changed", (ev) => {
      setConfig(ev.payload);
    });

    p.then((u) => {
      if (stopped) {
        try {
          u();
        } catch {
          // ignore
        }
        return;
      }
      unlistens.push(u);
    }).catch(() => {});

    return () => {
      stopped = true;
      unlistens.forEach((u) => {
        try {
          u();
        } catch {
          // ignore
        }
      });
      unlistens.length = 0;
    };
  }, []);

  return config;
}
