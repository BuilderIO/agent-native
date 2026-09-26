import { useSyncExternalStore } from "react";

import {
  getBrowserDemoModeEnabled,
  subscribeToBrowserDemoMode,
} from "../demo/browser-state.js";

export interface DemoModeStatus {
  enabled: boolean;
  forced: false;
  isLoading: boolean;
}

export function useDemoModeStatus(): DemoModeStatus {
  const enabled = useSyncExternalStore(
    subscribeToBrowserDemoMode,
    getBrowserDemoModeEnabled,
    () => false,
  );

  return {
    enabled,
    forced: false,
    isLoading: false,
  };
}
