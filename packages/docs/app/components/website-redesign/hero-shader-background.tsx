// Sits behind the page-grid's column-divider lines inside a hero-style
// `PageSection` (which is `position: relative`, so `zIndex: -1` here stays
// scoped to that section instead of dropping behind the whole page). This is
// a flat fill for now; a future animated/WebGL shader replaces just this
// component without touching the grid lines or content above it.
export function HeroShaderBackground() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: -1,
        background: "var(--b-bg-page)",
      }}
    />
  );
}
