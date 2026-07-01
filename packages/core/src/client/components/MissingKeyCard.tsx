export interface MissingKeyCardProps {
  label: string;
  message: string;
  settingsPath: string;
}

export function MissingKeyCard({
  label,
  message,
  settingsPath,
}: MissingKeyCardProps) {
  return (
    <div
      style={{
        border: "1px solid hsl(var(--border))",
        borderRadius: 8,
        padding: "24px 28px",
        maxWidth: 420,
        margin: "32px auto",
        background: "hsl(var(--card))",
        color: "hsl(var(--card-foreground))",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "hsl(var(--card-foreground))",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <p
        style={{
          fontSize: 13,
          color: "hsl(var(--muted-foreground))",
          margin: "0 0 16px",
        }}
      >
        {message}
      </p>
      <a
        href={settingsPath}
        style={{
          display: "inline-block",
          padding: "8px 16px",
          fontSize: 13,
          fontWeight: 500,
          color: "hsl(var(--primary-foreground))",
          background: "hsl(var(--primary))",
          borderRadius: 6,
          textDecoration: "none",
        }}
      >
        Go to Settings
      </a>
    </div>
  );
}
