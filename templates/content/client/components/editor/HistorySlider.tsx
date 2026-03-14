import type { VersionHistoryItem } from "@shared/api";
import { Slider } from "@/components/ui/slider";

interface HistorySliderProps {
  versions: VersionHistoryItem[];
  selectedVersionId: string | null;
  onSelectVersion: (versionId: string) => void;
  isLoading?: boolean;
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function HistorySlider({
  versions,
  selectedVersionId,
  onSelectVersion,
  isLoading = false,
}: HistorySliderProps) {
  const selectedIndex = Math.max(
    versions.findIndex((version) => version.id === selectedVersionId),
    0,
  );

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Loading saved history...</p>
    );
  }

  if (versions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No saved history yet. Make an edit and wait for autosave to create the
        first snapshot.
      </p>
    );
  }

  return (
    <div className="px-1">
      <div className="px-2 py-3">
        <Slider
          min={0}
          max={Math.max(versions.length - 1, 0)}
          step={1}
          value={[selectedIndex]}
          onValueChange={(value) => {
            const nextVersion = versions[value[0] ?? 0];
            if (nextVersion) onSelectVersion(nextVersion.id);
          }}
          disabled={versions.length <= 1}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{dateTimeFormatter.format(new Date(versions[0].timestamp))}</span>
        <span>
          {dateTimeFormatter.format(
            new Date(versions[versions.length - 1].timestamp),
          )}
        </span>
      </div>
    </div>
  );
}
