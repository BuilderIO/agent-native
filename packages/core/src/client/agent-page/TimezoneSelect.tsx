import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { useMemo } from "react";

const SYSTEM_VALUE = "system";

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
  /**
   * Label for a leading `system` choice. Settings offer it so the preference
   * stays revertible; a schedule must name a concrete zone and omits it.
   */
  systemLabel?: string;
  id?: string;
}

export function TimezoneSelect({
  value,
  disabled,
  onChange,
  suggested = [],
  systemLabel,
  id,
}: TimezoneSelectProps) {
  const zones = useMemo(() => {
    const all = supportedTimezones();
    // A stored zone the runtime does not enumerate must still be selectable,
    // otherwise opening the dialog silently rewrites the schedule's zone.
    // `system` is a sentinel rather than a zone; leaving it here would render a
    // second item for the same value and duplicate the trigger's label.
    const extra = [...suggested, value].filter(
      (z) => z && z !== SYSTEM_VALUE && !all.includes(z),
    );
    return [...new Set([...extra, ...all])];
  }, [suggested, value]);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {systemLabel ? (
          <SelectItem value={SYSTEM_VALUE}>{systemLabel}</SelectItem>
        ) : null}
        {zones.map((tz) => (
          <SelectItem key={tz} value={tz}>
            {tz.replace(/_/g, " ")}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
