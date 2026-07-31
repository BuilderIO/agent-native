import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { useMemo } from "react";

/** The browser's IANA zone, or UTC when the runtime cannot report one. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function supportedTimezones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  const zones = supported ? supported("timeZone") : [];
  // Older runtimes omit supportedValuesOf; the browser zone plus UTC still
  // covers the common case rather than leaving an empty, unusable menu.
  const base = zones.length ? zones : [browserTimezone()];
  return [...new Set(["UTC", ...base])].sort();
}

export interface TimezoneSelectProps {
  value: string;
  disabled?: boolean;
  onChange: (timezone: string) => void;
  /** Zones to surface above the full list, e.g. the currently stored one. */
  suggested?: string[];
  id?: string;
}

export function TimezoneSelect({
  value,
  disabled,
  onChange,
  suggested = [],
  id,
}: TimezoneSelectProps) {
  const zones = useMemo(() => {
    const all = supportedTimezones();
    // A stored zone the runtime does not enumerate must still be selectable,
    // otherwise opening the dialog silently rewrites the schedule's zone.
    const extra = [...suggested, value].filter((z) => z && !all.includes(z));
    return [...new Set([...extra, ...all])];
  }, [suggested, value]);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {zones.map((tz) => (
          <SelectItem key={tz} value={tz}>
            {tz.replace(/_/g, " ")}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
