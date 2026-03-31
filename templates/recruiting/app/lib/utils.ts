export { cn } from "@agent-native/core";
import {
  formatDistanceToNow,
  format,
  isToday,
  isYesterday,
  isThisYear,
  isThisWeek,
  isTomorrow,
} from "date-fns";

export function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return "Yesterday";
  if (isThisYear(date)) return format(date, "MMM d");
  return format(date, "MMM d, yyyy");
}

export function formatDateFull(dateStr: string): string {
  return format(new Date(dateStr), "EEE, MMM d, yyyy 'at' h:mm a");
}

export function formatDateShort(dateStr: string): string {
  return format(new Date(dateStr), "MMM d, yyyy");
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function getAvatarColor(name: string): string {
  const colors = [
    "bg-blue-500",
    "bg-purple-500",
    "bg-green-500",
    "bg-orange-500",
    "bg-pink-500",
    "bg-teal-500",
    "bg-indigo-500",
    "bg-rose-500",
    "bg-amber-500",
    "bg-cyan-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "…";
}

export function isMac(): boolean {
  return navigator.platform.toUpperCase().indexOf("MAC") >= 0;
}

export function formatShortcut(key: string): string {
  const mod = isMac() ? "⌘" : "Ctrl";
  return key
    .replace("cmd", mod)
    .replace("ctrl", "Ctrl")
    .replace("alt", isMac() ? "⌥" : "Alt");
}

export function titleCase(str: string): string {
  return str
    .split(" ")
    .map((word) =>
      word.length > 0
        ? word[0].toUpperCase() + word.slice(1).toLowerCase()
        : word,
    )
    .join(" ");
}

export function daysAgo(dateStr: string): number {
  const date = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

export function groupByDate(
  items: { date: string }[],
): { label: string; items: any[] }[] {
  const groups: Record<string, any[]> = {};
  const order: string[] = [];

  for (const item of items) {
    const d = new Date(item.date);
    let label: string;
    if (isToday(d)) label = "Today";
    else if (isTomorrow(d)) label = "Tomorrow";
    else if (isThisWeek(d)) label = format(d, "EEEE");
    else label = format(d, "MMM d, yyyy");

    if (!groups[label]) {
      groups[label] = [];
      order.push(label);
    }
    groups[label].push(item);
  }

  return order.map((label) => ({ label, items: groups[label] }));
}
