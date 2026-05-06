import { IconLoader2 } from "@tabler/icons-react";

export default function GeneratingOverlay() {
  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="flex max-w-sm flex-col items-center gap-4 px-6 text-center">
        <IconLoader2 className="w-8 h-8 text-[#609FF8] animate-spin" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            Preparing the first slides
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The deck will start filling in here as soon as each slide lands.
          </p>
        </div>
      </div>
    </div>
  );
}
