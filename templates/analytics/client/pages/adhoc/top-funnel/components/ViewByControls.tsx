import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DateCadence, ViewByOption } from "../types";
import { DATE_CADENCE_OPTIONS, VIEW_BY_OPTIONS } from "../types";

interface ViewByControlsProps {
  cadence: DateCadence;
  onCadenceChange: (cadence: DateCadence) => void;
  viewBy: ViewByOption;
  onViewByChange: (viewBy: ViewByOption) => void;
  viewByOptions?: ViewByOption[];
}

export function ViewByControls({
  cadence,
  onCadenceChange,
  viewBy,
  onViewByChange,
  viewByOptions = VIEW_BY_OPTIONS,
}: ViewByControlsProps) {
  return (
    <div className="flex items-end gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground font-medium">
          Date Cadence
        </label>
        <Select value={cadence} onValueChange={(v) => onCadenceChange(v as DateCadence)}>
          <SelectTrigger className="h-8 w-[120px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_CADENCE_OPTIONS.map((opt) => (
              <SelectItem key={opt} value={opt} className="text-xs">
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground font-medium">
          View By
        </label>
        <Select value={viewBy} onValueChange={(v) => onViewByChange(v as ViewByOption)}>
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {viewByOptions.map((opt) => (
              <SelectItem key={opt} value={opt} className="text-xs">
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
