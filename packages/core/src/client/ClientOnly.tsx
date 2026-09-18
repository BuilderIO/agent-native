import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";

const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Renders children only on the client (after hydration).
 *
 * Used in root.tsx to wrap all app content so the server only renders
 * the HTML shell (meta tags, styles, scripts) + a fallback spinner.
 * This prevents hydration mismatches from browser-only APIs like
 * window, localStorage, new Date(), next-themes, etc.
 */
export function ClientOnly({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  // The static shell and client tree must hand off before paint or the loader
  // flashes again while the authenticated app mounts.
  useBrowserLayoutEffect(() => setMounted(true), []);
  if (!mounted) return fallback ?? null;
  return children;
}
