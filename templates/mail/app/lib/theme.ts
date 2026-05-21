export type ResolvedTheme = "light" | "dark";

export function getResolvedTheme(fallback?: string): ResolvedTheme {
  if (fallback === "light" || fallback === "dark") return fallback;

  if (typeof document !== "undefined") {
    const root = document.documentElement;
    const domTheme = root.dataset.theme;
    if (domTheme === "light" || domTheme === "dark") return domTheme;
    if (root.classList.contains("dark")) return "dark";
    if (root.classList.contains("light")) return "light";
  }

  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }

  return "light";
}
