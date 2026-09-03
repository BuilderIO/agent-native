import { useState, useEffect, type ReactNode } from "react";

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
  useEffect(() => setMounted(true), []);
  if (!mounted) return fallback ?? null;
  return children;
}
