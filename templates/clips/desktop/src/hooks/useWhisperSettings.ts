import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

import type { VoiceProvider } from "../lib/voice-dictation";
import type { FeatureConfig } from "../shared/config";

export interface WhisperModelOption {
  id: string;
  title: string;
  description: string;
  url: string;
  filename: string;
  sha256: string;
  sizeBytes: number;
  sizeMb: number;
}

export type WhisperModelState =
  | "disabled"
  | "missing"
  | "downloading"
  | "ready";

export interface WhisperModelStatus {
  state: WhisperModelState;
  path: string;
  downloadedMb: number;
  totalMb: number;
}

const WHISPER_STATUS_EVENTS = [
  "whisper:model-progress",
  "whisper:model-error",
  "whisper:model-enabled-changed",
  "whisper:model-selection-changed",
] as const;

export function useWhisperSettings(
  featureConfig: FeatureConfig | null,
  voiceProvider: VoiceProvider,
  onVoiceProviderChange: (provider: VoiceProvider) => void,
  nativeVoiceProvider: () => VoiceProvider,
) {
  const [catalog, setCatalog] = useState<WhisperModelOption[]>([]);
  const [downloadedModelIds, setDownloadedModelIds] = useState<string[]>([]);
  const [status, setStatus] = useState<WhisperModelStatus | null>(null);

  const enabled = featureConfig?.whisperModelEnabled !== false;
  const modelId = featureConfig?.whisperModelId ?? "base";
  const selectedModel = catalog.find((m) => m.id === modelId) ?? null;
  const deletableModels = catalog.filter(
    (m) => m.id !== modelId && downloadedModelIds.includes(m.id),
  );

  useEffect(() => {
    invoke<WhisperModelOption[]>("whisper_models")
      .then(setCatalog)
      .catch(() => {});
  }, []);

  const refreshDownloaded = useCallback(() => {
    invoke<string[]>("whisper_downloaded_models")
      .then(setDownloadedModelIds)
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshStatus = () => {
      invoke<WhisperModelStatus>("whisper_model_status")
        .then((s) => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => {});
    };

    refreshStatus();
    refreshDownloaded();

    const unlistens: Array<() => void> = [];
    const track = (p: Promise<() => void>) => {
      p.then((u) => {
        if (cancelled) {
          try {
            u();
          } catch {
            /* ignore */
          }
          return;
        }
        unlistens.push(u);
      }).catch(() => {});
    };

    for (const event of WHISPER_STATUS_EVENTS) {
      track(listen(event, () => refreshStatus()));
    }
    track(
      listen("whisper:model-ready", () => {
        refreshStatus();
        refreshDownloaded();
      }),
    );
    track(listen("whisper:model-deleted", () => refreshDownloaded()));

    return () => {
      cancelled = true;
      unlistens.forEach((u) => {
        try {
          u();
        } catch {
          /* ignore */
        }
      });
    };
  }, [refreshDownloaded]);

  function triggerDownload() {
    invoke("whisper_model_download").catch(() => {});
  }

  function setEnabled(next: boolean) {
    if (!featureConfig) return;
    invoke("set_feature_config", {
      config: { ...featureConfig, whisperModelEnabled: next },
    })
      .then(() => {
        if (next) {
          triggerDownload();
        } else if (voiceProvider === "whisper") {
          onVoiceProviderChange(nativeVoiceProvider());
        }
      })
      .catch((err) =>
        console.error("[whisper] set_feature_config failed", err),
      );
  }

  function setModelId(next: string) {
    if (!featureConfig) return;
    invoke("set_feature_config", {
      config: { ...featureConfig, whisperModelId: next },
    })
      .then(() => {
        if (enabled) triggerDownload();
      })
      .catch((err) =>
        console.error("[whisper] set_feature_config failed", err),
      );
  }

  function deleteModel(modelIdToDelete: string) {
    invoke("whisper_model_delete", { modelId: modelIdToDelete })
      .then(() => refreshDownloaded())
      .catch(() => {});
  }

  return {
    catalog,
    downloadedModelIds,
    status,
    enabled,
    modelId,
    selectedModel,
    deletableModels,
    triggerDownload,
    setEnabled,
    setModelId,
    deleteModel,
  };
}
