export const PRIORITY_CONFIG: Record<
  string,
  { icon: string; color: string; label: string; order: number }
> = {
  Highest: {
    icon: "ChevronUp",
    color: "text-red-500",
    label: "Highest",
    order: 0,
  },
  High: {
    icon: "ChevronUp",
    color: "text-orange-500",
    label: "High",
    order: 1,
  },
  Medium: {
    icon: "Equal",
    color: "text-yellow-500",
    label: "Medium",
    order: 2,
  },
  Low: {
    icon: "ChevronDown",
    color: "text-blue-500",
    label: "Low",
    order: 3,
  },
  Lowest: {
    icon: "ChevronDown",
    color: "text-gray-400",
    label: "Lowest",
    order: 4,
  },
};

export function getPriorityConfig(name?: string) {
  if (!name) return PRIORITY_CONFIG.Medium;
  return PRIORITY_CONFIG[name] ?? PRIORITY_CONFIG.Medium;
}

export function getPriorityOrder(name?: string): number {
  return getPriorityConfig(name).order;
}
