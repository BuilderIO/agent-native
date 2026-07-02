import { IconBrandGithub } from "@tabler/icons-react";
import type { CSSProperties } from "react";

import { appPath } from "./api-path.js";
import { cn } from "./utils.js";

export interface PoweredByBadgeProps {
  position?: "bottom-right" | "bottom-left";
  /** Plain shows the logo only with no surrounding badge chrome. */
  variant?: "badge" | "plain";
  /** When true, positioning is handled by the parent container. */
  embedded?: boolean;
}

export interface OpenSourceBadgeProps {
  position?: "bottom-left" | "bottom-right";
  /** When true, positioning is handled by the parent container. */
  embedded?: boolean;
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
  variant = "badge",
  embedded = false,
}: PoweredByBadgeProps) {
  // Allow hiding via env var
  const hidden =
    (import.meta.env as Record<string, string | undefined>)
      ?.VITE_HIDE_BRANDING === "true";

  if (hidden) return null;

  const logoOnLight = appPath("/agent-native-logo-light.svg");
  const logoOnDark = appPath("/agent-native-logo-dark.svg");
  const isPlain = variant === "plain";

  return (
    <>
      <style>{`
        .an-powered-logo {
          display: block;
          height: ${isPlain ? "16.2px" : "14px"};
          width: auto;
          flex: none;
        }
        .an-powered-logo-dark {
          display: none;
        }
        @media (max-width: 640px) {
          .an-powered-badge:not(.an-powered-badge-embedded) {
            position: static !important;
            margin: 0.75rem auto 0 !important;
            width: max-content;
            max-width: calc(100vw - 2rem);
          }
        }
        .an-powered-badge-plain {
          background: transparent !important;
          border-color: transparent !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          padding: 0 !important;
          opacity: 1 !important;
        }
        .an-powered-badge-plain:hover {
          opacity: 0.82 !important;
        }
        .dark .an-powered-badge:not(.an-powered-badge-plain) {
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
          .an-powered-badge:not(.an-powered-badge-plain) {
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
        .light .an-powered-badge:not(.an-powered-badge-plain) {
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
        .an-powered-badge:not(.an-powered-badge-plain):hover {
          opacity: 1 !important;
          color: rgba(70, 70, 70, 1) !important;
        }
        @media ${darkQuery} {
          .an-powered-badge:not(.an-powered-badge-plain):hover {
            color: rgba(238, 238, 238, 1) !important;
          }
        }
        .dark .an-powered-badge:not(.an-powered-badge-plain):hover {
          color: rgba(238, 238, 238, 1) !important;
        }
        .light .an-powered-badge:not(.an-powered-badge-plain):hover {
          color: rgba(70, 70, 70, 1) !important;
        }
      `}</style>
      <a
        href="https://agent-native.com"
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "an-powered-badge",
          isPlain && "an-powered-badge-plain",
          embedded && "an-powered-badge-embedded",
        )}
        style={
          embedded
            ? {
                display: "inline-flex",
                alignItems: "center",
                textDecoration: "none",
                transition: "opacity 0.2s",
              }
            : containerStyle(position)
        }
        aria-label="Built with Agent Native"
      >
        {!isPlain && <span>Built with</span>}
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

/**
 * Small GitHub badge: "Free and open source"
 *
 * Intended to pair with PoweredByBadge on public pages.
 */
export function OpenSourceBadge({
  position = "bottom-left",
  embedded = false,
}: OpenSourceBadgeProps) {
  const hidden =
    (import.meta.env as Record<string, string | undefined>)
      ?.VITE_HIDE_BRANDING === "true";

  if (hidden) return null;

  return (
    <>
      <style>{`
        .an-open-source-badge svg {
          width: 15px;
          height: 15px;
          flex: none;
        }
        .an-open-source-badge {
          background: transparent !important;
          border-color: transparent !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          color: #00B5FF !important;
          font-weight: 600 !important;
          opacity: 0.95 !important;
        }
        @media (max-width: 640px) {
          .an-open-source-badge:not(.an-open-source-badge-embedded) {
            position: static !important;
            margin: 1rem auto 0 !important;
            width: max-content;
            max-width: calc(100vw - 2rem);
          }
        }
        .dark .an-open-source-badge {
          color: #00B5FF !important;
        }
        @media ${darkQuery} {
          .an-open-source-badge {
            color: #00B5FF !important;
          }
        }
        .light .an-open-source-badge {
          color: #00B5FF !important;
        }
        .an-open-source-badge:hover {
          opacity: 1 !important;
          color: #33C4FF !important;
        }
        @media ${darkQuery} {
          .an-open-source-badge:hover {
            color: #33C4FF !important;
          }
        }
        .dark .an-open-source-badge:hover {
          color: #33C4FF !important;
        }
        .light .an-open-source-badge:hover {
          color: #33C4FF !important;
        }
      `}</style>
      <a
        href="https://github.com/BuilderIO/agent-native"
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "an-open-source-badge",
          embedded && "an-open-source-badge-embedded",
        )}
        style={
          embedded
            ? {
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontFamily:
                  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                fontWeight: 600,
                lineHeight: 1,
                textDecoration: "none",
                transition: "opacity 0.2s, color 0.2s",
              }
            : containerStyle(position)
        }
      >
        <IconBrandGithub aria-hidden="true" stroke={1.8} />
        <span>Free and open source</span>
      </a>
    </>
  );
}
