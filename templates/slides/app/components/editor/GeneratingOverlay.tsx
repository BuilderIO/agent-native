import { Loader2 } from "lucide-react";

export default function GeneratingOverlay() {
  return (
    <div className="flex-1 flex items-center justify-center bg-[hsl(240,5%,5%)]">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 text-[#609FF8] animate-spin" />
        <p className="text-sm text-white/50 font-medium">Generating deck...</p>
      </div>
    </div>
  );
}
