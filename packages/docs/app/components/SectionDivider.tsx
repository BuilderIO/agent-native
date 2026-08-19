type SectionDividerProps = {
  className?: string;
  showOnSmallScreens?: boolean;
};

export function SectionDivider({
  className = "",
  showOnSmallScreens = false,
}: SectionDividerProps) {
  const responsiveSizeClassName = showOnSmallScreens
    ? "grid h-12 sm:h-20 lg:h-[120px]"
    : "hidden lg:grid lg:h-[120px]";

  return (
    <div
      aria-hidden="true"
      className={`${responsiveSizeClassName} grid-cols-3 border-x border-[var(--docs-border)] ${className}`}
    >
      <div />
      <div className="translate-x-0.5 border-x border-[var(--docs-border)]" />
      <div />
    </div>
  );
}
