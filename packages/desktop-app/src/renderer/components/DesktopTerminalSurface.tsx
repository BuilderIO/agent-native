import {
  chatFirstSurfaceTabId,
  type ChatFirstSurfaceTab,
} from "@agent-native/core/client/agent-chat";
import {
  ChatFirstSurfaceContent,
  ChatFirstSurfaceTabs,
} from "@agent-native/core/client/chat-first";
import type { AppConfig } from "@shared/app-registry";
import { useCallback, useState } from "react";

import {
  type DesktopTerminalAgentId,
} from "../lib/desktop-terminal-preferences.js";
import type { RendererTheme } from "../lib/theme.js";
import DesktopTerminalTabs from "./DesktopTerminalTabs.js";

interface DesktopTerminalSurfaceProps {
  apps: readonly AppConfig[];
  agent: DesktopTerminalAgentId;
  theme: RendererTheme;
  className?: string;
}

let terminalSurfaceTabCounter = 1;

function createTerminalTab(): ChatFirstSurfaceTab {
  const number = terminalSurfaceTabCounter++;
  return {
    id: chatFirstSurfaceTabId("terminal", `desktop-${number}`),
    kind: "terminal",
    title: `Terminal ${number}`,
  };
}

export default function DesktopTerminalSurface({
  apps,
  agent,
  theme,
  className,
}: DesktopTerminalSurfaceProps) {
  const [tabs, setTabs] = useState<ChatFirstSurfaceTab[]>(() => [
    createTerminalTab(),
  ]);
  const [activeTabId, setActiveTabId] = useState<string | null>(
    () => tabs[0]?.id ?? null,
  );

  const addTab = useCallback(() => {
    const next = createTerminalTab();
    setTabs((current) => [...current, next]);
    setActiveTabId(next.id);
  }, []);

  const closeTab = useCallback((tab: ChatFirstSurfaceTab) => {
    setTabs((current) => {
      if (current.length === 1) {
        const replacement = createTerminalTab();
        setActiveTabId(replacement.id);
        return [replacement];
      }
      const index = current.findIndex((candidate) => candidate.id === tab.id);
      if (index < 0) return current;
      const next = current.filter((candidate) => candidate.id !== tab.id);
      if (tab.id === activeTabId) {
        setActiveTabId(next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? null);
      }
      return next;
    });
  }, [activeTabId]);

  const closeOthers = useCallback((tab: ChatFirstSurfaceTab) => {
    setTabs((current) => {
      const target = current.find((candidate) => candidate.id === tab.id);
      if (!target) return current;
      setActiveTabId(target.id);
      return [target];
    });
  }, []);

  const closeToRight = useCallback((tab: ChatFirstSurfaceTab) => {
    setTabs((current) => {
      const index = current.findIndex((candidate) => candidate.id === tab.id);
      if (index < 0) return current;
      const next = current.slice(0, index + 1);
      if (!next.some((candidate) => candidate.id === activeTabId)) {
        setActiveTabId(tab.id);
      }
      return next;
    });
  }, [activeTabId]);

  const closeAll = useCallback(() => {
    const replacement = createTerminalTab();
    setTabs([replacement]);
    setActiveTabId(replacement.id);
  }, []);

  return (
    <div
      className={[
        "desktop-terminal-surface",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-desktop-terminal-surface
    >
      <ChatFirstSurfaceTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={(tab) => setActiveTabId(tab.id)}
        onClose={closeTab}
        onCloseOthers={closeOthers}
        onCloseToRight={closeToRight}
        onCloseAll={closeAll}
        onAddTab={addTab}
        addTabLabel="New terminal"
      />
      <ChatFirstSurfaceContent
        tabs={tabs}
        activeTabId={activeTabId}
        renderTab={() => (
          <DesktopTerminalTabs apps={apps} agent={agent} theme={theme} />
        )}
      />
    </div>
  );
}
