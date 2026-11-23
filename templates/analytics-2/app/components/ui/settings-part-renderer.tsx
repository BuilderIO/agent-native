import {
  SettingsSectionsRendererProvider,
  type SettingsSectionsProps,
} from "@agent-native/toolkit/app/settings/rows/index";
import { useDesignSystemPart } from "@agent-native/toolkit/design-system/parts";
import type { ReactNode } from "react";

/**
 * Public's `SettingsSections` takes its renderer from context, not from the
 * design system, so the active skin's `SettingsSections` part is handed over
 * here. Place it inside `ToolkitProvider`.
 */
export function SettingsPartRenderer({ children }: { children: ReactNode }) {
  const part = useDesignSystemPart<SettingsSectionsProps>("SettingsSections");
  return (
    <SettingsSectionsRendererProvider value={part ?? null}>
      {children}
    </SettingsSectionsRendererProvider>
  );
}
