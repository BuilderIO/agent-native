import { ToolkitProvider, type ToolkitComponents } from "@agent-native/toolkit";
import { ConfigProvider } from "antd";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { antdDarkTheme, antdLightTheme, designSystem } from "@/design-system";

const components: ToolkitComponents = {
  Button: Button as ToolkitComponents["Button"],
};

export function AppToolkitProvider({ children }: { children: ReactNode }) {
  return (
    <ToolkitProvider components={components} designSystem={designSystem}>
      {children}
    </ToolkitProvider>
  );
}

export function AntThemeProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    <ConfigProvider
      theme={resolvedTheme === "dark" ? antdDarkTheme : antdLightTheme}
    >
      {children}
    </ConfigProvider>
  );
}
