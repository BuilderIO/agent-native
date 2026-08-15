import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui";
import type { AppConfig } from "@shared/app-registry";
import { IconDotsVertical, IconPlus, IconX } from "@tabler/icons-react";
import { useCallback, useRef, useState } from "react";

import { type DesktopTerminalAgentId } from "../lib/desktop-terminal-preferences.js";
import type { RendererTheme } from "../lib/theme.js";
import DesktopTerminalTabs from "./DesktopTerminalTabs.js";

interface DesktopTerminalSurfaceProps {
  apps: readonly AppConfig[];
  agent: DesktopTerminalAgentId;
  theme: RendererTheme;
  className?: string;
}

interface DesktopTerminalTab {
  id: string;
  label: string;
}

function createTerminalTab(number: number): DesktopTerminalTab {
  return {
    id: `desktop-terminal-${number}`,
    label: `Terminal ${number}`,
  };
}

export default function DesktopTerminalSurface({
  apps,
  agent,
  theme,
  className,
}: DesktopTerminalSurfaceProps) {
  const tabCounter = useRef(1);
  const [tabs, setTabs] = useState<DesktopTerminalTab[]>(() => [
    createTerminalTab(1),
  ]);
  const [activeTabId, setActiveTabId] = useState("desktop-terminal-1");

  const addTab = useCallback(() => {
    const next = createTerminalTab(++tabCounter.current);
    setTabs((current) => [...current, next]);
    setActiveTabId(next.id);
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((current) => {
        if (current.length === 1) {
          const replacement = createTerminalTab(++tabCounter.current);
          setActiveTabId(replacement.id);
          return [replacement];
        }
        const index = current.findIndex((tab) => tab.id === tabId);
        if (index < 0) return current;
        const next = current.filter((tab) => tab.id !== tabId);
        if (tabId === activeTabId) {
          setActiveTabId(
            next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? "",
          );
        }
        return next;
      });
    },
    [activeTabId],
  );

  const closeOtherTabs = useCallback(
    (tabId: string) => {
      setTabs((current) => {
        const target = current.find((tab) => tab.id === tabId);
        if (!target) return current;
        setActiveTabId(target.id);
        return [target];
      });
    },
    [],
  );

  const closeAllTabs = useCallback(() => {
    const replacement = createTerminalTab(++tabCounter.current);
    setTabs([replacement]);
    setActiveTabId(replacement.id);
  }, []);

  return (
    <DesktopTerminalTabs
      apps={apps}
      agent={agent}
      theme={theme}
      className={className}
    />
  );
}
