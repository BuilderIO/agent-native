import type { ReactNode } from "react";

export function HomeSection({
  title,
  variation,
  fullHeight = false,
  layout = "default",
  className,
  children,
}: {
  title: string;
  variation: "A" | "B";
  fullHeight?: boolean;
  layout?: "default" | "recents";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`ws-home-section ws-home-section--${variation.toLowerCase()}${
        fullHeight ? " is-full-height" : ""
      }${layout === "recents" ? " is-recents" : ""}${
        className ? ` ${className}` : ""
      }`}
    >
      <h2 className="ws-home-section-title">
        <span className="ws-home-section-title-text">{title}</span>
      </h2>
      <div className="ws-home-section-inner">{children}</div>
    </section>
  );
}
