import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useState, useEffect } from "react";

interface FeatureConfig {
  clipsEnabled: boolean;
  meetingsEnabled: boolean;
  voiceEnabled: boolean;
  onboardingComplete: boolean;
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
