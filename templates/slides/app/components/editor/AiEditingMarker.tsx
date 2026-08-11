import { useT } from "@agent-native/core/client/i18n";
import { DEFAULT_AGENT_IDENTITY } from "@agent-native/toolkit/collab-ui";

import { cn } from "@/lib/utils";

/** The single compact marker used for every AI-editing state in Slides. */
export function AiEditingMarker({ className }: { className?: string }) {
  const t = useT();
  const label = t("raw.aiEditing");

  return (
    <span
      aria-label={label}
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold leading-none text-white",
        className,
      )}
      role="img"
      style={{ backgroundColor: DEFAULT_AGENT_IDENTITY.color }}
      title={label}
    >
      AI
    </span>
  );
}
