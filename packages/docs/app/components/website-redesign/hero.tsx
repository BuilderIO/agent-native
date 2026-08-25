import { Button } from "./ds/button";
import { HeroShaderBackground } from "./hero-shader-background";
import { InstallCommand } from "./install-command";
import { GridInner, PageSection } from "./page-grid";

export function Hero() {
  return (
    <PageSection>
      <HeroShaderBackground />
      {/* No borderTop here: the sticky SiteHeader already draws the border
          directly above this section, so a second one would double the line. */}
      <GridInner
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--spacing-12)",
          padding: "var(--spacing-30) var(--spacing-10) var(--spacing-20)",
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
          <h1
            style={{
              margin: 0,
              textAlign: "center",
              fontFamily: "var(--b-font-sans)",
              fontSize: "var(--b-t-heading-1)",
              fontWeight: 500,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              color: "var(--b-text-primary)",
            }}
          >
            The agentic application framework
          </h1>
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
            Build for AI agents without building a second product for users.
            <br />
            Bring your own LLM. Deploy anywhere.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--spacing-6)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexWrap: "wrap",
              gap: "var(--spacing-6)",
            }}
          >
            <Button variant="cta" icon={null} href="/apps">
              GET STARTED
            </Button>
            <Button variant="secondary" icon={null} href="/docs">
              LEARN MORE
            </Button>
          </div>

          <InstallCommand />
        </div>
      </GridInner>
    </PageSection>
  );
}
