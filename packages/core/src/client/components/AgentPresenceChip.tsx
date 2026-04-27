export interface AgentPresenceChipProps {
  /** Whether the agent is actively editing this element. */
  active: boolean;
  /** Label text. Default: "AI editing" */
  label?: string;
  /** Color. Default: "#a78bfa" */
  color?: string;
  /** Additional CSS classes. */
  className?: string;
}

const pulseKeyframes = `
@keyframes _anChipPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
`;

let styleInjected = false;

function injectStyles() {
  if (styleInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.textContent = pulseKeyframes;
  document.head.appendChild(style);
  styleInjected = true;
}

export function AgentPresenceChip({
  active,
  label = "AI editing",
  color = "#a78bfa",
  className,
}: AgentPresenceChipProps) {
  if (!active) return null;

  injectStyles();

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 20,
        padding: "0 8px",
        borderRadius: 9999,
        backgroundColor: `${color}20`,
        color,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: color,
          animation: "_anChipPulse 2s infinite",
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
}
