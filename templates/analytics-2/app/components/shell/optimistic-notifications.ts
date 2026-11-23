import type { WorkspaceShellNotification } from "./types";

export type OptimisticRead = "all" | readonly string[];

export function applyOptimisticRead(
  data: { items: WorkspaceShellNotification[]; unreadCount: number },
  optimistic: OptimisticRead,
): { items: WorkspaceShellNotification[]; unreadCount: number } {
  if (optimistic !== "all" && optimistic.length === 0) return data;
  const items = data.items.map((item) =>
    optimistic === "all" || optimistic.includes(item.id)
      ? { ...item, read: true }
      : item,
  );
  if (optimistic === "all") return { items, unreadCount: 0 };
  const newlyRead = data.items.filter(
    (item, index) => !item.read && items[index]!.read,
  ).length;
  return { items, unreadCount: Math.max(0, data.unreadCount - newlyRead) };
}
