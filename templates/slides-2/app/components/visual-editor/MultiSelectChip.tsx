import { useT } from "@agent-native/core/client/i18n";
import { IconX, IconArrowRight } from "@tabler/icons-react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";

interface MultiSelectChipProps {
  count: number;
  anchorRect: DOMRect | null;
  onClear: () => void;
  onSendToAgent: () => void;
}

export function MultiSelectChip({
  count,
  anchorRect,
  onClear,
  onSendToAgent,
}: MultiSelectChipProps) {
  const t = useT();
  if (count === 0) return null;

  const top = anchorRect ? anchorRect.top + 12 : 16;
  const left = anchorRect
    ? anchorRect.left + anchorRect.width / 2
    : window.innerWidth / 2;

  return createPortal(
    <div
      data-multi-select-chip
      style={{
        position: "fixed",
        top,
        left,
        transform: "translateX(-50%)",
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 6px 4px 12px",
        background: "hsl(var(--popover) / 0.95)",
        color: "hsl(var(--popover-foreground))",
        border: "1px solid hsl(var(--border) / 0.12)",
        borderRadius: 999,
        boxShadow: "0 4px 16px hsl(var(--slides-thumbnail-shadow) / 0.4)",
        fontSize: 13,
        fontWeight: 500,
        userSelect: "none",
        pointerEvents: "auto",
      }}
    >
      <span style={{ color: "hsl(var(--slides-accent))" }}>{count}</span>
      <span style={{ color: "hsl(var(--popover-foreground) / 0.85)" }}>
        {t("raw.selected")}
      </span>
      <Button
        type="button"
        variant="default"
        onClick={onSendToAgent}
        className="ml-1 h-auto gap-1 rounded-full bg-[hsl(var(--slides-accent))] px-2.5 py-1 text-xs font-semibold text-[hsl(var(--slides-accent-foreground))] hover:bg-[hsl(var(--slides-accent-hover))] hover:text-[hsl(var(--slides-accent-foreground))] active:scale-100 [&_svg]:size-3"
      >
        {t("raw.sendToAgent")}
        <IconArrowRight size={12} stroke={3} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onClear}
        aria-label={t("raw.clearSelection")}
        className="size-[22px] rounded-full p-0 text-muted-foreground/70 hover:bg-transparent hover:text-foreground active:scale-100 [&_svg]:size-3.5"
      >
        <IconX size={14} stroke={2.5} />
      </Button>
    </div>,
    document.body,
  );
}
