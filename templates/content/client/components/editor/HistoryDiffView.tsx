import { useMemo } from "react";
import * as Diff from "diff";
import type { VersionContentResponse } from "@shared/api";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface HistoryDiffViewProps {
  currentVersion?: VersionContentResponse;
  previousVersion?: VersionContentResponse;
  isLoading: boolean;
}

export function HistoryDiffView({
  currentVersion,
  previousVersion,
  isLoading,
}: HistoryDiffViewProps) {
  const diffParts = useMemo(
    () =>
      Diff.diffWordsWithSpace(
        previousVersion?.content ?? "",
        currentVersion?.content ?? ""
      ),
    [previousVersion?.content, currentVersion?.content]
  );

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center px-4 py-6 text-sm text-muted-foreground sm:px-5">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading selected version
        </div>
      </div>
    );
  }

  if (!currentVersion) {
    return (
      <div className="flex flex-1 items-center px-4 py-6 text-sm text-muted-foreground sm:px-5">
        Select a version to view its diff.
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <ScrollArea className="h-full">
        <div className="px-4 py-4 sm:px-5 sm:py-5">
          <div className="whitespace-pre-wrap text-sm leading-7 text-foreground">
            {diffParts.map((part, index) => (
              <span
                key={`${index}-${part.value.length}`}
                className={cn(
                  part.added && "rounded-sm bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                  part.removed && "rounded-sm bg-rose-500/15 text-rose-700 line-through dark:text-rose-300"
                )}
              >
                {part.value}
              </span>
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
