import { Info } from "lucide-react";
import { CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  title: string;
  description: string;
}

export function ChartTitleWithInfo({ title, description }: Props) {
  return (
    <div className="flex items-center gap-1.5">
      <CardTitle className="text-base">{title}</CardTitle>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[280px] text-xs">
            {description}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
