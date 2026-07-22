import { ToolkitProvider, type ToolkitComponents } from "@agent-native/toolkit";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { designSystem, muiDarkTheme, muiLightTheme } from "@/design-system";

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
