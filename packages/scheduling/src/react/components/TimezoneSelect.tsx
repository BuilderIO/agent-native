/**
 * TimezoneSelect — unstyled primitive. A native <select> with the full IANA
 * list. Consumer should swap the outer element for shadcn Select.
 */
import React from "react";

export interface TimezoneSelectProps {
  value: string;
  onChange: (tz: string) => void;
  className?: string;
}

// A compact list; consumers can replace with the full 600+ IANA zones from
// `Intl.supportedValuesOf("timeZone")` at the call site if they need all of them.
const COMMON_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Africa/Cairo",
  "Asia/Jerusalem",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export function TimezoneSelect(props: TimezoneSelectProps) {
  const supported =
    typeof Intl !== "undefined" && (Intl as any).supportedValuesOf
      ? (Intl as any).supportedValuesOf("timeZone")
      : COMMON_ZONES;
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.currentTarget.value)}
      className={props.className ?? ""}
    >
      {supported.map((tz: string) => (
        <option key={tz} value={tz}>
          {tz}
        </option>
      ))}
    </select>
  );
}
