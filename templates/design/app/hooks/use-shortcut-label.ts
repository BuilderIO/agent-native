import { useSyncExternalStore } from "react";

import { formatShortcutLabel } from "@/components/design/keyboard-shortcuts";
import { isApplePlatform } from "@/hooks/useDesignHotkeys";

const subscribe = () => () => {};
const notApple = () => false;

export function useApplePlatform(): boolean {
  return useSyncExternalStore(subscribe, isApplePlatform, notApple);
}

export function useShortcutLabel(binding: string): string {
  return formatShortcutLabel(binding, useApplePlatform());
}
