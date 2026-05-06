import { useEffect, useState } from "react";
import { IconLoader2, IconMessageCircle } from "@tabler/icons-react";
import { openAgentSidebar } from "@agent-native/core/client";

export function AgentWorkIndicator() {
  const [running, setRunning] = useState(false);

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

  if (!running) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 md:bottom-5">
      <div className="pointer-events-auto flex items-center justify-between gap-3 rounded-lg border border-border bg-popover/95 px-3 py-2 text-popover-foreground shadow-xl shadow-black/20 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          <IconLoader2 className="h-4 w-4 shrink-0 animate-spin text-[#609FF8]" />
          <span className="truncate text-sm font-medium">
            Agent is working
          </span>
        </div>
        <button
          type="button"
          onClick={openAgentSidebar}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <IconMessageCircle className="h-3.5 w-3.5" />
          Open chat
        </button>
      </div>
    </div>
  );
}
