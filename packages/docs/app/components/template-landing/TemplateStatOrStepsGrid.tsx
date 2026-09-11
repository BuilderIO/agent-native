import type { ComponentPropsWithoutRef } from "react";

type TemplateStatOrStepsGridProps = ComponentPropsWithoutRef<"div">;

type TemplateStatOrStepsGridItemProps = ComponentPropsWithoutRef<"div">;

export function TemplateStatOrStepsGrid({
  className = "",
  ...props
}: TemplateStatOrStepsGridProps) {
  return (
    <div
      className={`grid overflow-hidden border border-[var(--docs-border)] sm:grid-cols-3 ${className}`}
      {...props}
    />
  );
}

export function TemplateStatOrStepsGridItem({
  className = "",
  ...props
}: TemplateStatOrStepsGridItemProps) {
  return (
    <div
      className={`flex min-h-[220px] flex-col justify-center gap-3 border-t border-[var(--docs-border)] p-8 first:border-t-0 sm:min-h-[260px] sm:border-s sm:border-t-0 sm:first:border-s-0 sm:p-10 ${className}`}
      {...props}
    />
  );
}
