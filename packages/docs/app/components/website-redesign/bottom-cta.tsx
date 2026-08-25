import { Button } from "./ds/button";
import { InstallCommand } from "./install-command";
import { GridInner, PageSection } from "./page-grid";

export function BottomCta() {
  return (
    <PageSection>
      <GridInner
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--spacing-12)",
          padding: "var(--spacing-40) var(--spacing-10)",
          borderTop: "1px solid var(--b-border-default)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--spacing-6)",
            maxWidth: 875,
            width: "100%",
          }}
        >
          <h2
            style={{
              margin: 0,
              maxWidth: 300,
              textAlign: "center",
              fontFamily: "var(--b-font-sans)",
              fontSize: "var(--b-t-heading-1)",
              fontWeight: 500,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              color: "var(--b-text-primary)",
            }}
          >
            Build your first Agent-Native app
          </h2>
          <p
            style={{
              margin: 0,
              textAlign: "center",
              fontFamily: "var(--b-font-sans)",
              fontSize: "var(--b-t-paragraph-1)",
              lineHeight: 1.3,
              color: "var(--b-text-secondary)",
            }}
          >
            Create one application for users and AI agents. Bring your own LLM
            and deploy anywhere.
          </p>
        </div>

        <Button variant="cta" icon={null} href="/apps">
          GET STARTED
        </Button>

        <InstallCommand />
      </GridInner>
    </PageSection>
  );
}
