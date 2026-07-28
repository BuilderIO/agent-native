import { ToolkitProvider, type ToolkitComponents } from "@agent-native/toolkit";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

const components: ToolkitComponents = {
  Button: Button as ToolkitComponents["Button"],
};

export function AppToolkitProvider({ children }: { children: ReactNode }) {
  return <ToolkitProvider components={components}>{children}</ToolkitProvider>;
}
