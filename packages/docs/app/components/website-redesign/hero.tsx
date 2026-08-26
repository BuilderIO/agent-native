import { Button } from "./ds/button";
import { GetStartedCta } from "./ds/get-started-modal";
import { HeroShaderBackground } from "./hero-shader-background";
import { InstallCommand } from "./install-command";
import { GridInner, PageSection } from "./page-grid";

export function Hero() {
  return (
    <PageSection>
      <HeroShaderBackground />
      {/* No top border on the GridInner below: the sticky SiteHeader already
          draws the border directly above this section, so a second one would
          double the line. */}
      <GridInner className="flex flex-col items-center gap-[var(--spacing-12)] px-[var(--spacing-10)] pt-[var(--spacing-50)] pb-[var(--spacing-40)]">
        <div className="flex w-full max-w-[875px] flex-col items-center gap-[var(--spacing-6)]">
          <h1 className="m-0 text-center font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-1)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)] mobile:leading-[1.2]">
            The agentic application framework
          </h1>
          <p className="m-0 text-center font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.3] text-[var(--b-text-primary)]">
            Build for AI agents without building a second product for users.
            <br className="mobile:hidden" />
            Bring your own LLM. Deploy anywhere.
          </p>
        </div>

        <div className="flex flex-col items-center gap-[var(--spacing-6)]">
          <div className="flex flex-wrap items-center justify-center gap-[var(--spacing-6)]">
            <GetStartedCta location="hero">GET STARTED</GetStartedCta>
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
