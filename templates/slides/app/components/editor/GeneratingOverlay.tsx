import { useT } from "@agent-native/core/client";
import { IconLoader2 } from "@tabler/icons-react";

export default function GeneratingOverlay() {
  const t = useT();
  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="flex max-w-sm flex-col items-center gap-4 px-6 text-center">
        <IconLoader2 className="w-8 h-8 text-[#609FF8] animate-spin" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {t("raw.firstSlidesTitle")}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("raw.firstSlidesDescription")}
          </p>
        </div>
      </div>
    </div>
  );
}
