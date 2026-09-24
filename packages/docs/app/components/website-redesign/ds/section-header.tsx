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
      className={[
        "flex flex-col gap-[var(--spacing-3)]",
        align === "center"
          ? "items-center text-center"
          : "items-start text-left",
      ].join(" ")}
    >
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <Tag className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.1] tracking-[-0.02em] text-[var(--b-text-primary)]">
        {heading}
      </Tag>
      {subheading && (
        <p className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] leading-[1.4] text-[var(--b-text-secondary)]">
          {subheading}
        </p>
      )}
    </div>
  );
}
