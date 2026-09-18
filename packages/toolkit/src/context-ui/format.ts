import type { ContextSegmentViewData } from "./types.js";

export function formatContextTokens(tokens: number | undefined): string {
  const value = Math.max(0, Math.round(tokens ?? 0));
  if (value >= 1000) {
    const compact = value / 1000;
    return `${compact >= 100 ? compact.toFixed(0) : compact.toFixed(1)}k`;
  }
  return String(value);
}

export function contextStatusLabel(segment: ContextSegmentViewData): string {
  if (segment.protected) return "Protected";
  if (segment.status === "pinned") return "Pinned";
  if (segment.status === "evicted") return "Evicted";
  if (segment.status === "summarized") return "Summarized";
  return "Active";
}

export function contextGroupColor(group: string): string {
  if (group === "Pinned") return "bg-emerald-500";
  if (group === "Tool results") return "bg-amber-500";
  if (group === "Files read") return "bg-sky-500";
  if (group === "Thinking") return "bg-violet-500";
  if (group === "Task & instructions") return "bg-rose-500";
  if (group === "System · required") return "bg-slate-700";
  if (group === "System · inherited") return "bg-indigo-500";
  if (group === "System · user") return "bg-teal-500";
  return "bg-slate-400";
}

export function contextGroupFill(group: string): string {
  if (group === "Pinned") return "#10b981";
  if (group === "Tool results") return "#f59e0b";
  if (group === "Files read") return "#0ea5e9";
  if (group === "Thinking") return "#8b5cf6";
  if (group === "Task & instructions") return "#f43f5e";
  if (group === "System · required") return "#334155";
  if (group === "System · inherited") return "#6366f1";
  if (group === "System · user") return "#14b8a6";
  return "#94a3b8";
}
