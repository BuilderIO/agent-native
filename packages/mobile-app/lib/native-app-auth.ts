import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

export const NATIVE_APP_AUTH_MODE_KEY = "agent-native:native-app-auth-mode";

const listeners = new Set<(enabled: boolean) => void>();

export async function getNativeAppAuthEnabled(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(NATIVE_APP_AUTH_MODE_KEY);
  return stored !== "false";
}

export async function setNativeAppAuthEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(NATIVE_APP_AUTH_MODE_KEY, String(enabled));
  for (const listener of listeners) listener(enabled);
}

export function useNativeAppAuthEnabled(): boolean {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let active = true;
    void getNativeAppAuthEnabled().then((value) => {
      if (active) setEnabled(value);
    });
    const listener = (value: boolean) => setEnabled(value);
    listeners.add(listener);
    return () => {
      active = false;
      listeners.delete(listener);
    };
  }, []);

  return enabled;
}
