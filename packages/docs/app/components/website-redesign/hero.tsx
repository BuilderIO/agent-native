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
      <GridInner className="flex flex-col items-center gap-[var(--b-hero-gap)] px-[var(--b-hero-px)] pt-[var(--b-hero-pt)] pb-[var(--b-hero-pb)]">
        <div className="flex w-full flex-col items-center gap-[var(--b-hero-inner-gap)]">
          <h1 className="m-0 text-center font-[family-name:var(--b-font-sans)] text-[length:var(--b-hero-title-size)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)] mobile:leading-[1.2]">
            {t("homepage.hero.title")}
          </h1>
          <p className="m-0 w-full max-w-[750px] text-center font-[family-name:var(--b-font-sans)] text-[length:var(--b-hero-body-size)] leading-[1.6] text-[var(--b-text-secondary)]">
            <span className="block text-balance">
              {t("homepage.hero.bodyLine1")}
            </span>
            <span className="block">{t("homepage.hero.bodyLine2")}</span>
          </p>
        </div>

        <div className="flex flex-col items-center gap-[var(--b-hero-inner-gap)]">
          <StartCtas location="hero" />
          <InstallCommand />
        </div>
      </GridInner>
    </PageSection>
  );
}
