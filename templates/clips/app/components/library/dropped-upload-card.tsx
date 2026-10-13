import { useT } from "@agent-native/core/client/i18n";
import { IconLoader2 } from "@tabler/icons-react";

import type { DropUploadItem } from "@/hooks/use-drop-video-upload";

export function DroppedUploadCard({ item }: { item: DropUploadItem }) {
  const t = useT();
  const percent = Math.round(item.progress * 100);
  return (
    <div
      className="flex flex-col overflow-hidden rounded-lg border bg-card"
      aria-busy="true"
    >
      <div className="relative flex aspect-video items-center justify-center bg-muted">
        <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <div className="absolute top-2 end-2 rounded-full bg-foreground/80 px-2 py-0.5 text-[10px] font-medium text-background uppercase tracking-wide">
          {t("recordRoute.savingRecording")}
        </div>
        <div className="absolute inset-x-0 bottom-0 h-1 bg-background/40">
          <div
            className="h-full bg-primary transition-[width] duration-200 ease-out"
            style={{ width: `${Math.min(100, Math.max(4, percent))}%` }}
          />
        </div>
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-medium text-foreground">
          {item.fileName}
        </p>
        <p className="text-xs text-muted-foreground">{percent}%</p>
      </div>
    </div>
  );
}
