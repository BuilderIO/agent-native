import type { ReactNode } from "react";

interface FeatureCardProps {
  icon?: ReactNode;
  title: string;
  description: string;
}

export function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-3)",
        padding: "var(--spacing-6)",
        border: "1px solid var(--b-border-default)",
        borderRadius: "var(--b-radius)",
        background: "var(--b-bg-raised)",
      }}
    >
      {icon}
      <h3
        style={{
          margin: 0,
          fontSize: "var(--b-t-heading-6)",
          fontWeight: 500,
          color: "var(--b-text-primary)",
          fontFamily: "var(--b-font-sans)",
        }}
      >
        {title}
      </h3>
      <p
        style={{
          margin: 0,
          fontSize: "var(--b-t-paragraph-2)",
          color: "var(--b-text-secondary)",
          lineHeight: 1.4,
          fontFamily: "var(--b-font-sans)",
        }}
      >
        {description}
      </p>
    </div>
  );
}
