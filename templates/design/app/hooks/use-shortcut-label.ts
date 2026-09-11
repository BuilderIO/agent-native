import { useSyncExternalStore } from "react";

import { formatShortcutLabel } from "@/components/design/keyboard-shortcuts";
import { isApplePlatform } from "@/hooks/useDesignHotkeys";

const subscribe = () => () => {};
const notApple = () => false;

/**
 * The SSR shell is one impersonal document cached for every visitor, so the
 * viewer's platform is unknowable until hydration — read isApplePlatform()
 * straight from render and a Mac mismatches the server HTML.
 */
export function useApplePlatform(): boolean {
  return useSyncExternalStore(subscribe, isApplePlatform, notApple);
}

/** Platform-correct menu/tooltip hint for one `$mod+shift+r`-style binding. */
export function useShortcutLabel(binding: string): string {
  return formatShortcutLabel(binding, useApplePlatform());
}
