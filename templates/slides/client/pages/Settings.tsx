import { Link } from "react-router-dom";
import { ApiKeySettings } from "@agent-native/core/client";

export default function Settings() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "hsl(240,6%,4%)",
        color: "rgba(255,255,255,0.9)",
      }}
    >
      <header
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          padding: "0 24px",
          height: 56,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Link
          to="/"
          style={{
            fontSize: 13,
            opacity: 0.5,
            textDecoration: "none",
            color: "inherit",
          }}
        >
          &larr; Back
        </Link>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Settings</span>
      </header>
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 24px" }}>
        <ApiKeySettings />
      </main>
    </div>
  );
}
