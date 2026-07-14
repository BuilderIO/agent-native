import { useCallback, useEffect, useState } from "react";

import { agentNativePath } from "./api-path.js";

export interface VoiceProviderStatus {
  builder: boolean;
  openai: boolean;
}

export async function getVoiceProviderStatus(): Promise<VoiceProviderStatus> {
  const response = await fetch(
    agentNativePath("/_agent-native/voice-providers/status"),
    { credentials: "same-origin" },
  );
  if (!response.ok) {
    throw new Error(`Voice provider status unavailable (${response.status})`);
  }
  const status = (await response.json()) as Partial<VoiceProviderStatus>;
  return { builder: status.builder === true, openai: status.openai === true };
}

export function useVoiceProviderStatus() {
  const [status, setStatus] = useState<VoiceProviderStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getVoiceProviderStatus());
    } catch {
      // Keep the last known status. The session route remains authoritative.
    }
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("agent-engine:configured-changed", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("agent-engine:configured-changed", refresh);
    };
  }, [refresh]);

  return { status, refresh };
}
