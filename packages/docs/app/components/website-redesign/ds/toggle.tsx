interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        width: 36,
        height: 20,
        borderRadius: "var(--b-radius-full)",
        border: "none",
        padding: 2,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        background: checked ? "var(--b-action-primary-bg)" : "var(--b-bg-prominent)",
        cursor: "pointer",
        transition: "background 0.15s",
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: "var(--b-radius-full)",
          background: checked ? "var(--b-action-primary-text)" : "var(--b-text-secondary)",
          display: "block",
          transition: "transform 0.15s",
        }}
      />
    </button>
  );
}
