import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

export const NATIVE_APP_AUTH_MODE_KEY = "agent-native:native-app-auth-mode";

const listeners = new Set<(enabled: boolean) => void>();

export interface NativeAppAuthState {
  enabled: boolean;
  ready: boolean;
}

export async function getNativeAppAuthEnabled(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(NATIVE_APP_AUTH_MODE_KEY);
  return stored !== "false";
}

export async function setNativeAppAuthEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(NATIVE_APP_AUTH_MODE_KEY, String(enabled));
  for (const listener of listeners) listener(enabled);
}

export function useNativeAppAuthState(): NativeAppAuthState {
  const [state, setState] = useState<NativeAppAuthState>({
    enabled: true,
    ready: false,
  });

  useEffect(() => {
    let active = true;
    void getNativeAppAuthEnabled().then(
      (value) => {
        if (active) setState({ enabled: value, ready: true });
      },
      () => {
        if (active) setState({ enabled: true, ready: true });
      },
    );
    const listener = (value: boolean) =>
      setState({ enabled: value, ready: true });
    listeners.add(listener);
    return () => {
      active = false;
      listeners.delete(listener);
    };
  }, []);

  return state;
}

export function useNativeAppAuthEnabled(): boolean {
  return useNativeAppAuthState().enabled;
}
