import type { VersionHistoryItem } from "@shared/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Bot, History, User, X } from "lucide-react";

interface HistoryTimelineProps {
  versions: VersionHistoryItem[];
  selectedVersionId: string | null;
  onSelectVersion: (versionId: string) => void;
  onClose?: () => void;
  isLoading?: boolean;
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function HistoryTimeline({
  versions,
  selectedVersionId,
  onSelectVersion,
  onClose,
  isLoading = false,
}: HistoryTimelineProps) {
  const selectedIndex = Math.max(
    versions.findIndex((version) => version.id === selectedVersionId),
    0
  );
  const selectedVersion = versions[selectedIndex] ?? null;

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-foreground">
            <History className="h-4 w-4" />
            <span className="font-medium">Article history</span>
          </div>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="mt-3">Loading saved history…</p>
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-foreground">
            <History className="h-4 w-4" />
            <span className="font-medium">Article history</span>
          </div>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="mt-3">No saved history yet. Make an edit and wait for autosave to create the first snapshot.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-foreground">
            <History className="h-4 w-4" />
            <h3 className="text-sm font-semibold">Article history</h3>
            <Badge variant="secondary">{versions.length} changes</Badge>
          </div>
          {selectedVersion && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="gap-1 border-border/60">
                {selectedVersion.actorType === "user" ? (
                  <User className="h-3 w-3" />
                ) : (
                  <Bot className="h-3 w-3" />
                )}
                {selectedVersion.actorDisplayName ||
                  (selectedVersion.actorType === "user" ? "Builder User" : "Agent")}
              </Badge>
              <span>{dateTimeFormatter.format(new Date(selectedVersion.timestamp))}</span>
              <span>
                +{selectedVersion.wordsAdded} / -{selectedVersion.wordsRemoved}
              </span>
            </div>
          )}
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {versions
          .slice()
          .reverse()
          .slice(0, 6)
          .map((version) => {
            const isSelected = version.id === selectedVersionId;
            return (
              <button
                key={version.id}
                type="button"
                onClick={() => onSelectVersion(version.id)}
                className={cn(
                  "rounded-lg border px-3 py-3 text-left transition-colors",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                )}
              >
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {version.actorDisplayName ||
                      (version.actorType === "user" ? "Builder User" : "Agent")}
                  </span>
                  <span>
                    +{version.wordsAdded} / -{version.wordsRemoved}
                  </span>
                </div>
                <p className="mt-2 text-sm text-foreground">
                  {dateTimeFormatter.format(new Date(version.timestamp))}
                </p>
              </button>
            );
          })}
      </div>
    </div>
  );
}
