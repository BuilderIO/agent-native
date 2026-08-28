import { useT } from "@agent-native/core/client/i18n";

import { HeroBackground } from "./hero-background";
import { InstallCommand } from "./install-command";
import { GridInner, PageSection } from "./page-grid";
import { StartCtas } from "./start-ctas";

export function Hero() {
  const t = useT();

  return (
    <PageSection>
      <HeroBackground />
      {/* No top border on the GridInner below: the sticky SiteHeader already
          draws the border directly above this section, so a second one would
          double the line. */}
      <GridInner className="flex flex-col items-center gap-[var(--spacing-12)] px-[var(--spacing-10)] pt-[var(--spacing-60)] pb-[var(--spacing-40)]">
        <div className="flex w-full max-w-[875px] flex-col items-center gap-[var(--spacing-6)]">
          <h1 className="m-0 text-center font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-1)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)] mobile:leading-[1.2]">
            {t("homepage.hero.title")}
          </h1>
          <p className="m-0 text-center font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.3] text-[var(--b-text-primary)]">
            {t("homepage.hero.bodyLine1")}
            <br className="mobile:hidden" /> {t("homepage.hero.bodyLine2")}
          </p>
        </div>

        <div className="flex flex-col items-center gap-[var(--spacing-6)]">
          <StartCtas location="hero" />
          <InstallCommand />
        </div>
      </GridInner>
    </PageSection>
  );
}
