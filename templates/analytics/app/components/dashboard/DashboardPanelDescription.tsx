import { isExtensionApiPath } from "@agent-native/toolkit/app/extensions";
import { InlineMarkdown } from "@agent-native/toolkit/app/review";
import type { ReactNode } from "react";

const BLOCKED_API_PATH_PREFIXES = [
  "/_agent-native/auth",
  "/_agent-native/actions",
];

function isBlockedApiPath(pathname: string): boolean {
  let candidate = normalizePathSeparators(pathname);
  for (let decodePass = 0; decodePass < 3; decodePass += 1) {
    if (matchesBlockedApiPathPrefix(candidate)) return true;
    const decoded = candidate
      .split("/")
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .join("/");
    const normalized = normalizePathSeparators(decoded);
    if (normalized === candidate) return false;
    candidate = normalized;
  }
  return matchesBlockedApiPathPrefix(candidate);
}

function normalizePathSeparators(pathname: string): string {
  return pathname.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function matchesBlockedApiPathPrefix(pathname: string): boolean {
  return BLOCKED_API_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function safeDashboardLinkHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (!href) return null;
  if (href.startsWith("//")) return null;

  const relativeBase = new URL("https://agent-native.local");
  const isRelative = href.startsWith("/");
  const base = isRelative ? relativeBase : undefined;
  if (!URL.canParse(href, base)) return null;

  const parsed = new URL(href, base);
  if (isRelative && parsed.origin !== relativeBase.origin) return null;
  const sameOrigin =
    isRelative ||
    (typeof window !== "undefined" && parsed.origin === window.location.origin);
  if (
    sameOrigin &&
    (isExtensionApiPath(parsed.pathname) || isBlockedApiPath(parsed.pathname))
  ) {
    return null;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:"
    ? href
    : null;
}

export function renderDashboardMarkdownLink(
  href: string,
  children: ReactNode,
  className: string,
): ReactNode {
  const safeHref = safeDashboardLinkHref(href);
  if (!safeHref) return children;
  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}

export function DashboardPanelDescription({
  description,
  className,
}: {
  description: unknown;
  className: string;
}) {
  if (typeof description !== "string" || !description) return null;
  return (
    <InlineMarkdown
      inline
      content={description}
      className={className}
      linkClassName="text-current underline underline-offset-2 hover:opacity-80"
      renderLink={renderDashboardMarkdownLink}
    />
  );
}
