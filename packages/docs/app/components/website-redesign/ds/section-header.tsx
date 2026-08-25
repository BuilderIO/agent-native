import type { ElementType, ReactNode } from "react";

import { Eyebrow } from "./eyebrow";

interface SectionHeaderProps {
  eyebrow?: ReactNode;
  heading: ReactNode;
  subheading?: ReactNode;
  as?: ElementType;
  align?: "left" | "center";
}

export function SectionHeader({
  eyebrow,
  heading,
  subheading,
  as: Tag = "h2",
  align = "left",
}: SectionHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-3)",
        textAlign: align,
        alignItems: align === "center" ? "center" : "flex-start",
      }}
    >
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <Tag
        style={{
          margin: 0,
          fontSize: "var(--b-t-heading-2)",
          fontWeight: 500,
          lineHeight: 1.1,
          letterSpacing: "-0.02em",
          color: "var(--b-text-primary)",
          fontFamily: "var(--b-font-sans)",
        }}
      >
        {heading}
      </Tag>
      {subheading && (
        <p
          style={{
            margin: 0,
            fontSize: "var(--b-t-paragraph-2)",
            color: "var(--b-text-secondary)",
            lineHeight: 1.4,
            fontFamily: "var(--b-font-sans)",
          }}
        >
          {subheading}
        </p>
      )}
    </div>
  );
}
