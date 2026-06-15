export type CaptureSource = "full-screen" | "window";

function MonitorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="4"
        width="18"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M8 21h8M12 17v4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SourceRow({
  value,
  onChange,
}: {
  value: CaptureSource;
  onChange: (v: CaptureSource) => void;
}) {
  const labels: Record<CaptureSource, string> = {
    "full-screen": "Full screen",
    window: "Window",
  };
  return (
    <label className="row">
      <span className="row-icon">
        <MonitorIcon />
      </span>
      <select
        className="row-select"
        value={value}
        onChange={(e) => onChange(e.target.value as CaptureSource)}
      >
        {Object.entries(labels).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
