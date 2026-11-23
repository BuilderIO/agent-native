import { ToolkitProvider } from "@agent-native/toolkit/provider";
import type { ReactNode } from "react";

import { useAppDesignSystem } from "../../design-system";
import { SettingsPartRenderer } from "./settings-part-renderer";

export function AppToolkitProvider({ children }: { children: ReactNode }) {
  const activeDesignSystem = useAppDesignSystem();
  return (
    <ToolkitProvider designSystem={activeDesignSystem}>
      <SettingsPartRenderer>{children}</SettingsPartRenderer>
    </ToolkitProvider>
  );
}
