import { signOut } from "@agent-native/core/client/hooks";
import { Link } from "react-router";

/**
 * The copy the app's own 404 boundary renders (app/root.tsx ERROR_COPY). Kept
 * here so a route that resolves to no page can say the same thing in place
 * instead of leaving an empty frame; the settings spec asserts these values.
 */
export const NOT_FOUND_COPY = {
  title: "Page not found",
  details: "This page doesn't exist. It may have been moved or deleted.",
  goHome: "Go home",
} as const;

/**
 * Shown inside the settings frame when a `/settings/<slug>` URL names no page.
 * An unadvertised URL must not render an empty main: the reader gets the app's
 * own not-found copy, a way home, and the rail stays usable. This is not a
 * stand-in screen for an unbuilt surface; nothing is claimed about the page.
 */
export function SettingsRouteFallback({ view }: { view: string }) {
  return (
    <div
      className="settings-route-fallback"
      role="status"
      data-settings-unknown-view={view}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 480,
        margin: "auto",
        padding: 24,
        fontFamily: "inherit",
        fontSize: 14,
        lineHeight: "20px",
      }}
    >
      <strong style={{ fontSize: 16 }}>{NOT_FOUND_COPY.title}</strong>
      <span style={{ opacity: 0.75 }}>{NOT_FOUND_COPY.details}</span>
      <span style={{ opacity: 0.75 }}>The specified view was not found.</span>
      <Link to="/home" style={{ width: "fit-content" }}>
        {NOT_FOUND_COPY.goHome}
      </Link>
      <button
        type="button"
        onClick={() => void signOut()}
        style={{ width: "fit-content", textDecoration: "underline" }}
      >
        Switch account
      </button>
    </div>
  );
}
