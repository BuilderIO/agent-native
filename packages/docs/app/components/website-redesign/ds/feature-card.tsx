import type { ReactNode } from "react";

interface FeatureCardProps {
  icon?: ReactNode;
  title: string;
  description?: string;
}

export function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <div className="flex flex-col gap-[var(--spacing-3)] rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-raised)] p-[var(--spacing-6)]">
      {icon}
      <h3 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-6)] font-medium text-[var(--b-text-primary)]">
        {title}
      </h3>
      {description && (
        <p className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] leading-[1.4] text-[var(--b-text-secondary)]">
          {description}
        </p>
      )}
    </div>
  );
}
