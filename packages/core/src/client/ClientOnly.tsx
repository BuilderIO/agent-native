import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";

const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function ClientOnly({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useBrowserLayoutEffect(() => setMounted(true), []);
  if (!mounted) return fallback ?? null;
  return children;
}
