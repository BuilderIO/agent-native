import type { ComponentPropsWithoutRef, ReactNode } from "react";

type TemplateCapabilityGridProps = ComponentPropsWithoutRef<"section"> & {
  intro: ReactNode;
};

export function TemplateCapabilityGrid({
  children,
  className = "",
  intro,
  ...props
}: TemplateCapabilityGridProps) {
  return (
    <section
      className={`border-t border-[var(--docs-border)] ${className}`}
      {...props}
    >
      <div className="flex flex-col border-y border-[var(--docs-border)] lg:flex-row lg:items-stretch">
        <div className="flex shrink-0 flex-col gap-6 border-b border-[var(--docs-border)] bg-[var(--bg)] p-6 sm:p-8 lg:w-1/3 lg:border-b-0 lg:border-e lg:pe-16">
          {intro}
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-1 border-t border-[var(--docs-border)] sm:grid-cols-2 lg:border-t-0">
          {children}
        </div>
      </div>
    </section>
  );
}
