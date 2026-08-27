import { useT } from "@agent-native/core/client/i18n";

import { GetStartedCta } from "./ds/get-started-modal";
import { InstallCommand } from "./install-command";
import { GridInner, PageSection } from "./page-grid";

export function BottomCta() {
  const t = useT();

  return (
    <PageSection>
      <GridInner className="flex flex-col items-center gap-[var(--spacing-12)] px-[var(--spacing-10)] py-[var(--spacing-40)]">
        <div className="flex w-full max-w-[875px] flex-col items-center gap-[var(--spacing-6)]">
          <h2 className="m-0 text-center font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-1)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)] mobile:max-w-[300px]">
            {t("homepage.bottomCta.title")}
          </h2>
          <p className="m-0 text-center font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.3] text-[var(--b-text-secondary)]">
            {t("homepage.bottomCta.body")}
          </p>
        </div>

        {/* Caps come from CSS, not the label: an all-caps string becomes the
            accessible name and screen readers spell it out letter by letter. */}
        <GetStartedCta location="bottom_cta" className="uppercase">
          {t("common.getStarted")}
        </GetStartedCta>

        <InstallCommand />
      </GridInner>
    </PageSection>
  );
}
