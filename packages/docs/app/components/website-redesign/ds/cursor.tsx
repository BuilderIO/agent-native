interface CursorProps {
  label?: string;
  color?: string;
}

export function Cursor({
  label = "Guest",
  color = "var(--c-blue-400)",
}: CursorProps) {
  return (
    <div className="inline-flex items-center gap-1">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M1 1L15 7L8 8.5L6.5 15L1 1Z" fill={color} />
      </svg>
      <span
        className="rounded-[var(--b-radius-sm)] px-[6px] py-px font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] text-[var(--b-action-primary-text)]"
        style={{ background: color }}
      >
        {label}
      </span>
    </div>
  );
}
