import type { DispatchAutomationItem } from "./automations.js";

export type AutomationStatusTone =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "muted";

export function automationIdentity(
  item: Pick<DispatchAutomationItem, "owner" | "path">,
): string {
  return `${item.owner}:${item.path}`;
}

export function automationTarget(item: DispatchAutomationItem): string {
  if (item.triggerType === "event" && item.event) return item.event;
  if (item.scheduleDescription) return item.scheduleDescription;
  if (item.schedule) return item.schedule;
  return item.triggerType || "schedule";
}

export function relativeRunTime(value: string | null | undefined): string {
  if (!value) return "never";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "never";
  const diff = timestamp - Date.now();
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "from now" : "ago";
  if (abs < 60_000) return diff >= 0 ? "soon" : "now";
  if (abs < 3_600_000) return `${Math.floor(abs / 60_000)}m ${suffix}`;
  if (abs < 86_400_000) return `${Math.floor(abs / 3_600_000)}h ${suffix}`;
  return `${Math.floor(abs / 86_400_000)}d ${suffix}`;
}

export function automationLastRun(item: DispatchAutomationItem): string {
  return item.lastRun ? relativeRunTime(item.lastRun) : "never";
}

export function automationNextRun(item: DispatchAutomationItem): string {
  if (!item.enabled) return "paused";
  if (item.triggerType === "event") return "on event";
  return item.nextRun ? relativeRunTime(item.nextRun) : "not scheduled";
}

export function automationStatus(item: DispatchAutomationItem): {
  label: string;
  tone: AutomationStatusTone;
} {
  if (!item.enabled) return { label: "Paused", tone: "muted" };
  if (item.lastStatus === "error") return { label: "Error", tone: "danger" };
  if (item.lastStatus === "running")
    return { label: "Running", tone: "warning" };
  if (item.lastStatus === "skipped")
    return { label: "Skipped", tone: "warning" };
  if (item.lastStatus === "success")
    return { label: "Healthy", tone: "success" };
  return { label: "Ready", tone: "default" };
}

export function sortAutomations(
  automations: DispatchAutomationItem[],
): DispatchAutomationItem[] {
  return [...automations].sort((a, b) => {
    const aError = a.enabled && a.lastStatus === "error" ? 1 : 0;
    const bError = b.enabled && b.lastStatus === "error" ? 1 : 0;
    if (aError !== bError) return bError - aError;
    return (b.lastRun || "").localeCompare(a.lastRun || "");
  });
}
