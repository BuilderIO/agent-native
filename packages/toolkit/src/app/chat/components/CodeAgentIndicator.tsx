import { useT } from "@agent-native/core/client/i18n";
import { cn } from "@agent-native/toolkit/utils";
import { useEffect, useState } from "react";

export interface CodeAgentIndicatorProps {
  isWorking: boolean;
  label?: string;
}

export function CodeAgentIndicator({
  isWorking,
  label,
}: CodeAgentIndicatorProps) {
  const t = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isWorking) {
      setVisible(true);
    } else {
      const timer = setTimeout(() => setVisible(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [isWorking]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground",
        isWorking ? "bg-accent/30" : "bg-accent/15",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          isWorking
            ? "animate-pulse bg-muted-foreground motion-reduce:animate-none"
            : "bg-[hsl(var(--agent-kit-positive))]",
        )}
      />
      <span>
        {isWorking
          ? label || t("agentChat.codeAgent.working")
          : t("agentChat.codeAgent.applied")}
      </span>
    </div>
  );
}
