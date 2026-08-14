export function SectionDivider({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`hidden border-x border-[var(--docs-border)] lg:grid lg:h-[120px] lg:grid-cols-3 ${className}`}
    >
      <div />
      <div className="border-x border-[var(--docs-border)]" />
      <div />
    </div>
  );
}
