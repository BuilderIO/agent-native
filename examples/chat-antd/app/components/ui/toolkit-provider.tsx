import { ToolkitProvider } from "@agent-native/toolkit";
import { ConfigProvider } from "antd";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";

import { antdDarkTheme, antdLightTheme, designSystem } from "@/design-system";

export function AppToolkitProvider({ children }: { children: ReactNode }) {
  return (
    <ToolkitProvider designSystem={designSystem}>{children}</ToolkitProvider>
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
