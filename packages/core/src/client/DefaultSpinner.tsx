import { Spinner } from "@agent-native/toolkit/ui/spinner";

/**
 * Full-screen loading spinner rendered during SSR and initial hydration.
 * Uses inline layout because Tailwind may not be loaded yet on the server.
 * Respects the user's OS color scheme so dark-mode users don't get a white flash.
 */

export function DefaultSpinner({
  ariaLabel = "Loading",
}: {
  ariaLabel?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Spinner aria-label={ariaLabel} className="size-6" />
        <span
          style={{
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            fontSize: 16,
            fontWeight: 500,
            opacity: 0.65,
          }}
        >
          Churning
        </span>
      </div>
      <style>{`
        html {
          background: hsl(var(--background, 0 0% 100%));
          color: hsl(var(--foreground, 240 10% 3.9%));
        }
        @media (prefers-color-scheme: dark) {
          html {
            background: hsl(var(--background, 240 10% 3.9%));
            color: hsl(var(--foreground, 0 0% 98%));
          }
        }
      `}</style>
    </div>
  );
}
