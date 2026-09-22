import {
  focusAgentChat,
  SIDEBAR_STATE_CHANGE_EVENT,
  type AgentSidebarStateChangeDetail,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { IconLoader2, IconMessageCircle } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { CHAT_STOP_DEBOUNCE_MS } from "@/hooks/use-agent-generating";

export function isAgentSidebarVisible() {
  const panel = document.querySelector<HTMLElement>(".agent-sidebar-panel");
  if (!panel) return false;
  if (panel.getAttribute("aria-hidden") === "true") return false;
  if (panel.inert) return false;

  const style = window.getComputedStyle(panel);
  if (style.display === "none" || style.visibility === "hidden") return false;

  const rect = panel.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  for (
    let ancestor = panel.parentElement;
    ancestor && ancestor !== document.body;
    ancestor = ancestor.parentElement
  ) {
    if (ancestor.getAttribute("aria-hidden") === "true") return false;
    if (ancestor.inert) return false;
    const ancestorStyle = window.getComputedStyle(ancestor);
    if (
      ancestorStyle.display === "none" ||
      ancestorStyle.visibility === "hidden"
    ) {
      return false;
    }
  }

  return true;
}

function useAgentSidebarVisible() {
  const [visible, setVisible] = useState(false);
  const sidebarStateRef = useRef<boolean | null>(null);

  useEffect(() => {
    const update = () => {
      setVisible(sidebarStateRef.current ?? isAgentSidebarVisible());
    };
    const handleStateChange = (event: Event) => {
      const detail = (event as CustomEvent<AgentSidebarStateChangeDetail>)
        .detail;
      if (typeof detail?.open !== "boolean") return;
      sidebarStateRef.current = detail.open;
      setVisible(detail.open);
    };
    update();

    // The panel is a portal and is normally a direct child of body. Discover
    // portal mount/unmounts with a shallow child-list observer, then watch only
    // the panel and its immediate parent. Observing every body attribute and
    // descendant mutation made this tiny indicator run on every editor render.
    let panelObserver: MutationObserver | null = null;
    let parentObserver: MutationObserver | null = null;

    const observePanel = () => {
      panelObserver?.disconnect();
      parentObserver?.disconnect();
      const panel = document.querySelector<HTMLElement>(".agent-sidebar-panel");
      if (!panel) return;

      panelObserver = new MutationObserver(update);
      panelObserver.observe(panel, {
        attributes: true,
        attributeFilter: ["aria-hidden", "class", "inert", "style"],
      });
      if (panel.parentElement && panel.parentElement !== document.body) {
        parentObserver = new MutationObserver(update);
        parentObserver.observe(panel.parentElement, {
          attributes: true,
          attributeFilter: ["aria-hidden", "class", "inert", "style"],
          childList: true,
        });
      }
    };
    const updateAndObserve = () => {
      update();
      observePanel();
    };
    const discovery = new MutationObserver(updateAndObserve);
    discovery.observe(document.body, { childList: true });
    updateAndObserve();
    window.addEventListener("resize", update);
    window.addEventListener(SIDEBAR_STATE_CHANGE_EVENT, handleStateChange);
    window.addEventListener("agent-panel:open", update);
    window.addEventListener("agent-panel:toggle", update);
    window.addEventListener("agent-panel:set-mode", update);

    return () => {
      discovery.disconnect();
      panelObserver?.disconnect();
      parentObserver?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener(SIDEBAR_STATE_CHANGE_EVENT, handleStateChange);
      window.removeEventListener("agent-panel:open", update);
      window.removeEventListener("agent-panel:toggle", update);
      window.removeEventListener("agent-panel:set-mode", update);
    };
  }, []);

  return visible;
}

export function AgentWorkIndicator() {
  const t = useT();
  const [running, setRunning] = useState(false);
  const runningSourcesRef = useRef(new Set<string>());
  const stopDebounceRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const sidebarVisible = useAgentSidebarVisible();

  useEffect(() => {
    const legacySource = "__legacy__";
    const clearStopDebounce = (source: string) => {
      const timer = stopDebounceRef.current.get(source);
      if (timer !== undefined) {
        clearTimeout(timer);
        stopDebounceRef.current.delete(source);
      }
    };
    const syncRunning = () => setRunning(runningSourcesRef.current.size > 0);
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (typeof detail?.isRunning === "boolean") {
        const source =
          typeof detail.tabId === "string" && detail.tabId.trim()
            ? detail.tabId
            : legacySource;
        clearStopDebounce(source);
        if (detail.isRunning) {
          runningSourcesRef.current.add(source);
          syncRunning();
        } else if (detail.reason === "stopped") {
          runningSourcesRef.current.delete(source);
          syncRunning();
        } else {
          const timer = setTimeout(() => {
            stopDebounceRef.current.delete(source);
            runningSourcesRef.current.delete(source);
            syncRunning();
          }, CHAT_STOP_DEBOUNCE_MS);
          stopDebounceRef.current.set(source, timer);
        }
      }
    };
    window.addEventListener("agentNative.chatRunning", handler);
    return () => {
      for (const timer of stopDebounceRef.current.values()) {
        clearTimeout(timer);
      }
      stopDebounceRef.current.clear();
      window.removeEventListener("agentNative.chatRunning", handler);
    };
  }, []);

  if (!running || sidebarVisible) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 md:bottom-5">
      <div className="pointer-events-auto flex items-center justify-between gap-3 rounded-lg border border-border bg-popover/95 px-3 py-2 text-popover-foreground shadow-xl shadow-black/20">
        <div className="flex min-w-0 items-center gap-2">
          <IconLoader2 className="h-4 w-4 shrink-0 animate-spin text-[#609FF8]" />
          <span className="truncate text-sm font-medium">
            {t("raw.agentWorking")}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent("agent-panel:set-mode", {
                detail: { mode: "chat" },
              }),
            );
            focusAgentChat();
          }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <IconMessageCircle className="h-3.5 w-3.5" />
          {t("raw.openChat")}
        </button>
      </div>
    </div>
  );
}
