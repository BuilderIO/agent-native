import { GridInner, PageSection } from "./page-grid";

const GRID_CELLS = Array.from({ length: 9 });

export function FeaturesActions() {
  return (
    <PageSection>
      <GridInner
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--spacing-6)",
          padding: "var(--spacing-40) var(--spacing-8) var(--spacing-20)",
          borderTop: "1px solid var(--b-border-default)",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--b-font-sans)",
            fontSize: "var(--b-t-heading-2)",
            fontWeight: 500,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            color: "var(--b-text-primary)",
          }}
        >
          One Action powers every surface
        </h2>
        <p
          style={{
            margin: 0,
            maxWidth: 633,
            fontFamily: "var(--b-font-sans)",
            fontSize: "var(--b-t-paragraph-1)",
            lineHeight: 1.4,
            color: "var(--b-text-secondary)",
          }}
        >
          Actions are the building blocks of an Agent Native app.
          <br />
          Define functionality once, then use it from your UI, agent chat, HTTP
          API, MCP, A2A, or CLI.
        </p>
      </GridInner>

      <GridInner
        style={{
          position: "relative",
          borderTop: "1px solid var(--b-border-default)",
          background: "var(--b-bg-surface)",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gridTemplateRows: "repeat(3, 1fr)",
          }}
        >
          {GRID_CELLS.map((_, i) => (
            <div
              key={i}
              style={{
                borderRight:
                  i % 3 !== 2 ? "1px solid var(--b-border-subtle)" : undefined,
                borderBottom:
                  i < 6 ? "1px solid var(--b-border-subtle)" : undefined,
              }}
            />
          ))}
        </div>

        <img
          className="theme-img-dark"
          src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fe77f7df4d30242f19b5a06734894d77c"
          alt="One Action powers UI, MCP, Agent Chat, A2A, HTTP API, and CLI"
          crossOrigin="anonymous"
          loading="lazy"
          decoding="async"
          style={{
            position: "relative",
            width: "100%",
            height: "auto",
            borderLeft: "1px solid var(--b-border-subtle)",
            borderRight: "1px solid var(--b-border-subtle)",
          }}
        />
        <img
          className="theme-img-light"
          src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F2ee8d6c41d884ac08d486ba49634af1d"
          alt="One Action powers UI, MCP, Agent Chat, A2A, HTTP API, and CLI"
          crossOrigin="anonymous"
          loading="lazy"
          decoding="async"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            borderLeft: "1px solid var(--b-border-subtle)",
            borderRight: "1px solid var(--b-border-subtle)",
          }}
        />
      </GridInner>
    </PageSection>
  );
}
