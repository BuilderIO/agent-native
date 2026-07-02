import {
  IconPackageExport,
  IconCode,
  IconExternalLink,
  IconX,
  IconLoader2,
} from "@tabler/icons-react";
import { useEffect, useCallback, useState } from "react";
import { createPortal } from "react-dom";

import { trackEvent } from "../analytics.js";
import { agentNativePath } from "../api-path.js";
import { useT } from "../i18n.js";
import { withBuilderConnectTrackingParams } from "../settings/useBuilderStatus.js";

const DESKTOP_DOWNLOAD_URL = "https://www.agent-native.com/download";

export interface CodeRequiredDialogProps {
  open: boolean;
  onClose: () => void;
  /** Label describing the feature that requires code changes */
  featureLabel?: string;
}

function useBuilderConnected() {
  const [connected, setConnected] = useState(false);
  const [cloudAgentsAvailable, setCloudAgentsAvailable] = useState(false);
  const [connectUrl, setConnectUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch(agentNativePath("/_agent-native/builder/status"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setConnected(!!data.configured);
          setCloudAgentsAvailable(!!data.builderEnabled);
          setConnectUrl(data.cliAuthUrl || data.connectUrl || null);
        }
      })
      .catch(() => {});
  }, []);

  return { connected, cloudAgentsAvailable, connectUrl };
}

/**
 * Modal shown when a user tries to use a code-requiring feature where local
 * source access is unavailable. Offers two paths: Agent Native Desktop or the
 * Builder.io agent.
 * Uses inline styles (no Radix/Tailwind dependency).
 */
export function CodeRequiredDialog({
  open,
  onClose,
  featureLabel,
}: CodeRequiredDialogProps) {
  const t = useT();
  const {
    connected: builderConnected,
    cloudAgentsAvailable,
    connectUrl,
  } = useBuilderConnected();
  const [submitting, setSubmitting] = useState(false);
  const [branchUrl, setBranchUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const builderHref = withBuilderConnectTrackingParams(
    connectUrl || agentNativePath("/_agent-native/builder/connect"),
    { source: "code_required_dialog", flow: "background_agent" },
  );

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
      const res = await fetch(
        agentNativePath("/_agent-native/builder/agents-run"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userMessage: featureLabel || t("codeRequired.defaultFeature"),
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Failed (${res.status})`);
      }
      const data = await res.json();
      setBranchUrl(data.url || null);
    } catch (err: any) {
      setError(err?.message || t("codeRequired.branchError"));
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
            <h2 style={s.title}>{t("codeRequired.title")}</h2>
            <p style={s.subtitle}>
              {featureLabel
                ? t("codeRequired.subtitleWithFeature", {
                    feature: featureLabel,
                  })
                : t("codeRequired.subtitle")}
            </p>
          </div>
        </div>

        {/* Options */}
        <div style={s.options}>
          <a
            href={DESKTOP_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
            style={{ ...s.optionCard, ...s.optionLink }}
            onMouseEnter={(e) =>
              Object.assign(e.currentTarget.style, s.optionCardHover)
            }
            onMouseLeave={(e) =>
              Object.assign(e.currentTarget.style, {
                borderColor: "hsl(var(--border))",
              })
            }
          >
            <div style={s.optionIcon}>
              <IconCode size={24} />
            </div>
            <div style={s.optionText}>
              <span style={s.optionTitle}>
                {t("codeRequired.desktopTitle")}
              </span>
              <span style={s.optionDesc}>
                {t("codeRequired.desktopDescription")}
              </span>
            </div>
          </a>

          {builderConnected && cloudAgentsAvailable ? (
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
                Object.assign(e.currentTarget.style, {
                  borderColor: "hsl(var(--border))",
                })
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
                  {t("codeRequired.builderAgentTitle")}
                </span>
                <span style={s.optionDesc}>
                  {t("codeRequired.builderAgentDescription")}
                </span>
              </div>
            </button>
          ) : builderConnected ? (
            <div
              style={{
                ...s.optionCard,
                cursor: "default",
                opacity: 0.85,
              }}
            >
              <div style={s.optionIcon}>
                <IconExternalLink size={24} />
              </div>
              <div style={s.optionText}>
                <span style={s.optionTitle}>
                  {t("codeRequired.codeChangeTitle")}
                </span>
                <span style={s.optionDesc}>
                  {t("codeRequired.fallbackDetail")}
                </span>
              </div>
              <span style={s.badge}>{t("codeRequired.codeChangeBadge")}</span>
            </div>
          ) : (
            <a
              href={builderHref}
              target="_blank"
              rel="noreferrer"
              onClick={() => {
                trackEvent("builder connect clicked", {
                  feature: "builder",
                  stage: "client",
                  source: "code_required_dialog",
                  flow: "background_agent",
                  connect_url_kind: connectUrl ? "provided" : "default",
                });
              }}
              style={{ ...s.optionCard, ...s.optionLink }}
              onMouseEnter={(e) =>
                Object.assign(e.currentTarget.style, s.optionCardHover)
              }
              onMouseLeave={(e) =>
                Object.assign(e.currentTarget.style, {
                  borderColor: "hsl(var(--border))",
                })
              }
            >
              <div style={s.optionIcon}>
                <IconExternalLink size={24} />
              </div>
              <div style={s.optionText}>
                <span style={s.optionTitle}>
                  {t("codeRequired.connectBuilderTitle")}
                </span>
                <span style={s.optionDesc}>
                  {t("codeRequired.connectBuilderDescription")}
                </span>
              </div>
              {!connectUrl && (
                <span style={s.badge}>{t("codeRequired.setupRequired")}</span>
              )}
            </a>
          )}
        </div>

        {/* Branch result */}
        {branchUrl && (
          <div style={s.result}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {t("codeRequired.branchCreated")}
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
          <p
            style={{
              color: "hsl(var(--destructive))",
              fontSize: 12,
              marginTop: 12,
            }}
          >
            {error}
          </p>
        )}

        {/* Close */}
        <button
          style={s.closeButton}
          onClick={onClose}
          aria-label={t("codeRequired.close")}
        >
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
    background: "hsl(var(--popover))",
    borderRadius: "12px",
    border: "1px solid hsl(var(--border))",
    maxWidth: "460px",
    width: "100%",
    padding: "24px",
    boxShadow:
      "0 20px 25px -5px rgba(0,0,0,.1), 0 8px 10px -6px rgba(0,0,0,.1)",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: "hsl(var(--popover-foreground))",
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
    background: "hsl(var(--muted))",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "hsl(var(--muted-foreground))",
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
    color: "hsl(var(--muted-foreground))",
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
    border: "1px solid hsl(var(--border))",
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
    borderColor: "hsl(var(--ring))",
  },
  optionLink: {
    textDecoration: "none",
    boxSizing: "border-box",
  },
  optionIcon: {
    flexShrink: 0,
    color: "#00B5FF",
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
    color: "hsl(var(--muted-foreground))",
    lineHeight: "1.5",
  },
  badge: {
    position: "absolute",
    top: "10px",
    right: "10px",
    fontSize: "10px",
    fontWeight: 600,
    color: "#00B5FF",
    background: "hsl(var(--primary) / 0.08)",
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
    color: "hsl(var(--muted-foreground))",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  result: {
    marginTop: "16px",
    padding: "12px",
    borderRadius: "8px",
    border: "1px solid #22c55e40",
    background: "rgba(34,197,94,0.08)",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  resultLink: {
    fontSize: "12px",
    color: "#00B5FF",
    textDecoration: "none",
    wordBreak: "break-all",
  },
};
