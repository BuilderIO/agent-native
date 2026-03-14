import React from "react";

export interface MissingKeyCardProps {
  label: string;
  message: string;
  settingsPath: string;
}

export function MissingKeyCard({ label, message, settingsPath }: MissingKeyCardProps) {
  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: "24px 28px",
        maxWidth: 420,
        margin: "32px auto",
        background: "#f8fafc",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "#334155",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 16px" }}>
        {message}
      </p>
      <a
        href={settingsPath}
        style={{
          display: "inline-block",
          padding: "8px 16px",
          fontSize: 13,
          fontWeight: 500,
          color: "#fff",
          background: "#3b82f6",
          borderRadius: 6,
          textDecoration: "none",
        }}
      >
        Go to Settings
      </a>
    </div>
  );
}
