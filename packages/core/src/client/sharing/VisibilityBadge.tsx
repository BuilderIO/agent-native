import { IconLock, IconBuilding, IconWorld } from "@tabler/icons-react";

export interface VisibilityBadgeProps {
  visibility: "private" | "org" | "public" | null | undefined;
  size?: number;
  className?: string;
}

/**
 * Tiny visibility chip for list views. Renders a small icon + label so users
 * can spot shared/public resources at a glance.
 */
export function VisibilityBadge({
  visibility,
  size = 12,
  className,
}: VisibilityBadgeProps) {
  const v = visibility ?? "private";
  const Icon =
    v === "public" ? IconWorld : v === "org" ? IconBuilding : IconLock;
  const label = v === "public" ? "Public" : v === "org" ? "Org" : "Private";
  const color =
    v === "public" ? "#2563eb" : v === "org" ? "#7c3aed" : "#6b7280";
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: size,
        color,
      }}
    >
      <Icon size={size + 2} />
      {label}
    </span>
  );
}
