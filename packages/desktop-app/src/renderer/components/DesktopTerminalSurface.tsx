import type { AppConfig } from "@shared/app-registry";

import { type DesktopTerminalAgentId } from "../lib/desktop-terminal-preferences.js";
import type { RendererTheme } from "../lib/theme.js";
import DesktopTerminalTabs from "./DesktopTerminalTabs.js";

interface DesktopTerminalSurfaceProps {
  apps: readonly AppConfig[];
  agent: DesktopTerminalAgentId;
  theme: RendererTheme;
  className?: string;
}

export default function DesktopTerminalSurface({
  apps,
  agent,
  theme,
  className,
}: DesktopTerminalSurfaceProps) {
  return (
    <DesktopTerminalTabs
      apps={apps}
      agent={agent}
      theme={theme}
      className={className}
    />
  );
}
