export function SectionDivider({
  borderColorClassName = "border-[var(--docs-border)]",
  className = "",
}: {
  borderColorClassName?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`hidden border-x lg:grid lg:h-[120px] lg:grid-cols-3 ${borderColorClassName} ${className}`}
    >
      <div />
      <div className={`border-x ${borderColorClassName}`} />
      <div />
    </div>
  );
}
