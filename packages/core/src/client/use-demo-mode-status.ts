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

/**
 * Reads the browser-local Demo mode presentation preference. This deliberately
 * has no backend request: the server and agent always operate on real data.
 */
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
