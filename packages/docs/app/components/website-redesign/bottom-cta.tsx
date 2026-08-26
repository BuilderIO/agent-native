import { GetStartedCta } from "./ds/get-started-modal";
import { InstallCommand } from "./install-command";
import { GridInner, PageSection } from "./page-grid";

export function BottomCta() {
  return (
    <PageSection>
      <GridInner className="flex flex-col items-center gap-[var(--spacing-12)] px-[var(--spacing-10)] py-[var(--spacing-40)]">
        <div className="flex w-full max-w-[875px] flex-col items-center gap-[var(--spacing-6)]">
          <h2 className="m-0 text-center font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-1)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)] mobile:max-w-[300px]">
            Build your first Agent-Native app
          </h2>
          <p className="m-0 text-center font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.3] text-[var(--b-text-secondary)]">
            Create one application for users and AI agents. Bring your own LLM
            and deploy anywhere.
          </p>
        </div>

        <GetStartedCta location="bottom_cta">GET STARTED</GetStartedCta>

        <InstallCommand />
      </GridInner>
    </PageSection>
  );
}
