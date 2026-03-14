import { useBuilderAuth } from "./BuilderAuthContext";
import { cn } from "@/lib/utils";
import { Link2, Link2Off, ChevronDown } from "lucide-react";
import { useState } from "react";

export function BuilderSettings() {
  const { auth, isConnected, connect, disconnect } = useBuilderAuth();
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mt-2 pt-2 border-t border-sidebar-border">
      <div className="flex items-center justify-between px-3 py-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted hover:text-sidebar-foreground transition-colors"
        >
          <ChevronDown
            size={10}
            className={cn(
              "transition-transform duration-150",
              !expanded && "-rotate-90"
            )}
          />
          Builder.io
        </button>
        <div
          className={cn(
            "w-1.5 h-1.5 rounded-full",
            isConnected ? "bg-green-500" : "bg-muted-foreground/30"
          )}
        />
      </div>
      {expanded && (
        <div className="px-2 mt-0.5">
          {isConnected ? (
            <div className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-sidebar-foreground/70">
              <Link2 size={12} className="shrink-0 text-green-500" />
              <span className="truncate">{auth?.orgName || "Connected"}</span>
            </div>
          ) : (
            <button
              onClick={connect}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-[4px] text-[13px] text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
            >
              <Link2 size={14} className="shrink-0" />
              <span>Connect to Builder</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
