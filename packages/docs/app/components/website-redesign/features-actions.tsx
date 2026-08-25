import { GridInner, PageSection } from "./page-grid";

export function FeaturesActions() {
  return (
    <PageSection style={{ borderTop: "1px solid var(--b-border-default)" }}>
      <GridInner
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--spacing-6)",
          padding: "var(--spacing-40) var(--spacing-8) var(--spacing-20)",
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
            fontSize: "var(--b-t-paragraph-2)",
            lineHeight: 1.4,
            color: "var(--b-text-secondary)",
          }}
        >
          Actions are the building blocks of an Agent Native app.
          <br />
          Define functionality once, then use it from your UI, agent chat, HTTP API, MCP, A2A, or
          CLI.
        </p>
      </GridInner>

      <GridInner
        style={{
          borderTop: "1px solid var(--b-border-default)",
          borderBottom: "1px solid var(--b-border-default)",
          background: "var(--b-bg-surface)",
        }}
      >
        <img
          src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6d0b04173f204f85a4f586b833478900"
          alt="One Action powers UI, MCP, Agent Chat, A2A, HTTP API, and CLI"
          crossOrigin="anonymous"
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            borderLeft: "1px solid var(--b-border-subtle)",
          }}
        />
      </GridInner>
    </PageSection>
  );
}
