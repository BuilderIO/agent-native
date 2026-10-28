import { IconLock, IconUsersGroup, IconWorld } from "@tabler/icons-react";

export type VisibilityBadgeValue = "private" | "org" | "public";

/** Translated by the app; the pure badge ships no copy of its own. */
export type VisibilityBadgeLabels = Record<VisibilityBadgeValue, string>;

/**
 * Legacy English copy for standalone consumers that pass no labels. Apps with
 * a Core catalog should use the localized badge in `toolkit/app/sharing`.
 */
export const DEFAULT_ENGLISH_VISIBILITY_BADGE_LABELS: VisibilityBadgeLabels = {
  private: "Private",
  org: "Org",
  public: "Public",
};

export interface VisibilityBadgeProps {
  visibility: VisibilityBadgeValue | null | undefined;
  /** Translated copy; omitted labels fall back to the English defaults. */
  labels?: Partial<VisibilityBadgeLabels>;
  size?: number;
  className?: string;
}

export function VisibilityBadge({
  visibility,
  labels: labelOverrides,
  size = 12,
  className,
}: VisibilityBadgeProps) {
  const v = visibility ?? "private";
  const label =
    labelOverrides?.[v] ?? DEFAULT_ENGLISH_VISIBILITY_BADGE_LABELS[v];
  const Icon =
    v === "public" ? IconWorld : v === "org" ? IconUsersGroup : IconLock;
  return (
    <span
      className={className}
      data-visibility={v}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: size,
        color: "hsl(var(--muted-foreground))",
      }}
    >
      <Icon size={size + 2} aria-hidden="true" />
      {label}
    </span>
  );
}
