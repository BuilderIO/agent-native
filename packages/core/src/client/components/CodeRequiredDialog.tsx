import { useEffect, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import {
  IconPackageExport,
  IconCode,
  IconExternalLink,
  IconX,
  IconLoader2,
} from "@tabler/icons-react";

export interface CodeRequiredDialogProps {
  open: boolean;
  onClose: () => void;
  /** Label describing the feature that requires code changes */
  featureLabel?: string;
}

function useBuilderConnected() {
  const [connected, setConnected] = useState(false);
  const [connectUrl, setConnectUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch("/_agent-native/builder/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setConnected(!!data.configured);
          setConnectUrl(data.connectUrl || null);
        }
      })
      .catch(() => {});
  }, []);

  return { connected, connectUrl };
}

/**
 * Modal shown when a user tries to use a code-requiring feature in production.
 * Offers two paths: local development or Builder.io agent.
 * Uses inline styles (no Radix/Tailwind dependency).
 */
export function CodeRequiredDialog({
  open,
  onClose,
  featureLabel,
}: CodeRequiredDialogProps) {
  const { connected: builderConnected, connectUrl } = useBuilderConnected();
  const [submitting, setSubmitting] = useState(false);
  const [branchUrl, setBranchUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [open, handleKeyDown]);

  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setBranchUrl(null);
      setError(null);
    }
  }, [open]);

  const handleBuilderAgent = async () => {
    if (!builderConnected) {
      // Open settings tab
      window.dispatchEvent(new Event("agent-panel:open-settings"));
      onClose();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/_agent-native/builder/agents-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userMessage:
            featureLabel || "Make the requested code changes to this app",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Failed (${res.status})`);
      }
      const data = await res.json();
      setBranchUrl(data.url || null);
    } catch (err: any) {
      setError(err?.message || "Failed to create branch");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div style={s.backdrop} onClick={onClose}>
      <div
        style={s.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div style={s.header}>
          <div style={s.iconWrap}>
            <IconPackageExport size={20} />
          </div>
          <div>
            <h2 style={s.title}>Code changes required</h2>
            <p style={s.subtitle}>
              {featureLabel
                ? `"${featureLabel}" creates or modifies source code, which isn't available in deployed apps.`
                : "This action creates or modifies source code, which isn't available in deployed apps."}
            </p>
          </div>
        </div>

        {/* Options */}
        <div style={s.options}>
          <button
            style={s.optionCard}
            onMouseEnter={(e) =>
              Object.assign(e.currentTarget.style, s.optionCardHover)
            }
            onMouseLeave={(e) =>
              Object.assign(e.currentTarget.style, { borderColor: "#e5e7eb" })
            }
            onClick={() => {
              onClose();
            }}
          >
            <div style={s.optionIcon}>
              <IconCode size={24} />
            </div>
            <div style={s.optionText}>
              <span style={s.optionTitle}>Use local development</span>
              <span style={s.optionDesc}>
                Run the app locally with <code style={s.code}>pnpm dev</code> to
                enable full code modification by the AI agent.
              </span>
            </div>
          </button>

          <button
            style={{
              ...s.optionCard,
              ...(submitting
                ? { opacity: 0.7, pointerEvents: "none" as const }
                : {}),
            }}
            onMouseEnter={(e) =>
              Object.assign(e.currentTarget.style, s.optionCardHover)
            }
            onMouseLeave={(e) =>
              Object.assign(e.currentTarget.style, { borderColor: "#e5e7eb" })
            }
            onClick={handleBuilderAgent}
          >
            <div style={s.optionIcon}>
              {submitting ? (
                <IconLoader2
                  size={24}
                  style={{ animation: "spin 1s linear infinite" }}
                />
              ) : (
                <IconExternalLink size={24} />
              )}
            </div>
            <div style={s.optionText}>
              <span style={s.optionTitle}>
                {builderConnected
                  ? "Use Builder.io Agent"
                  : "Connect Builder.io"}
              </span>
              <span style={s.optionDesc}>
                {builderConnected
                  ? "Let our cloud agent make the changes for you. You'll get a link to preview and deploy."
                  : "Connect Builder to enable cloud-based code changes. Opens the Setup tab."}
              </span>
            </div>
            {!builderConnected && !connectUrl && (
              <span style={s.badge}>Setup required</span>
            )}
          </button>
        </div>

        {/* Branch result */}
        {branchUrl && (
          <div style={s.result}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              Branch created
            </span>
            <a
              href={branchUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={s.resultLink}
            >
              {branchUrl}
            </a>
          </div>
        )}

        {error && (
          <p style={{ color: "#ef4444", fontSize: 12, marginTop: 12 }}>
            {error}
          </p>
        )}

        {/* Close */}
        <button style={s.closeButton} onClick={onClose} aria-label="Close">
          <IconX size={16} />
        </button>
      </div>
    </div>,
    document.body,
  );
}

const s: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 99999,
    padding: "16px",
  },
  dialog: {
    position: "relative",
    background: "#fff",
    borderRadius: "12px",
    maxWidth: "460px",
    width: "100%",
    padding: "24px",
    boxShadow:
      "0 20px 25px -5px rgba(0,0,0,.1), 0 8px 10px -6px rgba(0,0,0,.1)",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: "#111827",
  },
  header: {
    display: "flex",
    gap: "14px",
    alignItems: "flex-start",
    marginBottom: "20px",
  },
  iconWrap: {
    flexShrink: 0,
    width: "40px",
    height: "40px",
    borderRadius: "10px",
    background: "#f3f4f6",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#6b7280",
  },
  title: {
    margin: 0,
    fontSize: "16px",
    fontWeight: 600,
    lineHeight: "1.4",
  },
  subtitle: {
    margin: "4px 0 0",
    fontSize: "13px",
    color: "#6b7280",
    lineHeight: "1.5",
  },
  options: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  optionCard: {
    position: "relative",
    display: "flex",
    alignItems: "flex-start",
    gap: "14px",
    padding: "14px",
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    background: "transparent",
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
    fontSize: "inherit",
    fontFamily: "inherit",
    color: "inherit",
  },
  optionCardHover: {
    borderColor: "#a5b4fc",
  },
  optionIcon: {
    flexShrink: 0,
    color: "#6366f1",
    marginTop: "2px",
  },
  optionText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  optionTitle: {
    fontSize: "14px",
    fontWeight: 600,
  },
  optionDesc: {
    fontSize: "12px",
    color: "#6b7280",
    lineHeight: "1.5",
  },
  code: {
    background: "#f3f4f6",
    padding: "1px 5px",
    borderRadius: "4px",
    fontSize: "11px",
    fontFamily: "monospace",
  },
  badge: {
    position: "absolute",
    top: "10px",
    right: "10px",
    fontSize: "10px",
    fontWeight: 600,
    color: "#6366f1",
    background: "#eef2ff",
    padding: "2px 8px",
    borderRadius: "99px",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  closeButton: {
    position: "absolute",
    top: "12px",
    right: "12px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: "6px",
    borderRadius: "6px",
    color: "#9ca3af",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  result: {
    marginTop: "16px",
    padding: "12px",
    borderRadius: "8px",
    border: "1px solid #22c55e40",
    background: "#f0fdf4",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  resultLink: {
    fontSize: "12px",
    color: "#6366f1",
    textDecoration: "none",
    wordBreak: "break-all",
  },
};
