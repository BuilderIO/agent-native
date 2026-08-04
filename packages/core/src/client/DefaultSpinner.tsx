/**
 * Full-screen loading spinner rendered during SSR and initial hydration.
 * Uses inline SVG + styles because Tailwind may not be loaded yet on the server.
 * Respects the user's OS color scheme so dark-mode users don't get a white flash.
 *
 * The stall hint is revealed by a pure-CSS `animation-delay`, never a timer:
 * the states that strand a user here (hydration never runs, the route module
 * 404s, a cold dev-server compile) are exactly the states where no JS of ours
 * executes, so a `setTimeout` fallback would never fire. A featureless spinner
 * is indistinguishable from a blank screen, and reads as "the app is broken"
 * rather than "look at the terminal" — that mis-read is what this text buys.
 */

/**
 * Production wording wins whenever the build mode is unreadable: core is often
 * consumed as prebuilt dist, where the Vite env is absent. A hosted visitor has
 * no dev-server terminal, so pointing them at one is worse than saying less.
 */
function stallHint(): string {
  const env = import.meta.env as Record<string, unknown> | undefined;
  const isDev = env?.DEV === true || env?.MODE === "development";
  if (isDev) {
    return "Still loading. A first run compiles dependencies and can take a minute — if it does not finish, check the terminal running the dev server for errors.";
  }
  return "Still loading. This is taking longer than usual — try reloading the page, and let us know if it keeps happening.";
}

export function DefaultSpinner() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        height: "100vh",
        width: "100%",
      }}
    >
      <svg
        role="status"
        aria-label="Loading"
        width={24}
        height={24}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ animation: "an-spin 1s linear infinite", opacity: 0.7 }}
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      <p className="an-stall-hint">{stallHint()}</p>
      <style>{`
        @keyframes an-spin { to { transform: rotate(360deg) } }
        @keyframes an-stall-in { to { opacity: 0.6 } }
        .an-stall-hint {
          opacity: 0;
          margin: 0;
          max-width: 32rem;
          padding: 0 1.5rem;
          text-align: center;
          font-size: 0.875rem;
          line-height: 1.5;
          font-family: ui-sans-serif, system-ui, sans-serif;
          animation: an-stall-in 0.4s ease-out 10s forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          .an-stall-hint { animation-duration: 0s }
        }
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
