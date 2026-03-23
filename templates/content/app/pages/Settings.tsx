import { useState } from "react";
import { Link } from "react-router";
import { ApiKeySettings } from "@agent-native/core/client";
import { useDbStatus } from "@/hooks/use-db-status";
import { CloudUpgrade } from "@/components/CloudUpgrade";

export default function Settings() {
  const { isLocal } = useDbStatus();
  const [showCloudUpgrade, setShowCloudUpgrade] = useState(false);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--background, #0a0a0a)",
        color: "var(--foreground, #fafafa)",
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

        {isLocal && (
          <div style={{ marginTop: 32 }}>
            <div
              style={{
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12,
                padding: "20px 24px",
              }}
            >
              <h3
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  marginBottom: 6,
                }}
              >
                Sync to Cloud
              </h3>
              <p
                style={{
                  fontSize: 13,
                  opacity: 0.5,
                  marginBottom: 16,
                }}
              >
                Connect a cloud database to enable publishing and sharing
                content publicly.
              </p>
              <button
                onClick={() => setShowCloudUpgrade(true)}
                style={{
                  background: "rgb(37 99 235)",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Connect Database
              </button>
            </div>
          </div>
        )}
      </main>

      {showCloudUpgrade && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(4px)",
          }}
        >
          <CloudUpgrade
            title="Sync to Cloud"
            description="Connect a cloud database to enable publishing and sharing content publicly."
            onClose={() => setShowCloudUpgrade(false)}
          />
        </div>
      )}
    </div>
  );
}
