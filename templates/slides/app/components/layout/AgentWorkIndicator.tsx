import { focusAgentChat, useT } from "@agent-native/core/client";
import { IconLoader2, IconMessageCircle } from "@tabler/icons-react";
import { useEffect, useState } from "react";

export function isAgentSidebarVisible() {
  const panel = document.querySelector<HTMLElement>(".agent-sidebar-panel");
  if (!panel) return false;
  if (panel.getAttribute("aria-hidden") === "true") return false;
  if (panel.inert) return false;

  const style = window.getComputedStyle(panel);
  if (style.display === "none" || style.visibility === "hidden") return false;

  const rect = panel.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function useAgentSidebarVisible() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(isAgentSidebarVisible());
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["aria-hidden", "class", "inert", "style"],
      childList: true,
      subtree: true,
    });
    window.addEventListener("resize", update);
    window.addEventListener("agent-panel:open", update);
    window.addEventListener("agent-panel:toggle", update);
    window.addEventListener("agent-panel:set-mode", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
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
  const sidebarVisible = useAgentSidebarVisible();

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (typeof detail?.isRunning === "boolean") {
        setRunning(detail.isRunning);
      }
    };
    window.addEventListener("agentNative.chatRunning", handler);
    return () => window.removeEventListener("agentNative.chatRunning", handler);
  }, []);

  if (!running || sidebarVisible) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 md:bottom-5">
      <div className="pointer-events-auto flex items-center justify-between gap-3 rounded-lg border border-border bg-popover/95 px-3 py-2 text-popover-foreground shadow-xl shadow-black/20 backdrop-blur">
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
