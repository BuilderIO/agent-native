import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

export interface CodeRequiredDialogProps {
  open: boolean;
  onClose: () => void;
  /** Label describing the feature that requires code changes */
  featureLabel?: string;
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
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m16 18 2 2 4-4" />
              <path d="M21 12V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14" />
              <path d="m7.5 4.27 9 5.15" />
              <polyline points="3.29 7 12 12 20.71 7" />
              <line x1="12" y1="22" x2="12" y2="12" />
            </svg>
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
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
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
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 3h6v6" />
                <path d="M10 14 21 3" />
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              </svg>
            </div>
            <div style={s.optionText}>
              <span style={s.optionTitle}>Use Builder.io Agent</span>
              <span style={s.optionDesc}>
                Let our cloud agent make the changes for you. You'll get a link
                to preview and deploy.
              </span>
            </div>
            <span style={s.badge}>Coming soon</span>
          </button>
        </div>

        {/* Close */}
        <button style={s.closeButton} onClick={onClose} aria-label="Close">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
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
};
