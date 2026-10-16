export function hasBrowserEventTarget(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    typeof document.createElement === "function" &&
    typeof window.addEventListener === "function" &&
    typeof window.removeEventListener === "function"
  );
}
