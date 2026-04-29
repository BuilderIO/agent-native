import { IconLoader2 } from "@tabler/icons-react";

export default function GeneratingOverlay() {
  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <IconLoader2 className="w-8 h-8 text-[#609FF8] animate-spin" />
        <p className="text-sm text-muted-foreground font-medium">
          Generating deck...
        </p>
      </div>
    </div>
  );
}
