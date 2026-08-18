import { ToolkitProvider } from "@agent-native/toolkit";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";

import { designSystem, muiDarkTheme, muiLightTheme } from "@/design-system";

export function AppToolkitProvider({ children }: { children: ReactNode }) {
  return (
    <ToolkitProvider designSystem={designSystem}>{children}</ToolkitProvider>
  );
}

export function MaterialThemeProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    <ThemeProvider
      theme={resolvedTheme === "dark" ? muiDarkTheme : muiLightTheme}
    >
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
