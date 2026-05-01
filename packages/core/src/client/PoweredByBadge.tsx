import type { CSSProperties } from "react";
import { appPath } from "./api-path.js";

export interface PoweredByBadgeProps {
  position?: "bottom-right" | "bottom-left";
}

const containerStyle = (
  position: "bottom-right" | "bottom-left",
): CSSProperties => ({
  position: "fixed",
  bottom: 16,
  ...(position === "bottom-right" ? { right: 16 } : { left: 16 }),
  zIndex: 50,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  borderRadius: 8,
  fontSize: 12,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontWeight: 500,
  lineHeight: 1,
  color: "rgba(95, 95, 95, 0.95)",
  background: "rgba(0, 0, 0, 0.05)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  border: "1px solid rgba(0, 0, 0, 0.06)",
  textDecoration: "none",
  transition: "opacity 0.2s, color 0.2s",
  opacity: 0.82,
});

const darkQuery = "(prefers-color-scheme: dark)";

/**
 * Small branding badge: "Built with [Agent Native logo]"
 *
 * - Fixed position in the corner
 * - Subtle, semi-transparent
 * - Links to https://agent-native.com
 * - Respects prefers-color-scheme
 * - Can be hidden via HIDE_BRANDING=true env var (for white-label)
 */
export function PoweredByBadge({
  position = "bottom-right",
}: PoweredByBadgeProps) {
  // Allow hiding via env var
  const hidden =
    (import.meta.env as Record<string, string | undefined>)
      ?.VITE_HIDE_BRANDING === "true";

  if (hidden) return null;

  const logoOnLight = appPath("/agent-native-logo-light.svg");
  const logoOnDark = appPath("/agent-native-logo-dark.svg");

  return (
    <>
      <style>{`
        .an-powered-logo {
          display: block;
          height: 14px;
          width: auto;
          flex: none;
        }
        .an-powered-logo-dark {
          display: none;
        }
        .dark .an-powered-badge {
          background: rgba(255, 255, 255, 0.06) !important;
          border-color: rgba(255, 255, 255, 0.08) !important;
          color: rgba(215, 215, 215, 0.94) !important;
        }
        .dark .an-powered-logo-light {
          display: none;
        }
        .dark .an-powered-logo-dark {
          display: block;
        }
        @media ${darkQuery} {
          .an-powered-badge {
            background: rgba(255, 255, 255, 0.06) !important;
            border-color: rgba(255, 255, 255, 0.08) !important;
            color: rgba(215, 215, 215, 0.94) !important;
          }
          .an-powered-logo-light {
            display: none;
          }
          .an-powered-logo-dark {
            display: block;
          }
        }
        .light .an-powered-badge {
          background: rgba(0, 0, 0, 0.05) !important;
          border-color: rgba(0, 0, 0, 0.06) !important;
          color: rgba(95, 95, 95, 0.95) !important;
        }
        .light .an-powered-logo-light {
          display: block;
        }
        .light .an-powered-logo-dark {
          display: none;
        }
        .an-powered-badge:hover {
          opacity: 1 !important;
          color: rgba(70, 70, 70, 1) !important;
        }
        @media ${darkQuery} {
          .an-powered-badge:hover {
            color: rgba(238, 238, 238, 1) !important;
          }
        }
        .dark .an-powered-badge:hover {
          color: rgba(238, 238, 238, 1) !important;
        }
        .light .an-powered-badge:hover {
          color: rgba(70, 70, 70, 1) !important;
        }
      `}</style>
      <a
        href="https://agent-native.com"
        target="_blank"
        rel="noopener noreferrer"
        className="an-powered-badge"
        style={containerStyle(position)}
        aria-label="Built with Agent Native"
      >
        <span>Built with</span>
        <img
          src={logoOnLight}
          alt="Agent Native"
          className="an-powered-logo an-powered-logo-light"
        />
        <img
          src={logoOnDark}
          alt="Agent Native"
          className="an-powered-logo an-powered-logo-dark"
        />
      </a>
    </>
  );
}
