/**
 * Full-screen loading spinner rendered during SSR and initial hydration.
 * Uses inline styles because Tailwind may not be loaded yet on the server.
 * Respects the user's OS color scheme so dark-mode users don't get a white flash.
 */
export function DefaultSpinner() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        width: "100%",
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          border: "2px solid transparent",
          borderBottomColor: "currentColor",
          borderRadius: "50%",
          animation: "an-spin 0.8s linear infinite",
        }}
      />
      <style>{`
        @keyframes an-spin { to { transform: rotate(360deg) } }
        @media (prefers-color-scheme: dark) {
          html { background: #09090b; color: #fafafa }
        }
      `}</style>
    </div>
  );
}
