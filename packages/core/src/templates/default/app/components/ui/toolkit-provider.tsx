import { ToolkitProvider } from "@agent-native/toolkit/provider";
import type { ReactNode } from "react";

import { designSystem } from "@/design-system";

export function AppToolkitProvider({ children }: { children: ReactNode }) {
  return (
    <ToolkitProvider designSystem={designSystem}>{children}</ToolkitProvider>
  );
}
