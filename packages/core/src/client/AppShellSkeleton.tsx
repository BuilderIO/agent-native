import type { CSSProperties } from "react";

const BLOCK_STYLE: CSSProperties = {
  display: "block",
  backgroundColor: "hsl(var(--muted, 240 5% 96.1%))",
  borderRadius: 6,
  opacity: 0.7,
};

function Block({ style }: { style?: CSSProperties }) {
  return <span aria-hidden style={{ ...BLOCK_STYLE, ...style }} />;
}

export function AppShellSkeleton({
  ariaLabel = "Loading application",
  height = "var(--agent-native-viewport-height, 100vh)",
}: {
  ariaLabel?: string;
  height?: CSSProperties["height"];
}) {
  return (
    <div
      role="status"
      aria-label={ariaLabel}
      data-agent-native-app-skeleton="true"
      style={{
        display: "flex",
        height,
        width: "100%",
        overflow: "hidden",
        backgroundColor: "hsl(var(--background, 0 0% 100%))",
        color: "hsl(var(--foreground, 240 10% 3.9%))",
      }}
    >
      <style>{`
        [data-agent-native-app-skeleton] [aria-hidden="true"] {
          animation: an-app-shell-skeleton-pulse 1.2s ease-in-out infinite;
        }
        @keyframes an-app-shell-skeleton-pulse {
          0%, 100% { opacity: 0.45; }
          50% { opacity: 0.85; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-agent-native-app-skeleton] [aria-hidden="true"] { animation: none; }
        }
        @media (max-width: 767px) {
          [data-agent-native-app-skeleton] [data-agent-native-app-skeleton-sidebar] { display: none; }
        }
      `}</style>
      <aside
        data-agent-native-app-skeleton-sidebar="true"
        aria-hidden="true"
        style={{
          display: "flex",
          width: 248,
          flexShrink: 0,
          flexDirection: "column",
          gap: 16,
          borderRight: "1px solid hsl(var(--border, 240 5.9% 90%))",
          padding: 16,
        }}
      >
        <Block style={{ width: 132, height: 32 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <Block
              key={item}
              style={{ width: `${68 + (item % 3) * 14}%`, height: 14 }}
            />
          ))}
        </div>
      </aside>
      <main
        style={{
          display: "flex",
          minWidth: 0,
          flex: 1,
          flexDirection: "column",
        }}
      >
        <header
          aria-hidden="true"
          style={{
            display: "flex",
            height: 48,
            flexShrink: 0,
            alignItems: "center",
            gap: 12,
            borderBottom: "1px solid hsl(var(--border, 240 5.9% 90%))",
            padding: "0 16px",
          }}
        >
          <Block style={{ width: 32, height: 32, borderRadius: 8 }} />
          <Block style={{ width: 128, height: 14 }} />
        </header>
        <section
          aria-hidden="true"
          style={{
            display: "flex",
            width: "100%",
            maxWidth: 960,
            flex: 1,
            flexDirection: "column",
            gap: 12,
            margin: "0 auto",
            padding: 24,
          }}
        >
          <Block style={{ width: "38%", height: 28, marginBottom: 8 }} />
          <Block style={{ width: "24%", height: 14, marginBottom: 16 }} />
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div
              key={item}
              style={{ display: "flex", alignItems: "center", gap: 12 }}
            >
              <Block style={{ width: 32, height: 32, borderRadius: 8 }} />
              <div
                style={{
                  display: "flex",
                  flex: 1,
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <Block
                  style={{ width: `${52 + (item % 3) * 12}%`, height: 12 }}
                />
                <Block
                  style={{ width: `${34 + (item % 4) * 10}%`, height: 10 }}
                />
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
