export function ColumnDivider() {
  return (
    <div
      aria-hidden
      style={{
        width: 1,
        alignSelf: "stretch",
        background: "var(--b-border-subtle)",
        flexShrink: 0,
      }}
    />
  );
}
