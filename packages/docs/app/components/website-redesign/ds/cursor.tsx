interface CursorProps {
  label?: string;
  color?: string;
}

export function Cursor({ label = "Guest", color = "var(--c-blue-400)" }: CursorProps) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M1 1L15 7L8 8.5L6.5 15L1 1Z" fill={color} />
      </svg>
      <span
        style={{
          fontFamily: "var(--b-font-mono)",
          fontSize: "var(--b-t-label-2)",
          color: "var(--b-action-primary-text)",
          background: color,
          borderRadius: "var(--b-radius-sm)",
          padding: "1px 6px",
        }}
      >
        {label}
      </span>
    </div>
  );
}
