import { IconX } from "@tabler/icons-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const AGENT_SIDEBAR_WIDTH_KEY = "agent-native-sidebar-width";
const DEFAULT_AGENT_SIDEBAR_WIDTH = 380;

/** Match AgentSidebar width so app-owned panels sit flush on the right edge.
 *  Uses the same localStorage key the framework writes on resize (280–700px).
 *  Reads once on mount only — live agent-sidebar drags do not update this hook. */
function useAgentSidebarWidth() {
  const [width, setWidth] = useState(DEFAULT_AGENT_SIDEBAR_WIDTH);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(AGENT_SIDEBAR_WIDTH_KEY);
      if (!saved) return;
      const parsed = Number.parseInt(saved, 10);
      if (parsed >= 280 && parsed <= 700) setWidth(parsed);
    } catch {
      // Keep the default width if storage is unavailable.
    }
  }, []);

  return width;
}

export function SidePanel({
  children,
  className,
  title,
  subtitle,
  closeLabel = "Close panel",
  onClose,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  closeLabel?: string;
  onClose?: () => void;
}) {
  const width = useAgentSidebarWidth();

  useEffect(() => {
    if (!onClose) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose?.();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <aside
      className={cn(
        "fixed inset-y-0 right-0 z-[70] flex max-w-[85vw] flex-col overflow-hidden border-l border-border bg-background text-[13px] leading-[1.2] text-foreground antialiased shadow-2xl transition-transform duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none md:shadow-none",
        className,
      )}
      style={{ width }}
    >
      {title || onClose ? (
        <div className="relative z-[240] flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
          <div className="min-w-0 px-1">
            {title ? (
              <h2 className="truncate text-[13px] font-semibold leading-tight">
                {title}
              </h2>
            ) : null}
            {subtitle ? (
              <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
          </div>
          {onClose ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label={closeLabel}
              className="size-8"
            >
              <IconX className="size-4" />
            </Button>
          ) : null}
        </div>
      ) : null}
      {children}
    </aside>
  );
}
