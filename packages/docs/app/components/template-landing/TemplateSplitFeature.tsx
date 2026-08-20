import type { ComponentPropsWithoutRef, ReactNode } from "react";

type TemplateSplitFeatureProps = ComponentPropsWithoutRef<"section"> & {
  leading: ReactNode;
  trailing: ReactNode;
};

export function TemplateSplitFeature({
  className = "",
  leading,
  trailing,
  ...props
}: TemplateSplitFeatureProps) {
  return (
    <section
      className={`border border-[var(--docs-border)] ${className}`}
      {...props}
    >
      <div className="grid lg:grid-cols-2">
        <div className="min-w-0 border-b border-[var(--docs-border)] lg:border-b-0 lg:border-e">
          {leading}
        </div>
        <div className="min-w-0 bg-[var(--bg-secondary)]">{trailing}</div>
      </div>
    </section>
  );
}
