/** Settings keys for the call apps that can start meeting notes. They match
 * the meeting platforms the desktop watcher and calendar reminders use. */
export type CallAppKey =
  | "slack"
  | "phone"
  | "whatsapp"
  | "meet"
  | "zoom"
  | "teams"
  | "webex"
  | "other";

export const CALL_APP_CHOICES: ReadonlyArray<{
  key: CallAppKey;
  label: string;
  description?: string;
}> = [
  { key: "slack", label: "Slack huddles" },
  {
    key: "phone",
    label: "Phone calls",
    description: "iPhone calls answered on this Mac, and FaceTime",
  },
  { key: "whatsapp", label: "WhatsApp calls" },
  { key: "meet", label: "Google Meet" },
  { key: "zoom", label: "Zoom" },
  { key: "teams", label: "Microsoft Teams" },
  { key: "webex", label: "Webex" },
  {
    key: "other",
    label: "Other calendar meetings",
    description: "Calendar events without a known call app",
  },
];

/** Returns the new disabled list after turning one call app on or off. */
export function toggleDisabledCallApp(
  disabled: readonly string[] | undefined,
  key: CallAppKey,
  enabled: boolean,
): string[] {
  const rest = (disabled ?? []).filter((item) => item !== key);
  return enabled ? rest : [...rest, key];
}
